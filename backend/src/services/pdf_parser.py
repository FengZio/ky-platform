import io
from base64 import b64encode
from typing import Tuple

import fitz  # PyMuPDF
import httpx

from src.services.supabase import get_webdav_config


async def download_and_parse_pdf(user_id: str, webdav_path: str) -> Tuple[str, str]:
    """从 WebDAV 下载 PDF 并用 PyMuPDF 提取 Markdown 文本。

    优先使用 get_text("markdown") (PyMuPDF >= 1.24),
    降级为 get_text("text") + 结构重建。

    Returns:
        (markdown_text, file_name)
    """
    wd = await get_webdav_config(user_id)
    file_name = webdav_path.rstrip("/").split("/")[-1] or "unknown.pdf"

    # 构建下载 URL
    base_url = wd["url"].rstrip("/")
    normalized = webdav_path.lstrip("/").rstrip("/")
    download_url = f"{base_url}/{normalized}"

    # Basic Auth
    credentials = f"{wd['username']}:{wd['password']}"
    auth_b64 = b64encode(credentials.encode()).decode()

    print(f"[pdf-parser] Downloading: {download_url}")

    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.get(
            download_url,
            headers={"Authorization": f"Basic {auth_b64}"},
        )
        resp.raise_for_status()
        pdf_bytes = resp.content

    size_mb = len(pdf_bytes) / 1024 / 1024
    print(f"[pdf-parser] Downloaded: {size_mb:.1f} MB")

    # PyMuPDF 解析 → Markdown
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    parts: list[str] = []

    for page_num, page in enumerate(doc):
        # 尝试 Markdown 输出 (PyMuPDF >= 1.24)
        try:
            md = page.get_text("markdown")
            if md and md.strip():
                parts.append(md.strip())
                continue
        except (ValueError, TypeError, AttributeError, AssertionError):
            pass  # 降级

        # 降级: blocks 模式, 检测字体大小推断标题
        blocks = page.get_text("blocks")
        for block in blocks:
            if len(block) < 5:
                continue
            block_type = block[6] if len(block) > 6 else 0  # 0=text, 1=image
            if block_type != 0:
                continue

            text = block[4].strip() if len(block) > 4 else ""
            if not text:
                continue

            # 检测大字体 → Markdown 标题
            font_size = block[3] if len(block) > 3 else 0  # approximate
            if isinstance(font_size, (int, float)) and font_size > 14:
                text = f"## {text}"
            elif isinstance(font_size, (int, float)) and font_size > 11:
                text = f"### {text}"

            parts.append(text)

    doc.close()

    full_text = "\n\n".join(parts)
    print(f"[pdf-parser] Extracted: {len(full_text)} chars")

    return full_text, file_name