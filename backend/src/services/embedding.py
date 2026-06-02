import httpx

from src.config import settings

# 复用连接池
_client: "httpx.AsyncClient | None" = None
_REQUEST_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=15.0, pool=15.0)


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=_REQUEST_TIMEOUT,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10, keepalive_expiry=30.0),
        )
    return _client


async def get_embedding(text: str, user_id: str = "") -> list[float]:
    api_key = settings.openai_api_key
    base_url = settings.openai_base_url.rstrip("/")
    model = settings.embedding_model

    if not api_key:
        if user_id:
            from src.services.supabase import get_ai_config
            try:
                cfg = await get_ai_config(user_id)
                api_key = cfg["api_key"]
                base_url = cfg["base_url"].rstrip("/")
                model = cfg["embed_model"]
            except Exception:
                pass

    if not api_key:
        raise RuntimeError("No AI API key configured")

    # 截断过长文本并记录
    trimmed = text[:8000]
    print(f"[embedding] Calling {base_url}/embeddings model={model} text_len={len(trimmed)}")

    client = _get_client()
    try:
        resp = await client.post(
            base_url + "/embeddings",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json={"model": model, "input": trimmed},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Embedding API {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
        emb = data.get("data", [{}])[0].get("embedding")
        if not emb:
            raise RuntimeError("No embedding in response")
        print(f"[embedding] OK dims={len(emb)}")
        return emb
    except Exception:
        print(f"[embedding] FAILED for text_len={len(trimmed)}")
        raise
