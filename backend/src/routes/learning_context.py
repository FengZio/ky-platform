import logging
from pydantic import BaseModel
from src.services.embedding import get_embedding
from src.services.supabase import get_admin

logger = logging.getLogger(__name__)


class ContextRequest(BaseModel):
    message: str
    kp_ids: list[str] = []
    material_ids: list[str] = []
    top_k: int = 5
    min_score: float = 0.3


async def search_vector_context(req: ContextRequest) -> str:
    """Search material_chunks and knowledge_points via pgvector RPC."""
    print("[CTX] search: msg_len=%d mat_ids=%d kp_ids=%d top_k=%d",
                len(req.message), len(req.material_ids), len(req.kp_ids), req.top_k)

    if not req.message.strip():
        return ""

    try:
        query_emb = await get_embedding(req.message)
        print("[CTX] embedded: dims=%d", len(query_emb))
    except Exception as e:
        print("[CTX] embed fail: %s", e)
        return ""

    client = get_admin()
    results = []

    try:
        chunk_resp = client.rpc(
            "search_chunks_by_vector",
            {
                "p_query_embedding": query_emb,
                "p_material_ids": req.material_ids or None,
                "p_top_k": req.top_k * 2,
                "p_min_score": req.min_score,
            },
        ).execute()
        chunk_rows = chunk_resp.data or []
        print("[CTX] chunk RPC results: %d rows", len(chunk_rows))
        for row in chunk_rows:
            results.append(dict(
                source_type="chunk",
                title=row.get("material_title", ""),
                content=row.get("chunk_content", "")[:800],
                score=float(row.get("match_score", 0)),
                material_id=row.get("material_id", ""),
            ))
    except Exception as e:
        print("[CTX] chunk RPC error: %s", e)

    try:
        kp_resp = client.rpc(
            "search_kps_by_vector",
            {
                "p_query_embedding": query_emb,
                "p_kp_ids": req.kp_ids or None,
                "p_top_k": req.top_k,
                "p_min_score": req.min_score,
            },
        ).execute()
        kp_rows = kp_resp.data or []
        print("[CTX] kp RPC results: %d rows", len(kp_rows))
        for row in kp_rows:
            results.append(dict(
                source_type="knowledge_point",
                title=row.get("kp_name", ""),
                content=row.get("description") or row.get("kp_name", ""),
                score=float(row.get("match_score", 0)),
            ))
    except Exception as e:
        print("[CTX] kp RPC error: %s", e)

    results.sort(key=lambda r: r["score"], reverse=True)
    top = results[:req.top_k]

    if not top:
        print("[CTX] no results (min_score=%.2f)", req.min_score)
        return ""

    parts = []
    for r in top:
        label = "\u8d44\u6599\u7247\u6bb5" if r["source_type"] == "chunk" else "\u77e5\u8bc6\u70b9"
        line = "[%s] %s (\u76f8\u5173\u5ea6: %.0f%%)\n%s" % (label, r["title"], r["score"] * 100, r["content"])
        parts.append(line)

    context = "\n\n---\n".join(parts)
    print("[CTX] final: %d results, %d chars", len(top), len(context))
    return context
