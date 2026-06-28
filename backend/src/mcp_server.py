"""
MCP Server for ky-platform — exposes vector search tools to Codex.

Uses the mcp library for cross-platform stdio transport.
Codex spawns this process and communicates via stdin/stdout.

Tools:
  - search_knowledge: Semantic search on knowledge_points
  - search_materials: Semantic search on material_chunks  
  - get_chunk_detail: Get full content + metadata of a chunk
"""

import asyncio
import os
import sys
import logging
from typing import Any

# Ensure backend/ is on sys.path so from src.* imports work
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [mcp] %(levelname)s %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("ky-mcp")

from mcp.server.lowlevel.server import Server
from mcp.server.stdio import stdio_server
from mcp import types as mcp_types

from src.services.supabase import get_ai_config_for_client, get_user_client
from src.services.embedding import get_embedding

SERVER_INFO = {
    "name": "ky-platform-search",
    "version": "1.0.0",
}

server = Server("ky-platform-search")

_user_client = None

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


def _load_subjects() -> list[dict[str, str]]:
    try:
        resp = _get_user_client().table("subjects").select("id,name").execute()
        return resp.data or []
    except Exception as e:
        logger.warning("load subjects failed: %s", e)
        return []


def _get_user_client():
    global _user_client
    if _user_client is None:
        token = os.getenv("SUPABASE_ACCESS_TOKEN", "").strip()
        _user_client = get_user_client(token)
    return _user_client


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
        logger.warning("%s fallback to legacy signature without subject_id", rpc_name)
        return client.rpc(rpc_name, fallback_payload).execute()


async def _get_query_embedding(query: str) -> list[float]:
    cfg = await get_ai_config_for_client(_get_user_client())

    old_api_key = os.environ.get("OPENAI_API_KEY")
    old_base_url = os.environ.get("OPENAI_BASE_URL")
    old_model = os.environ.get("EMBEDDING_MODEL")

    try:
        os.environ["OPENAI_API_KEY"] = cfg.get("api_key", "") or ""
        os.environ["OPENAI_BASE_URL"] = cfg.get("base_url", "") or ""
        os.environ["EMBEDDING_MODEL"] = cfg.get("embed_model", "") or ""
        return await get_embedding(query)
    finally:
        if old_api_key is None:
            os.environ.pop("OPENAI_API_KEY", None)
        else:
            os.environ["OPENAI_API_KEY"] = old_api_key

        if old_base_url is None:
            os.environ.pop("OPENAI_BASE_URL", None)
        else:
            os.environ["OPENAI_BASE_URL"] = old_base_url

        if old_model is None:
            os.environ.pop("EMBEDDING_MODEL", None)
        else:
            os.environ["EMBEDDING_MODEL"] = old_model


def _subject_matches_label(subject_name: str, label: str) -> bool:
    name = (subject_name or "").lower()
    return any(alias.lower() in name for alias in _SUBJECT_NAME_ALIASES.get(label, (label,)))


def _infer_subject_id(query: str) -> str | None:
    """Infer a subject UUID from query keywords. Ambiguous matches intentionally fall back to full search."""
    subjects = _load_subjects()
    if not subjects:
        return None

    q = (query or "").lower()
    candidates: dict[str, str] = {}

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

    label = matched_labels[0]
    for subject in subjects:
        sid = subject.get("id")
        name = subject.get("name", "")
        if sid and _subject_matches_label(name, label):
            candidates[sid] = name

    if len(candidates) == 1:
        return next(iter(candidates))
    return None

# ============================================================
# Tool definitions
# ============================================================

@server.list_tools()
async def list_tools() -> list[mcp_types.Tool]:
    return [
        mcp_types.Tool(
            name="search_knowledge",
            description="语义搜索知识库中的知识点。输入中文查询，返回最相关的知识点及其内容。适用于：用户询问某个知识点时，查找知识库中匹配的内容。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "中文搜索查询"},
                    "top_k": {"type": "integer", "description": "返回结果数量，默认5"},
                    "min_score": {"type": "number", "description": "最低匹配度阈值(0-1)，默认0.3"},
                    "subject_id": {"type": "string", "description": "可选：限定搜索的学科 UUID；不传时会按查询关键词自动尝试路由"},
                },
                "required": ["query"],
            },
        ),
        mcp_types.Tool(
            name="search_materials",
            description="语义搜索资料库中的资料片断。输入中文查询，返回最相关的资料片断。支持按知识点标签过滤。适用于：用户想查找某个主题相关的学习资料。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "中文搜索查询"},
                    "top_k": {"type": "integer", "description": "返回结果数量，默认5"},
                    "min_score": {"type": "number", "description": "最低匹配度阈值(0-1)，默认0.3"},
                    "knowledge_tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "按知识点标签过滤",
                    },
                    "subject_id": {"type": "string", "description": "可选：限定搜索的学科 UUID；不传时会按查询关键词自动尝试路由"},
                },
                "required": ["query"],
            },
        ),
        mcp_types.Tool(
            name="get_chunk_detail",
            description="获取某个资料片断的完整内容和元数据。输入 chunk_id，返回该片断的详细信息。",
            inputSchema={
                "type": "object",
                "properties": {
                    "chunk_id": {"type": "string", "description": "资料片断的唯一标识"},
                },
                "required": ["chunk_id"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[mcp_types.TextContent]:
    if name == "search_knowledge":
        return await _tool_search_knowledge(arguments)
    elif name == "search_materials":
        return await _tool_search_materials(arguments)
    elif name == "get_chunk_detail":
        return await _tool_get_chunk_detail(arguments)
    else:
        raise ValueError(f"Unknown tool: {name}")


# ============================================================
# Tool implementations
# ============================================================

async def _tool_search_knowledge(args: dict) -> list[mcp_types.TextContent]:
    query = args.get("query", "")
    top_k = int(args.get("top_k", 5))
    min_score = float(args.get("min_score", 0.3))
    subject_id = args.get("subject_id") or None

    if not query.strip():
        return [mcp_types.TextContent(type="text", text="错误：查询不能为空")]
    if not subject_id:
        subject_id = _infer_subject_id(query)

    try:
        query_emb = await _get_query_embedding(query)
    except Exception as e:
        return [mcp_types.TextContent(type="text", text=f"Embedding 失败: {e}")]

    client = _get_user_client()
    try:
        resp = _rpc_with_subject_fallback(
            client,
            "search_kps_by_vector",
            {
                "p_query_embedding": query_emb,
                "p_kp_ids": None,
                "p_top_k": top_k,
                "p_min_score": min_score,
                "p_subject_id": subject_id,
            },
        )
        rows = resp.data or []
    except Exception as e:
        return [mcp_types.TextContent(type="text", text=f"搜索失败: {e}")]

    if not rows:
        return [mcp_types.TextContent(type="text", text="未找到匹配的知识点。")]

    lines = []
    for i, row in enumerate(rows, 1):
        name = row.get("kp_name", "")
        desc = row.get("description", "")
        score = float(row.get("match_score", 0))
        lines.append(f"{i}. **{name}** (相关度 {score:.0%})")
        if desc:
            lines.append(f"   {desc[:500]}")

    return [mcp_types.TextContent(type="text", text="\n\n".join(lines))]


async def _tool_search_materials(args: dict) -> list[mcp_types.TextContent]:
    query = args.get("query", "")
    top_k = int(args.get("top_k", 5))
    min_score = float(args.get("min_score", 0.3))
    tags = args.get("knowledge_tags")
    subject_id = args.get("subject_id") or None

    if not query.strip():
        return [mcp_types.TextContent(type="text", text="错误：查询不能为空")]
    if not subject_id:
        subject_id = _infer_subject_id(query)

    try:
        query_emb = await _get_query_embedding(query)
    except Exception as e:
        return [mcp_types.TextContent(type="text", text=f"Embedding 失败: {e}")]

    client = _get_user_client()
    try:
        if tags:
            resp = _rpc_with_subject_fallback(
                client,
                "search_chunks_hybrid",
                {
                    "p_query_embedding": query_emb,
                    "p_knowledge_tags": tags,
                    "p_material_ids": None,
                    "p_top_k": top_k,
                    "p_min_score": min_score,
                    "p_subject_id": subject_id,
                },
            )
        else:
            resp = _rpc_with_subject_fallback(
                client,
                "search_chunks_by_vector",
                {
                    "p_query_embedding": query_emb,
                    "p_material_ids": None,
                    "p_top_k": top_k,
                    "p_min_score": min_score,
                    "p_subject_id": subject_id,
                },
            )
        rows = resp.data or []
    except Exception as e:
        return [mcp_types.TextContent(type="text", text=f"搜索失败: {e}")]

    if not rows:
        return [mcp_types.TextContent(type="text", text="未找到匹配的资料片断。")]

    lines = []
    for i, row in enumerate(rows, 1):
        title = row.get("material_title", "未知")
        content = row.get("chunk_content", "")
        score = float(row.get("match_score", 0))
        chunk_id = row.get("chunk_id", "")
        method = row.get("match_method", "vector_only")
        method_label = "标签匹配" if method == "tag_vector" else "向量"

        lines.append(
            f"{i}. **{title}** [{method_label}] (相关度 {score:.0%})\n"
            f"   chunk_id: {chunk_id}\n"
            f"   {content[:400]}"
        )

    return [mcp_types.TextContent(type="text", text="\n\n---\n".join(lines))]


async def _tool_get_chunk_detail(args: dict) -> list[mcp_types.TextContent]:
    chunk_id = args.get("chunk_id", "")
    if not chunk_id:
        return [mcp_types.TextContent(type="text", text="错误：chunk_id 不能为空")]

    client = _get_user_client()
    try:
        resp = (
            client.table("material_chunks")
            .select("id, content, chunk_index, knowledge_points, chunk_type, material_id, learning_materials!inner(title, type)")
            .eq("id", chunk_id)
            .single()
            .execute()
        )
        row = resp.data
    except Exception as e:
        return [mcp_types.TextContent(type="text", text=f"查询分块失败: {e}")]

    if not row:
        return [mcp_types.TextContent(type="text", text="未找到该分块。")]

    material = row.get("learning_materials", {}) or {}
    content = row.get("content", "")
    kps = row.get("knowledge_points", []) or []
    chunk_type = row.get("chunk_type", "")

    lines = [
        f"**资料**: {material.get('title', '未知')}",
        f"**类型**: {chunk_type or material.get('type', '未知')}",
        f"**分块序号**: {row.get('chunk_index', '?')}",
        f"**关联知识点**: {', '.join(kps) if kps else '无'}",
        "",
        "---",
        "",
        content,
    ]
    return [mcp_types.TextContent(type="text", text="\n".join(lines))]


# ============================================================
# Entry point
# ============================================================

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    asyncio.run(main())
