"""
MinerU 文档解析服务
WebDAV → Supabase Storage(公网URL) → POST /api/v4/extract/task → 轮询 → full.md
超过 200 页自动切分后合并
"""
import asyncio
import io
import re
import urllib.parse
import zipfile
from base64 import b64encode
from pathlib import Path

import httpx
import fitz  # PyMuPDF

from src.config import settings
from src.services.supabase import get_admin, get_webdav_config


MAX_PDF_PAGES = getattr(settings, "mineru_max_pages", 200)


def _sanitize_filename(raw_name: str) -> str:
    decoded = urllib.parse.unquote(raw_name)
    suffix = Path(decoded).suffix.lower()
    stem = Path(decoded).stem
    clean_stem = re.sub(r'[^\w.\-\[\]（）()\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]', '_', stem)
    clean_stem = re.sub(r'_+', '_', clean_stem).strip('_')
    if not clean_stem:
        clean_stem = "document"
    return clean_stem + (suffix if suffix else ".pdf")


def _count_pdf_pages(file_bytes: bytes) -> int:
    """返回 PDF 总页数"""
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    count = doc.page_count
    doc.close()
    return count


def _split_pdf_bytes(file_bytes: bytes, max_pages: int) -> list[bytes]:
    """将 PDF 按 max_pages 切分为多个 bytes，每个 ≤ max_pages 页"""
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    total = doc.page_count
    chunks = []
    for start in range(0, total, max_pages):
        end = min(start + max_pages, total)
        new_doc = fitz.open()
        new_doc.insert_pdf(doc, from_page=start, to_page=end - 1)
        buf = new_doc.tobytes()
        new_doc.close()
        chunks.append(buf)
        print(f"[mineru] Split chunk pages {start+1}-{end} of {total}")
    doc.close()
    return chunks


async def _download_from_webdav(user_id: str, webdav_path: str) -> tuple[bytes, str]:
    """从 WebDAV 下载文件，返回 (file_bytes, safe_name)"""
    wd = await get_webdav_config(user_id)
    file_name = webdav_path.rstrip("/").split("/")[-1] or "unknown.pdf"
    safe_name = _sanitize_filename(file_name)

    base_url = wd["url"].rstrip("/")
    normalized = webdav_path.lstrip("/").rstrip("/")
    download_url = f"{base_url}/{normalized}"
    credentials = f"{wd['username']}:{wd['password']}"
    auth_b64 = b64encode(credentials.encode()).decode()

    print(f"[mineru] Downloading: {download_url}")
    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.get(download_url, headers={"Authorization": f"Basic {auth_b64}"})
        resp.raise_for_status()
        file_bytes = resp.content
    print(f"[mineru] Downloaded: {len(file_bytes)/1024/1024:.1f} MB")
    return file_bytes, safe_name


def _upload_to_storage(supabase, bucket: str, file_bytes: bytes, storage_path: str) -> str:
    """上传到 Supabase Storage，返回公网 URL"""
    print(f"[mineru] Uploading to Storage: {storage_path}")
    supabase.storage.from_(bucket).upload(
        storage_path, file_bytes,
        {"content-type": "application/pdf", "upsert": "true"}
    )
    public_url = supabase.storage.from_(bucket).get_public_url(storage_path)
    print(f"[mineru] Public URL: {public_url[:100]}...")
    return public_url


async def _submit_mineru_task(public_url: str) -> str:
    """提交 MinerU 解析任务，返回 mineru_task_id"""
    token = settings.mineru_api_token
    mineru_base = settings.mineru_base_url.rstrip("/")
    auth_headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}

    print(f"[mineru] Submitting parse task...")
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{mineru_base}/api/v4/extract/task",
            headers=auth_headers,
            json={"url": public_url, "model_version": settings.mineru_model_version},
        )
        resp.raise_for_status()
        result = resp.json()

    if result.get("code") != 0:
        raise RuntimeError(f"MinerU submit failed: {result.get('msg')}")

    mineru_task_id = result["data"]["task_id"]
    print(f"[mineru] Submitted, task_id={mineru_task_id}")
    return mineru_task_id


# ─── 保留的旧接口 (兼容其他可能的调用方) ────────────────────

async def submit_parse_task(user_id: str, webdav_path: str, task_id: str) -> str:
    """提交 MinerU 解析 (旧接口)，返回 mineru_task_id

    注意: 此接口不再自动检测页数/切分，建议使用 parse_document()。
    """
    token = settings.mineru_api_token
    if not token:
        raise ValueError("MINERU_API_TOKEN not configured")

    file_bytes, safe_name = await _download_from_webdav(user_id, webdav_path)

    supabase = get_admin()
    bucket = getattr(settings, "supabase_storage_bucket", "temp-uploads")
    suffix = Path(safe_name).suffix or ".pdf"
    storage_path = f"mineru/{task_id}{suffix}"
    public_url = _upload_to_storage(supabase, bucket, file_bytes, storage_path)

    return await _submit_mineru_task(public_url)


async def poll_parse_result(mineru_task_id: str) -> str:
    """轮询 MinerU 解析结果，返回 full.md"""
    token = settings.mineru_api_token
    base_url = settings.mineru_base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {token}"}
    interval = settings.mineru_poll_interval
    max_retries = settings.mineru_poll_max_retries

    for attempt in range(max_retries):
        await asyncio.sleep(interval)
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{base_url}/api/v4/extract/task/{mineru_task_id}", headers=headers)
            resp.raise_for_status()
            result = resp.json()

        if result.get("code") != 0:
            raise RuntimeError(f"MinerU poll: {result.get('msg')}")

        data = result.get("data", {})
        state = data.get("state", "")

        if state == "done":
            zip_url = data.get("full_zip_url", "")
            if not zip_url:
                raise RuntimeError("No full_zip_url in done state")
            print(f"[mineru] Done, downloading zip...")
            async with httpx.AsyncClient(timeout=120.0) as client:
                zr = await client.get(zip_url); zr.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(zr.content)) as zf:
                for name in zf.namelist():
                    if name.endswith(".md"):
                        text = zf.read(name).decode("utf-8")
                        print(f"[mineru] Got {len(text)} chars from {name}")
                        return text
                raise RuntimeError(f"No .md in zip: {zf.namelist()[:10]}")

        elif state == "failed":
            raise RuntimeError(f"MinerU failed: {data.get('err_msg')}")

        else:
            pg = data.get("extract_progress", {})
            pages = f"{pg.get('extracted_pages','?')}/{pg.get('total_pages','?')}" if pg else "?"
            print(f"[mineru] Poll {attempt+1}: {state}, pages={pages}")

        interval = min(interval * 2, 30)

    raise TimeoutError(f"MinerU timeout after {max_retries} polls")


# ─── 新接口: 自动检测页数并按需切分 ──────────────────────────

async def parse_document(user_id: str, webdav_path: str, task_id: str) -> str:
    """完整解析流程: 下载 → 检测页数 → (可选切分) → 并行提交 → 并行轮询 → 合并

    超过 MAX_PDF_PAGES 页自动切分为多个分片，各分片并行提交和轮询，
    最后将各分片的 full.md 用双换行拼接返回。
    """
    token = settings.mineru_api_token
    if not token:
        raise ValueError("MINERU_API_TOKEN not configured")

    # 1. 下载
    file_bytes, safe_name = await _download_from_webdav(user_id, webdav_path)

    # 2. 检测页数 & 按需切分
    total_pages = _count_pdf_pages(file_bytes)
    print(f"[mineru] PDF has {total_pages} pages, max={MAX_PDF_PAGES}")

    if total_pages <= MAX_PDF_PAGES:
        pdf_parts = [file_bytes]
    else:
        print(f"[mineru] Splitting into chunks of {MAX_PDF_PAGES} pages...")
        pdf_parts = _split_pdf_bytes(file_bytes, MAX_PDF_PAGES)

    # 3. 上传各分片到 Storage
    supabase_obj = get_admin()
    bucket = getattr(settings, "supabase_storage_bucket", "temp-uploads")
    suffix = Path(safe_name).suffix or ".pdf"
    public_urls = []
    for i, part_bytes in enumerate(pdf_parts):
        storage_path = f"mineru/{task_id}_p{i}{suffix}"
        url = _upload_to_storage(supabase_obj, bucket, part_bytes, storage_path)
        public_urls.append(url)

    # 4. 并行提交 MinerU 任务
    mineru_task_ids = await asyncio.gather(*[_submit_mineru_task(u) for u in public_urls])
    print(f"[mineru] Submitted {len(mineru_task_ids)} part(s)")

    # 5. 并行轮询结果
    results = await asyncio.gather(*[poll_parse_result(mid) for mid in mineru_task_ids])

    # 6. 合并
    if len(results) == 1:
        full_text = results[0]
    else:
        full_text = "\n\n".join(results)
        print(f"[mineru] Merged {len(results)} parts, total {len(full_text)} chars")

    return full_text
