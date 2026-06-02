import logging
import math
from pydantic import BaseModel
from src.services.embedding import get_embedding
from src.services.supabase import get_admin

logger = logging.getLogger(__name__)


class ContextRequest(BaseModel):
    message: str
    kp_ids: list[str] = []
    material_ids: list[str] = []
    top_k: int = 5


def cosine_similarity(a, b):
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _parse_embedding(emb):
    """Parse embedding from string or list format."""
    if emb is None:
        return None
    if isinstance(emb, list):
        return [float(x) for x in emb]
    if isinstance(emb, str):
        import re
        try:
            return [float(x) for x in re.findall(r'-?[\d.]+(?:e[+-]?\d+)?', emb)]
        except Exception:
            return None
    return None


async def search_vector_context(req: ContextRequest) -> str:
    print("[CTX] search: msg_len=%d mat_ids=%d kp_ids=%d",
                len(req.message), len(req.material_ids), len(req.kp_ids))

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

    # Material chunks (global or filtered)
    try:
        q = (
            client.table("material_chunks")
            .select("id, content, embedding, material_id")
            .not_.is_("embedding", "null")
        )
        if req.material_ids:
            q = q.in_("material_id", req.material_ids)
        resp = q.limit(200).execute()
        rows = resp.data or []
        print("[CTX] chunks: %d rows", len(rows))

        dim_mismatch = 0
        sample_checked = 0
        sample_scores = []
        for row in rows:
            emb = _parse_embedding(row.get("embedding"))
            if emb is None or len(emb) == 0:
                continue
            if dim_mismatch == 0 and sample_checked == 0:
                print("[CTX] first chunk emb parsed: len=%d sample=%s", len(emb), str(emb[:3]))
                sample_checked += 1
            if len(query_emb) != len(emb):
                dim_mismatch += 1
                if dim_mismatch <= 3:
                    print("[CTX] DIM: query=%d stored=%d", len(query_emb), len(emb))
                continue
            score = cosine_similarity(query_emb, emb)
            if score >= 0.4:
                results.append(dict(source_type="chunk", title="", content=row.get("content", ""),
                                    score=score, material_id=row.get("material_id", "")))

        if dim_mismatch:
            print("[CTX] dim mismatches: %d/%d", dim_mismatch, len(rows))
        if sample_scores:
            print("[CTX] sample scores (first 5): %s", [round(s, 4) for s in sample_scores[:5]])

        # Fetch titles
        mids = set(r["material_id"] for r in results)
        if mids:
            tr = client.table("learning_materials").select("id,title").in_("id", list(mids)).execute()
            tm = {r["id"]: r.get("title", "") for r in (tr.data or [])}
            for r in results:
                r["title"] = tm.get(r["material_id"], "")

        print("[CTX] chunk matches: %d", len(results))
    except Exception as e:
        print("[CTX] chunk error: %s", e, exc_info=True)

    # Knowledge points (global or filtered)
    try:
        q = (
            client.table("knowledge_points")
            .select("id, name, description, embedding")
            .not_.is_("embedding", "null")
        )
        if req.kp_ids:
            q = q.in_("id", req.kp_ids)
        resp = q.limit(100).execute()
        rows = resp.data or []
        print("[CTX] kp: %d rows", len(rows))

        for row in rows:
            emb = _parse_embedding(row.get("embedding"))
            if emb is None or len(emb) == 0:
                continue
            if len(query_emb) != len(emb):
                continue
            score = cosine_similarity(query_emb, emb)
            if score >= 0.4:
                results.append(dict(source_type="knowledge_point", title=row.get("name", ""),
                                    content=row.get("description") or row.get("name", ""), score=score))
    except Exception as e:
        print("[CTX] kp error: %s", e, exc_info=True)

    results.sort(key=lambda r: r["score"], reverse=True)
    top = results[:req.top_k]

    if not top:
        print("[CTX] no results (threshold=0.4)")
        return ""

    parts = []
    for r in top:
        label = "资料片段" if r["source_type"] == "chunk" else "知识点"
        parts.append("[%s] %s (相关度: %.0f%%)\n%s" % (label, r["title"], r["score"] * 100, r["content"][:800]))

    context = "\n\n---\n".join(parts)
    print("[CTX] final: %d results, %d chars", len(top), len(context))
    return context
