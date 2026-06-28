import logging
from pydantic import BaseModel
from src.services.embedding import get_embedding
from src.services.supabase import get_admin

logger = logging.getLogger(__name__)

_SUBJECT_ROUTES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("数学", ("数学", "高数", "线代", "概率", "极限", "导数", "微分", "积分", "矩阵", "行列式")),
    ("408", ("408", "计算机", "数据结构", "计组", "组成原理", "操作系统", "os", "计网", "网络", "二叉树", "链表", "排序", "进程", "线程", "内存")),
    ("英语", ("英语", "阅读", "作文", "翻译", "完形", "词汇", "长难句")),
    ("政治", ("政治", "马原", "毛概", "史纲", "思修", "时政")),
)

_SUBJECT_NAME_ALIASES: dict[str, tuple[str, ...]] = {
    "数学": ("数学", "高数", "线代", "概率"),
    "408": ("408", "计算机", "数据结构", "计组", "操作系统", "计网"),
    "英语": ("英语",),
    "政治": ("政治",),
}


class ContextRequest(BaseModel):
    message: str
    kp_ids: list[str] = []
    material_ids: list[str] = []
    subject_id: str = ""
    top_k: int = 5
    min_score: float = 0.3


def _subject_matches_label(subject_name: str, label: str) -> bool:
    name = (subject_name or "").lower()
    return any(alias.lower() in name for alias in _SUBJECT_NAME_ALIASES.get(label, (label,)))


def _infer_subject_id(message: str) -> str | None:
    try:
        resp = get_admin().table("subjects").select("id,name").execute()
        subjects = resp.data or []
    except Exception as e:
        print("[CTX] subject route load fail: %s", e)
        return None

    q = (message or "").lower()
    direct_matches = [
        s for s in subjects
        if s.get("name") and s["name"].lower() in q
    ]
    if len(direct_matches) == 1:
        return direct_matches[0].get("id")

    matched_labels = [
        label for label, keywords in _SUBJECT_ROUTES
        if any(keyword.lower() in q for keyword in keywords)
    ]
    if len(matched_labels) != 1:
        return None

    candidates = [
        s for s in subjects
        if s.get("id") and _subject_matches_label(s.get("name", ""), matched_labels[0])
    ]
    if len(candidates) == 1:
        return candidates[0].get("id")
    return None


def _is_missing_rpc_signature_error(err: Exception) -> bool:
    text = str(err).lower()
    return "does not exist" in text or "could not find the function" in text


def _rpc_with_subject_fallback(client, rpc_name: str, payload: dict):
    try:
        return client.rpc(rpc_name, payload).execute()
    except Exception as e:
        if not payload.get("p_subject_id") or not _is_missing_rpc_signature_error(e):
            raise
        fallback_payload = dict(payload)
        fallback_payload.pop("p_subject_id", None)
        print(f"[CTX] {rpc_name} fallback to legacy signature")
        return client.rpc(rpc_name, fallback_payload).execute()


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
    subject_id = req.subject_id or _infer_subject_id(req.message)
    if subject_id:
        print("[CTX] subject route: %s", subject_id)

    try:
        chunk_resp = _rpc_with_subject_fallback(
            client,
            "search_chunks_by_vector",
            {
                "p_query_embedding": query_emb,
                "p_material_ids": req.material_ids or None,
                "p_top_k": req.top_k * 2,
                "p_min_score": req.min_score,
                "p_subject_id": subject_id,
            },
        )
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
        kp_resp = _rpc_with_subject_fallback(
            client,
            "search_kps_by_vector",
            {
                "p_query_embedding": query_emb,
                "p_kp_ids": req.kp_ids or None,
                "p_top_k": req.top_k,
                "p_min_score": req.min_score,
                "p_subject_id": subject_id,
            },
        )
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
