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


def get_user_client(access_token: str) -> Client:
    """按用户 access token 构造 Supabase client。"""
    token = (access_token or "").strip()
    if not token:
        raise ValueError("缺少 SUPABASE_ACCESS_TOKEN")
    if not settings.supabase_url:
        raise ValueError("缺少 SUPABASE_URL")
    if not settings.supabase_anon_key:
        raise ValueError("缺少 SUPABASE_ANON_KEY")

    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    try:
        client.postgrest.auth(token)
    except Exception:
        pass
    try:
        client.auth.set_session(access_token=token, refresh_token=token)
    except Exception:
        pass
    return client


async def get_ai_config_for_client(client: Client) -> dict:
    """基于用户态 client 读取 AI 配置，失败时回退到全局默认。"""
    data: dict = {}
    try:
        res = (
            client.table("ai_configs")
            .select("*")
            .eq("is_active", True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        if isinstance(res.data, dict):
            data = res.data
    except Exception:
        data = {}

    return {
        "api_key": data.get("embed_api_key") or data.get("api_key") or settings.openai_api_key,
        "base_url": data.get("embed_base_url") or data.get("base_url") or settings.openai_base_url,
        "embed_model": data.get("embed_model") or data.get("embedding_model") or settings.embedding_model,
    }


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
    """创建解析任务记录，返回包含 id 的 task 字典"""
    try:
        res = get_admin().table("parse_tasks").insert({
            "material_id": material_id,
            "status": "queued",
            "progress_pct": 0,
        }).execute()
        # 兼容 supabase-py v2 (APIResponse) 与 v3 (直接返回 data)
        data = res.data if hasattr(res, "data") else res
        if isinstance(data, list) and len(data) > 0:
            task = data[0]
        elif isinstance(data, dict):
            task = data
        else:
            task = {}
        if not task.get("id"):
            raise RuntimeError(f"create_parse_task: Supabase insert did not return id, data={data}")
        return task
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"create_parse_task failed: {e}")


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
    try:
        get_admin().table("parse_tasks").update(payload).eq("id", task_id).execute()
    except Exception as e:
        print(f"[supabase] update_parse_task({task_id}) failed: {e}")


def get_parse_task(task_id: str, user_id: str | None = None) -> dict | None:
    """查询单个任务"""
    try:
        query = get_admin().table("parse_tasks").select("*").eq("id", task_id)
        if user_id:
            material_ids = _get_user_material_ids(user_id)
            if not material_ids:
                return None
            query = query.in_("material_id", material_ids)
        res = query.maybe_single().execute()
        data = res.data if hasattr(res, "data") else res
        if isinstance(data, dict):
            return data
        if isinstance(data, list) and len(data) > 0:
            return data[0]
        return None
    except Exception as e:
        print(f"[supabase] get_parse_task({task_id}) failed: {e}")
        return None


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


def _get_user_material_ids(user_id: str) -> list[str]:
    """返回用户拥有的学习资料 ID。"""
    try:
        res = (
            get_admin()
            .table("learning_materials")
            .select("id")
            .eq("uploaded_by", user_id)
            .execute()
        )
        data = res.data if hasattr(res, "data") else res
        if not isinstance(data, list):
            return []
        return [row["id"] for row in data if row.get("id")]
    except Exception as e:
        print(f"[supabase] _get_user_material_ids({user_id}) failed: {e}")
        return []


def list_parse_tasks(limit: int = 20, user_id: str | None = None) -> list[dict]:
    """列出最近任务"""
    try:
        query = get_admin().table("parse_tasks").select("*")
        if user_id:
            material_ids = _get_user_material_ids(user_id)
            if not material_ids:
                return []
            query = query.in_("material_id", material_ids)
        res = query.order("created_at", desc=True).limit(limit).execute()
        data = res.data if hasattr(res, "data") else res
        if isinstance(data, list):
            return data
        return []
    except Exception as e:
        print(f"[supabase] list_parse_tasks failed: {e}")
        return []
