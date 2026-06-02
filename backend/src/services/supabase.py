from supabase import create_client, Client
from datetime import datetime, timezone

from src.config import settings

_client: Client | None = None


def get_admin() -> Client:
    """获取 Supabase admin client (service_role, 单例)"""
    global _client
    if _client is None:
        _client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )
    return _client


async def get_webdav_config(user_id: str) -> dict:
    """获取用户的 WebDAV 配置"""
    res = (
        get_admin()
        .table("webdav_configs")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .limit(1)
        .single()
        .execute()
    )
    if not res.data:
        raise ValueError("未找到有效的 WebDAV 配置")
    return res.data


async def get_ai_config(user_id: str) -> dict:
    """获取用户的 AI 配置 (优先用户自定义, 其次环境变量)"""
    res = (
        get_admin()
        .table("ai_configs")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .single()
        .execute()
    )
    data = res.data or {}
    return {
        "api_key": data.get("embed_api_key") or data.get("api_key") or settings.openai_api_key,
        "base_url": data.get("embed_base_url") or data.get("base_url") or settings.openai_base_url,
        "embed_model": data.get("embed_model") or data.get("embedding_model") or settings.embedding_model,
    }


# ─── Parse Tasks 操作 ────────────────────────────────────────

def create_parse_task(material_id: str) -> dict:
    """创建解析任务记录，返回 task 字典"""
    res = get_admin().table("parse_tasks").insert({
        "material_id": material_id,
        "status": "queued",
        "progress_pct": 0,
    }).execute()
    task = res.data[0] if res.data else {}
    return task


def update_parse_task(task_id: str, status: str, progress_pct: int = 0, message: str | None = None,
                      result_json: dict | None = None) -> None:
    """更新任务状态"""
    payload = {
        "status": status,
        "progress_pct": progress_pct,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if message is not None:
        payload["message"] = message
    if result_json is not None:
        payload["result_json"] = result_json
    get_admin().table("parse_tasks").update(payload).eq("id", task_id).execute()


def get_parse_task(task_id: str) -> dict | None:
    """查询单个任务"""
    res = get_admin().table("parse_tasks").select("*").eq("id", task_id).maybe_single().execute()
    return res.data if hasattr(res, "data") else None



# ─── Storage 临时上传 (供 MinerU 等外部服务获取公网 URL) ──────

def upload_temp_file(file_bytes: bytes, file_name: str) -> str:
    """上传文件到 temp-uploads bucket，返回公网 URL"""
    bucket = getattr(settings, "supabase_storage_bucket", "temp-uploads")
    path = f"mineru/{file_name}"
    supabase = get_admin()
    res = supabase.storage.from_(bucket).upload(
        path, file_bytes,
        {"content-type": "application/octet-stream", "upsert": "true"}
    )
    public_url = supabase.storage.from_(bucket).get_public_url(path)
    print(f"[storage] Uploaded {file_name} → {public_url}")
    return public_url


def delete_temp_file(file_name: str) -> None:
    """删除临时文件"""
    bucket = getattr(settings, "supabase_storage_bucket", "temp-uploads")
    path = f"mineru/{file_name}"
    try:
        get_admin().storage.from_(bucket).remove([path])
        print(f"[storage] Deleted {path}")
    except Exception as e:
        print(f"[storage] Delete failed for {path}: {e}")

def list_parse_tasks(limit: int = 20) -> list[dict]:
    """列出最近任务"""
    res = get_admin().table("parse_tasks").select("*").order("created_at", desc=True).limit(limit).execute()
    return res.data if hasattr(res, "data") else []