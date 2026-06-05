"""Task Queue Routes --- 通用任务队列 (PDF 导出 + 资料解析)"""

import asyncio
import json
import logging
import hashlib
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Query, BackgroundTasks
from fastapi.responses import Response
from pydantic import BaseModel

from src.services.supabase import get_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tasks/queue", tags=["task_queue"])


# ============================================================
# Models
# ============================================================

class PdfExportSubmit(BaseModel):
    question_ids: list[str]


class TaskOut(BaseModel):
    id: str
    task_type: str
    status: str
    progress_pct: int
    message: Optional[str]
    payload_json: dict
    result_json: dict
    created_at: str
    updated_at: str


# ============================================================
# Helpers
# ============================================================

def _safe(res):
    return res.data if hasattr(res, "data") else res


def _now():
    return datetime.now(timezone.utc).isoformat()


def _create_task(user_id: str, task_type: str, payload: dict) -> dict:
    task = {
        "user_id": user_id,
        "task_type": task_type,
        "status": "queued",
        "progress_pct": 0,
        "payload_json": payload,
    }
    res = get_admin().table("task_queue").insert(task).execute()
    data = _safe(res)
    return data[0] if isinstance(data, list) else data


def _update_task(task_id: str, **kwargs):
    kwargs["updated_at"] = _now()
    get_admin().table("task_queue").update(kwargs).eq("id", task_id).execute()


# ============================================================
# Queue endpoints
# ============================================================

@router.get("")
async def list_tasks(req: Request, limit: int = Query(default=20, ge=1, le=50)):
    """列出用户的任务队列"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(status_code=401)

    res = get_admin().table("task_queue").select("*").eq("user_id", user)\
        .order("created_at", desc=True).limit(limit).execute()
    data = _safe(res)
    return {"tasks": data if isinstance(data, list) else []}


@router.get("/{task_id}")
async def get_task(req: Request, task_id: str):
    """查询单个任务状态"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(status_code=401)

    try:
        res = get_admin().table("task_queue").select("*")\
            .eq("id", task_id).eq("user_id", user).limit(1).execute()
    except Exception as e:
        logger.error(f"get_task({task_id}) query failed: {e}")
        raise HTTPException(status_code=500, detail=f"查询任务失败: {str(e)[:200]}")
    data = _safe(res)
    if isinstance(data, list):
        data = data[0] if data else None
    if not data:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task": data}


@router.get("/{task_id}/download")
async def download_task(req: Request, task_id: str):
    """下载已完成任务的输出文件"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(status_code=401)

    # 使用 maybe_single() 避免 supabase-py 的 204/406 报错
    try:
        res = get_admin().table("task_queue").select("*")\
            .eq("id", task_id).eq("user_id", user).limit(1).execute()
    except Exception as e:
        logger.error(f"download_task({task_id}) query failed: {e}")
        raise HTTPException(status_code=500, detail=f"查询任务失败: {str(e)[:200]}")

    task = _safe(res)
    if isinstance(task, list):
        task = task[0] if task else None
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("status") != "done":
        raise HTTPException(status_code=400, detail="Task not completed yet")

    result = task.get("result_json") or {}
    # result_json 可能是 JSON 字符串（TEXT 列）或 dict（JSONB 列）
    if isinstance(result, str):
        try:
            import json
            result = json.loads(result)
        except Exception:
            logger.warning(f"download_task({task_id}): result_json is not valid JSON")
            raise HTTPException(status_code=500, detail="任务结果数据损坏")

    download_url = result.get("download_url", "")
    if not download_url:
        raise HTTPException(status_code=404, detail="No download available")

    # For Supabase Storage URLs, redirect; for others, return
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(download_url)
            if r.status_code == 200:
                content_type = result.get("content_type", "application/pdf")
                filename = result.get("filename", "download.pdf")
                return Response(
                    content=r.content,
                    media_type=content_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                )
            else:
                logger.error(f"download_task({task_id}): fetch file returned {r.status_code}")
    except Exception as e:
        logger.error(f"download_task({task_id}): fetch file failed: {e}")

    raise HTTPException(status_code=502, detail="Failed to fetch file")


# ============================================================
# PDF 导出任务提交
# ============================================================

@router.post("/pdf-export")
async def submit_pdf_export(req: Request, body: PdfExportSubmit):
    """提交 PDF 导出任务，立即返回 task_id"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(status_code=401)
    if not body.question_ids:
        raise HTTPException(status_code=400, detail="No question IDs")

    task = _create_task(user, "pdf_export", {"question_ids": body.question_ids})

    # 启动后台处理
    asyncio.create_task(_process_pdf_export(task["id"], user, body.question_ids))

    return {"status": "queued", "task_id": task["id"], "message": "PDF 导出任务已提交，稍后在任务队列中下载"}


# ============================================================
# 后台 PDF 导出处理
# ============================================================

PDF_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap');
  @page {{ size: A4; margin: 20mm 18mm; }}
  body {{ font-family: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", "WenQuanYi Micro Hei", sans-serif; font-size: 14px; line-height: 1.8; color: #1a1a1a; }}
  h1 {{ text-align: center; font-size: 22px; margin-bottom: 24px; border-bottom: 2px solid #333; padding-bottom: 12px; }}
  .question {{ margin-bottom: 28px; page-break-inside: avoid; }}
  .q-header {{ font-weight: bold; font-size: 15px; margin-bottom: 6px; }}
  .q-type {{ display: inline-block; font-size: 11px; color: #666; background: #f0f0f0; padding: 2px 8px; border-radius: 4px; margin-left: 8px; }}
  .q-difficulty {{ display: inline-block; font-size: 11px; color: #e67e22; margin-left: 6px; }}
  .q-content {{ margin: 8px 0; }}
  .q-options {{ margin: 8px 0 8px 16px; }}
  .q-option {{ margin: 3px 0; }}
  .q-answer {{ margin-top: 10px; padding: 10px; background: #f9f9f9; border-left: 3px solid #27ae60; border-radius: 4px; }}
  .q-answer-label {{ font-weight: bold; color: #27ae60; }}
  .q-explanation {{ margin-top: 6px; padding: 8px; background: #fef9e7; border-left: 3px solid #f1c40f; border-radius: 4px; font-size: 13px; }}
  .q-explanation-label {{ font-weight: bold; color: #e67e22; }}
</style>
</head>
<body>
<h1>考研题库 . 导出试卷</h1>
{questions_html}
<script>renderMathInElement(document.body, {{ delimiters: [{{left: "$$", right: "$$", display: true}}, {{left: "$", right: "$", display: false}}] }});</script>
</body>
</html>"""

TYPE_LABELS = {
    "choice": "选择题", "short_answer": "简答题", "calculation": "计算题",
    "essay": "论述题", "true_false": "判断题",
}


def _build_question_html(q: dict, index: int) -> str:
    qtype = TYPE_LABELS.get(q.get("type", ""), q.get("type", ""))
    stars = "★" * q.get("difficulty", 3) + "☆" * (5 - q.get("difficulty", 3))
    parts = [f'<div class="question">']
    parts.append(f'<div class="q-header">{index}. {qtype}<span class="q-type">{qtype}</span><span class="q-difficulty">{stars}</span></div>')
    parts.append(f'<div class="q-content">{q.get("content", "")}</div>')

    options = q.get("options") or []
    if isinstance(options, str):
        try: options = json.loads(options)
        except: options = []
    if options:
        parts.append('<div class="q-options">')
        for opt in options:
            parts.append(f'<div class="q-option"><strong>{opt.get("label","")}.</strong> {opt.get("text","")}</div>')
        parts.append('</div>')

    if q.get("answer"):
        parts.append(f'<div class="q-answer"><span class="q-answer-label">答案：</span>{q["answer"]}</div>')
    if q.get("explanation"):
        parts.append(f'<div class="q-explanation"><span class="q-explanation-label">解析：</span>{q["explanation"]}</div>')
    parts.append('</div>')
    return "\n".join(parts)


async def _process_pdf_export(task_id: str, user_id: str, question_ids: list[str]):
    """后台处理 PDF 导出任务"""
    try:
        _update_task(task_id, status="processing", progress_pct=10, message="正在查询题目...")

        # 查题目
        res = get_admin().table("question_bank").select("*")\
            .eq("user_id", user_id).in_("id", question_ids).execute()
        questions = _safe(res)
        if not isinstance(questions, list):
            questions = []

        if not questions:
            _update_task(task_id, status="failed", message="未找到题目")
            return

        _update_task(task_id, progress_pct=30, message=f"已查询 {len(questions)} 道题目，正在生成 PDF...")

        # 构建 HTML
        html_parts = [_build_question_html(q, i + 1) for i, q in enumerate(questions)]
        html = PDF_HTML_TEMPLATE.replace("{questions_html}", "\n".join(html_parts))

        # Playwright 渲染
        from fastapi import FastAPI
        import asyncio as aio

        # 获取 app state (通过任务 context 无法直接访问，遍历获取)
        # 这里简化处理：尝试用 httpx 调自己的 download endpoint 不太好
        # 直接在 task 中访问浏览器单例
        browser = None
        semaphore = None

        from src.services.pdf_renderer import get_browser, get_semaphore
        browser = get_browser()
        semaphore = get_semaphore()

        if not browser:
            _update_task(task_id, status="failed", message="PDF 渲染引擎未就绪，请确保服务器已安装 Playwright 和 Chromium")
            return

        _update_task(task_id, progress_pct=50, message="正在渲染 PDF...")

        async with semaphore:
            page = await browser.new_page()
            try:
                await page.set_content(html, wait_until="networkidle", timeout=30000)
                await aio.sleep(2)
                pdf_bytes = await page.pdf(format="A4", margin={"top": "20mm", "right": "18mm", "bottom": "20mm", "left": "18mm"}, print_background=True)
            finally:
                await page.close()

        _update_task(task_id, progress_pct=80, message="正在上传文件...")

        # 上传到 Supabase Storage
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"pdf_exports/{user_id}/{ts}_questions.pdf"
        sb = get_admin()
        sb.storage.from_("temp-uploads").upload(
            filename, pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"}
        )
        download_url = sb.storage.from_("temp-uploads").get_public_url(filename)

        _update_task(task_id, status="done", progress_pct=100,
                     result_json={
                         "download_url": download_url,
                         "filename": f"questions_{ts}.pdf",
                         "content_type": "application/pdf",
                         "file_size": len(pdf_bytes),
                         "question_count": len(questions),
                     },
                     message=f"PDF 已生成，包含 {len(questions)} 道题目")

    except Exception as e:
        logger.exception(f"PDF export task {task_id} failed")
        _update_task(task_id, status="failed", progress_pct=0, message=str(e)[:300])