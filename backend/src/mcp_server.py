"""
MCP Server for ky-platform — exposes vector search tools to Codex.

Implements Model Context Protocol (MCP) JSON-RPC 2.0 over stdio.
Codex spawns this process and communicates via stdin/stdout.

Tools:
  - search_knowledge: Semantic search on knowledge_points
  - search_materials: Semantic search on material_chunks  
  - get_chunk_detail: Get full content + metadata of a chunk

Usage:
  cd backend && python src/mcp_server.py
  (Codex manages lifecycle via .mcp.json)
"""

import asyncio
import json
import os
import sys
import logging
from typing import Any

# Ensure backend/ is on sys.path so rom src.* imports work
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [mcp] %(levelname)s %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("ky-mcp")

from src.services.supabase import get_admin
from src.services.embedding import get_embedding

SERVER_INFO = {
    "name": "ky-platform-search",
    "version": "1.0.0",
}

TOOLS = [
    {
        "name": "search_knowledge",
        "description": (
            "语义搜索知识库中的知识点。输入中文查询，返回最相关的知识点及其内容。"
            "适用于：用户询问某个知识点时，查找知识库中匹配的内容。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "中文搜索查询，例如 '什么是导数' 或 '线性代数矩阵运算'",
                },
                "top_k": {
                    "type": "integer",
                    "description": "返回结果数量，默认 5",
                    "default": 5,
                },
                "min_score": {
                    "type": "number",
                    "description": "最低相似度阈值 (0-1)，默认 0.3",
                    "default": 0.3,
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_materials",
        "description": (
            "语义搜索学习资料库（教材/习题/笔记的分块内容）。输入中文查询，"
            "返回最相关的资料片断及其出处。适用于：用户想查找相关习题、"
            "教材内容、或需要参考具体资料时。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "中文搜索查询",
                },
                "top_k": {
                    "type": "integer",
                    "description": "返回结果数量，默认 5",
                    "default": 5,
                },
                "min_score": {
                    "type": "number",
                    "description": "最低相似度阈值 (0-1)，默认 0.3",
                    "default": 0.3,
                },
                "knowledge_tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "可选的知识点标签过滤，如 ['导数', '微分']",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_chunk_detail",
        "description": (
            "获取指定分块的完整内容及其关联的学习资料信息。"
            "适用于：search_materials 返回了摘要后，需要查看完整内容时使用。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "chunk_id": {
                    "type": "string",
                    "description": "分块 UUID（从 search_materials 返回结果中获取）",
                },
            },
            "required": ["chunk_id"],
        },
    },
]


class McpServer:
    """Minimal MCP JSON-RPC 2.0 server over stdio."""

    def __init__(self):
        self._reader = None
        self._writer = None

    async def run(self):
        loop = asyncio.get_event_loop()
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)
        write_transport, write_protocol = await loop.connect_write_pipe(
            asyncio.BaseProtocol, sys.stdout
        )
        writer = asyncio.StreamWriter(write_transport, write_protocol, reader, loop)
        self._reader = reader
        self._writer = writer

        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                try:
                    msg = json.loads(text)
                except json.JSONDecodeError:
                    continue
                await self._handle_message(msg)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Server loop error: %s", e)

    async def _handle_message(self, msg: dict):
        msg_id = msg.get("id")
        method = msg.get("method", "")

        if msg_id is not None and method:
            try:
                result = await self._dispatch(method, msg.get("params", {}))
                await self._send_response(msg_id, result)
            except Exception as e:
                await self._send_error(msg_id, -32000, str(e))
        elif method:
            if method == "notifications/initialized":
                pass

    async def _dispatch(self, method: str, params: dict):
        if method == "initialize":
            return {
                "protocolVersion": "2024-11-05",
                "serverInfo": SERVER_INFO,
                "capabilities": {"tools": {}},
            }
        elif method == "tools/list":
            return {"tools": TOOLS}
        elif method == "tools/call":
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {})
            return await self._call_tool(tool_name, arguments)
        else:
            raise ValueError(f"Unknown method: {method}")

    async def _call_tool(self, name: str, args: dict) -> dict:
        if name == "search_knowledge":
            return await self._tool_search_knowledge(args)
        elif name == "search_materials":
            return await self._tool_search_materials(args)
        elif name == "get_chunk_detail":
            return await self._tool_get_chunk_detail(args)
        else:
            raise ValueError(f"Unknown tool: {name}")

    async def _tool_search_knowledge(self, args: dict) -> dict:
        query = args.get("query", "")
        top_k = int(args.get("top_k", 5))
        min_score = float(args.get("min_score", 0.3))

        if not query.strip():
            return {"content": [{"type": "text", "text": "错误：查询不能为空"}]}

        try:
            query_emb = await get_embedding(query)
        except Exception as e:
            return {"content": [{"type": "text", "text": f"Embedding 失败: {e}"}]}

        client = get_admin()
        try:
            resp = client.rpc(
                "search_kps_by_vector",
                {
                    "p_query_embedding": query_emb,
                    "p_user_id": None,
                    "p_kp_ids": None,
                    "p_top_k": top_k,
                    "p_min_score": min_score,
                },
            ).execute()
            rows = resp.data or []
        except Exception as e:
            return {"content": [{"type": "text", "text": f"搜索失败: {e}"}]}

        if not rows:
            return {"content": [{"type": "text", "text": "未找到匹配的知识点。"}]}

        lines = []
        for i, row in enumerate(rows, 1):
            name = row.get("kp_name", "")
            desc = row.get("description", "")
            score = float(row.get("match_score", 0))
            lines.append(f"{i}. **{name}** (相关度 {score:.0%})")
            if desc:
                lines.append(f"   {desc[:500]}")

        return {"content": [{"type": "text", "text": "\n\n".join(lines)}]}

    async def _tool_search_materials(self, args: dict) -> dict:
        query = args.get("query", "")
        top_k = int(args.get("top_k", 5))
        min_score = float(args.get("min_score", 0.3))
        tags = args.get("knowledge_tags")

        if not query.strip():
            return {"content": [{"type": "text", "text": "错误：查询不能为空"}]}

        try:
            query_emb = await get_embedding(query)
        except Exception as e:
            return {"content": [{"type": "text", "text": f"Embedding 失败: {e}"}]}

        client = get_admin()
        try:
            if tags:
                resp = client.rpc(
                    "search_chunks_hybrid",
                    {
                        "p_query_embedding": query_emb,
                        "p_user_id": None,
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
                        "p_user_id": None,
                        "p_material_ids": None,
                        "p_top_k": top_k,
                        "p_min_score": min_score,
                    },
                ).execute()
            rows = resp.data or []
        except Exception as e:
            return {"content": [{"type": "text", "text": f"搜索失败: {e}"}]}

        if not rows:
            return {"content": [{"type": "text", "text": "未找到匹配的资料片断。"}]}

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

        return {"content": [{"type": "text", "text": "\n\n---\n".join(lines)}]}

    async def _tool_get_chunk_detail(self, args: dict) -> dict:
        chunk_id = args.get("chunk_id", "")
        if not chunk_id:
            return {"content": [{"type": "text", "text": "错误：chunk_id 不能为空"}]}

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
            return {"content": [{"type": "text", "text": f"查询分块失败: {e}"}]}

        if not row:
            return {"content": [{"type": "text", "text": "未找到该分块。"}]}

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
        return {"content": [{"type": "text", "text": "\n".join(lines)}]}

    async def _send_response(self, msg_id, result):
        self._write({"jsonrpc": "2.0", "id": msg_id, "result": result})

    async def _send_error(self, msg_id, code: int, message: str):
        self._write({"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}})

    def _write(self, payload: dict):
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        self._writer.write(line.encode("utf-8"))


def main():
    server = McpServer()
    asyncio.run(server.run())


if __name__ == "__main__":
    main()
