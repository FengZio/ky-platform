"""
任务式解析路由
POST /api/tasks       提交解析任务
GET  /api/tasks/{id}  查询任务状态/结果
GET  /api/tasks       列出最近任务
"""
import asyncio
import traceback

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from src.services.supabase import (
    get_admin,
    create_parse_task,
    update_parse_task,
    get_parse_task,
    list_parse_tasks,
)
from src.services.mineru_parser import parse_document
from src.services.chunker import chunk_text
from src.services.embedding import get_embedding

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

# 兼容 supabase-py v2 (APIResponse) 和 v3 (直接返回 data)
def _safe_data(res):
    return res.data if hasattr(res, "data") else res


# 并发控制: 最多 2 个任务同时处理
_semaphore = asyncio.Semaphore(2)


class TaskSubmitRequest(BaseModel):
    material_id: str
    webdav_path: str | None = None


# ─── POST /api/tasks — 提交任务 ─────────────────────────────

@router.post("")
async def submit_task(req: Request, body: TaskSubmitRequest, background_tasks: BackgroundTasks):
    """提交解析任务，返回 task_id，后台异步处理"""
    try:
        current_user = getattr(req.state, "user_id", None)
        if not current_user:
            raise HTTPException(401, "Not authenticated")

        supabase = get_admin()
        mid = body.material_id

        # 查资料记录 (获取 user_id 和 webdav_path)
        res = (
            supabase.table("learning_materials")
            .select("*")
            .eq("id", mid)
            .eq("uploaded_by", current_user)
            .maybe_single()
            .execute()
        )
        material = _safe_data(res)
        if not material:
            raise HTTPException(404, "Material not found")

        # webdav_path 优先请求体，其次数据库
        wd_path = body.webdav_path or material.get("webdav_path", "")
        if not wd_path:
            raise HTTPException(400, "No webdav_path available")

        # 获取上传者 ID
        user_id = material.get("uploaded_by", "")
        if not user_id:
            raise HTTPException(400, "Material has no owner info (uploaded_by)")
        if user_id != current_user:
            raise HTTPException(403, "Material does not belong to current user")

        # 创建任务记录
        task = create_parse_task(mid)
        task_id = task.get("id")
        if not task_id:
            raise RuntimeError("create_parse_task 未返回有效的 task id")

        # 后台执行
        background_tasks.add_task(_run_parse_pipeline, task_id, mid, wd_path, user_id)

        return {"task_id": task_id, "status": "queued"}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"任务创建失败: {e}")

# ─── GET /api/tasks/{task_id} — 查询状态 ────────────────────

@router.get("/{task_id}")
async def get_task(req: Request, task_id: str):
    """查询解析任务状态"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(401, "Not authenticated")

    task = get_parse_task(task_id, user)
    if not task:
        raise HTTPException(404, "Task not found")

    # 如果发现任务处于异常中间状态（进程可能重启过），标记为 failed
    if task["status"] in ("downloading", "uploading", "parsing", "chunking", "embedding"):
        # 检查是否长时间无更新 (超过 10 分钟)
        from datetime import datetime, timezone, timedelta
        updated = task.get("updated_at")
        if updated:
            updated = datetime.fromisoformat(str(updated).replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - updated > timedelta(minutes=10):
                update_parse_task(task_id, "failed", task["progress_pct"],
                                  message="任务中断，请重新触发")
                task = get_parse_task(task_id, user)

    return {
        "task_id": task["id"],
        "material_id": task.get("material_id"),
        "status": task["status"],
        "progress_pct": task.get("progress_pct", 0),
        "message": task.get("message"),
        "result": task.get("result_json"),
    }


# ─── GET /api/tasks — 任务列表 ──────────────────────────────

@router.get("")
async def list_tasks(req: Request, limit: int = 20):
    """列出最近任务"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(401, "Not authenticated")

    tasks = list_parse_tasks(limit, user)
    # 批量获取 material 标题
    material_ids = list(set(t.get("material_id") for t in tasks if t.get("material_id")))
    title_map = {}
    supabase = get_admin()
    for mid in material_ids:
        try:
            res = supabase.table("learning_materials").select("title").eq("id", mid).maybe_single().execute()
            mat = _safe_data(res)
            if mat:
                title_map[mid] = mat.get("title", "")
        except Exception:
            pass
    return [
        {
            "task_id": t["id"],
            "material_id": t.get("material_id"),
            "material_title": title_map.get(t.get("material_id", ""), ""),
            "status": t["status"],
            "progress_pct": t.get("progress_pct", 0),
            "message": t.get("message"),
            "created_at": str(t.get("created_at", "")),
        }
        for t in tasks
    ]


# ─── 后台任务执行体 ─────────────────────────────────────────

async def _run_parse_pipeline(task_id: str, material_id: str, webdav_path: str, user_id: str):
    """后台执行完整解析流水线"""
    supabase = get_admin()

    async with _semaphore:
        try:
            # Step 1: 下载 + 上传到 MinerU
            update_parse_task(task_id, "downloading", 5)
            print(f"[task:{task_id}] Starting parse pipeline for material={material_id}")

            update_parse_task(task_id, "uploading", 15)
            # Step 2: MinerU 解析 (自动检测页数, 超限自动切分并行处理)

            update_parse_task(task_id, "parsing", 30)
            final_text = await parse_document(user_id, webdav_path, task_id)
            final_text = final_text[:200000]  # 截断

            # Step 3: 分块
            update_parse_task(task_id, "chunking", 60)
            chunks = chunk_text(final_text, 400)
            print(f"[task:{task_id}] Chunks: {len(chunks)}")



            # Step 4: 更新 learning_materials (先存 content，embedding 等全部 chunk 完成后再设)
            material_res = supabase.table("learning_materials").select("title,type,notes").eq("id", material_id).maybe_single().execute()
            mat = _safe_data(material_res)
            if not mat:
                raise RuntimeError(f"Material {material_id} not found during pipeline")

            meta_title = mat.get("title") or ""
            meta_type = mat.get("type") or ""
            meta_notes = mat.get("notes") or ""
            meta_text = f"Material: {meta_title}. Type: {meta_type}. Notes: {meta_notes}"

            # 先存解析后的文本内容
            supabase.table("learning_materials").update({
                "content": final_text,
                "updated_at": "now()",
            }).eq("id", material_id).execute()

            # 元数据向量（暂存变量，所有 chunk 完成后再写入 DB）
            print(f"[task:{task_id}] Starting meta embedding...")
            meta_emb = None
            try:
                meta_emb = await get_embedding(meta_text, user_id)
            except Exception as e:
                print(f"[task:{task_id}] Meta embedding failed (will retry later): {e}")

            # 删旧 chunks (先删后插; 单块 embedding 失败有独立 try-catch 兜底)
            supabase.table("material_chunks").delete().eq("material_id", material_id).execute()

            # Step 5: 逐块向量化
            total = len(chunks)
            print(f"[task:{task_id}] Starting {total} chunk embeddings...")
            update_parse_task(task_id, "embedding", 70)
            chunk_count = 0
            fail_count = 0

            for i, chunk in enumerate(chunks):
                content_text = chunk["content"] if isinstance(chunk, dict) else chunk
                chunk_type_val = chunk.get("chunk_type", "question") if isinstance(chunk, dict) else "question"
                kp_list = chunk.get("knowledge_points", []) if isinstance(chunk, dict) else []

                print(f"[task:{task_id}] Chunk {i}/{total} embedding...")
                try:
                    emb = await get_embedding(content_text, user_id)
                    supabase.table("material_chunks").insert({
                        "material_id": material_id,
                        "chunk_index": i,
                        "content": content_text,
                        "chunk_type": chunk_type_val,
                        "knowledge_points": kp_list,
                        "embedding": emb,
                    }).execute()
                    chunk_count += 1
                    if i % 20 == 0:
                        print(f"[task:{task_id}] Inserted chunk {i}/{total}")
                except Exception as e:
                    print(f"[task:{task_id}] Chunk {i} embedding failed: {e}")
                    fail_count += 1
                    supabase.table("material_chunks").insert({
                        "material_id": material_id,
                        "chunk_index": i,
                        "content": content_text,
                        "chunk_type": chunk_type_val,
                        "knowledge_points": kp_list,
                    }).execute()

                # API 限流: 每块间延迟 0.3s
                await asyncio.sleep(0.3)

                # 更新进度
                pct = 70 + int((i + 1) / total * 25)
                if i % 5 == 0:
                    update_parse_task(task_id, "embedding", pct)


            # Step 6: 全部 chunk 完成后，更新 learning_materials.embedding
            final_emb = meta_emb
            if not final_emb:
                print(f"[task:{task_id}] Retrying meta embedding...")
                try:
                    final_emb = await get_embedding(meta_text, user_id)
                except Exception as e:
                    print(f"[task:{task_id}] Final meta embedding also failed: {e}")
            if final_emb:
                supabase.table("learning_materials").update({
                    "embedding": final_emb,
                    "updated_at": "now()",
                }).eq("id", material_id).execute()

            # 完成
            result = {
                "material_id": material_id,
                "text_length": len(final_text),
                "chunks_total": total,
                "chunks_embedded": chunk_count,
                "chunks_failed": fail_count,
            }
            update_parse_task(task_id, "done", 100, result_json=result)
            print(f"[task:{task_id}] Done: {chunk_count}/{total} embedded, {fail_count} failed")

        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}"
            traceback.print_exc()
            print(f"[task:{task_id}] FAILED: {error_msg}")
            update_parse_task(task_id, "failed", 0, message=error_msg)




