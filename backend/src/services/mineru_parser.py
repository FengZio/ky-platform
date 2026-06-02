"""
MinerU 文档解析服务
WebDAV → Supabase Storage(公网URL) → POST /api/v4/extract/task → 轮询 → full.md
"""
import asyncio
import io
import re
import urllib.parse
import zipfile
from base64 import b64encode
from pathlib import Path

import httpx

from src.config import settings
from src.services.supabase import get_admin, get_webdav_config


def _sanitize_filename(raw_name: str) -> str:
    decoded = urllib.parse.unquote(raw_name)
    suffix = Path(decoded).suffix.lower()
    stem = Path(decoded).stem
    clean_stem = re.sub(r'[^\w.\-\[\]（）()\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]', '_', stem)
    clean_stem = re.sub(r'_+', '_', clean_stem).strip('_')
    if not clean_stem:
        clean_stem = "document"
    return clean_stem + (suffix if suffix else ".pdf")


async def submit_parse_task(user_id: str, webdav_path: str, task_id: str) -> str:
    """提交 MinerU 解析，返回 task_id"""
    token = settings.mineru_api_token
    if not token:
        raise ValueError("MINERU_API_TOKEN not configured")

    # 1. WebDAV 下载
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

    # 2. 上传到 Supabase Storage（纯英文路径）
    supabase = get_admin()
    bucket = getattr(settings, "supabase_storage_bucket", "temp-uploads")
    suffix = Path(safe_name).suffix or ".pdf"
    storage_path = f"mineru/{task_id}{suffix}"

    print(f"[mineru] Uploading to Storage: {storage_path}")
    supabase.storage.from_(bucket).upload(
        storage_path, file_bytes,
        {"content-type": "application/pdf", "upsert": "true"}
    )
    public_url = supabase.storage.from_(bucket).get_public_url(storage_path)
    print(f"[mineru] Public URL: {public_url[:100]}...")

    # 3. POST /api/v4/extract/task（官方单文件接口）
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
    # 注意: 不在这里删 Storage 文件，MinerU 还没下载
    return mineru_task_id


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