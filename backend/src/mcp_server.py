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
import json
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

from src.services.supabase import get_admin
from src.services.embedding import get_embedding

SERVER_INFO = {
    "name": "ky-platform-search",
    "version": "1.0.0",
}

server = Server("ky-platform-search")

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

    if not query.strip():
        return [mcp_types.TextContent(type="text", text="错误：查询不能为空")]

    try:
        query_emb = await get_embedding(query)
    except Exception as e:
        return [mcp_types.TextContent(type="text", text=f"Embedding 失败: {e}")]

    client = get_admin()
    try:
        resp = client.rpc(
            "search_kps_by_vector",
            {
                "p_query_embedding": query_emb,
                "p_kp_ids": None,
                "p_top_k": top_k,
                "p_min_score": min_score,
            },
        ).execute()
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

    if not query.strip():
        return [mcp_types.TextContent(type="text", text="错误：查询不能为空")]

    try:
        query_emb = await get_embedding(query)
    except Exception as e:
        return [mcp_types.TextContent(type="text", text=f"Embedding 失败: {e}")]

    client = get_admin()
    try:
        if tags:
            resp = client.rpc(
                "search_chunks_hybrid",
                {
                    "p_query_embedding": query_emb,
                    "p_knowledge_tags": tags,
                    "p_material_ids": None,
                    "p_top_k": top_k,
                    "p_min_score": min_score,
                },
            ).execute()
        else:
            resp = client.rpc(
                "search_chunks_by_vector",
                {
                    "p_query_embedding": query_emb,
                    "p_material_ids": None,
                    "p_top_k": top_k,
                    "p_min_score": min_score,
                },
            ).execute()
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

    client = get_admin()
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
