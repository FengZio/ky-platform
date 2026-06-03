import asyncio
import json
import logging
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect

from src.services.codex_service import CodexService

logger = logging.getLogger(__name__)


class LearningSession:
    """Manages a single user's learning session, wrapping a CodexService instance."""

    def __init__(self):
        self.codex: Optional[CodexService] = None
        self.thread_id: str = ""
        self.connected = False
        self._message_queue: asyncio.Queue = asyncio.Queue()
        self._turn_active = False
        self._assistant_text_parts: list = []

    async def start(self, workspace_root: str = "") -> dict:
        if self.codex:
            await self.codex.close()

        self.codex = CodexService()
        await self.codex.connect()
        await self.codex.initialize()
        self.codex.set_system_prompt(
            "你必须始终用中文回复。你是考研全科辅导老师，覆盖："
            "数学（高数/线代/概率论）、408计算机（数据结构/计组/OS/计网）、英语、政治。"
            "可以讲解知识点、分析题型、制定复习计划、答疑解惑。"
            "你有 MCP 搜索工具可用："
            "search_knowledge(语义搜索知识点)、"
            "search_materials(语义搜索学习资料)、"
            "get_chunk_detail(查看资料详细内容)。"
            "用户消息中的[前端上下文]包含用户当前勾选的资料和知识点范围，"
            "请在搜索时传入 material_ids 或 knowledge_tags 参数以精准命中。"
            "所有回复必须使用中文，禁止使用英文回复。"
            "当输出选择题/习题时，严格使用以下试卷格式：1) 题号. 题目内容( )。 2) 空一行后依次列出选项，每项格式为「A. 选项内容」（选项间也空一行）。 示例：22. 引入线索二叉树的目的是()。\n\nA. 加快查找前驱/后继\n\nB. 方便插入删除\n\nC. 方便找双亲\n\nD. 遍历结果唯一 其他内容的回复使用 Markdown 格式，保证结构清晰。"
        )

        self.codex.add_message_listener(self._on_codex_message)

        result = await self.codex.start_thread(cwd=workspace_root or "")
        thread_data = result if isinstance(result, dict) else {}
        self.thread_id = thread_data.get("id", "") or thread_data.get("threadId", "")
        self.connected = True
        logger.info(f"Learning session started, thread_id={self.thread_id}")
        return {"thread_id": self.thread_id, "status": "connected"}

    async def send_message(self, text: str) -> None:
        if not self.codex or not self.thread_id:
            raise RuntimeError("Session not started")
        self._turn_active = True
        self._assistant_text_parts = []
        await self.codex.send_user_message(
            thread_id=self.thread_id,
            text=text,
        )

    async def _on_codex_message(self, message: dict) -> None:
        method = message.get("method", "")
        params = message.get("params", {})

        # --- Codex v2 event handling (new method names) ---

        # item/started: track current item type
        if method == "item/started":
            item = params.get("item", {})
            item_type = item.get("type", "")
            if item_type == "agentMessage":
                self._assistant_text_parts = []
            return

        # item/agentMessage/delta: accumulate text chunks
        if method == "item/agentMessage/delta":
            delta = params.get("delta", {})
            if isinstance(delta, dict):
                text = delta.get("text", "")
                if text:
                    self._assistant_text_parts.append(text)
            else:
                text = params.get("text", "")
                if isinstance(text, str) and text:
                    self._assistant_text_parts.append(text)
            return

        # item/completed: finalize and emit
        if method == "item/completed":
            item = params.get("item", {})
            item_type = item.get("type", "")
            if item_type == "agentMessage" and self._assistant_text_parts:
                text = "".join(self._assistant_text_parts)
                await self._message_queue.put({
                    "type": "assistant_chunk",
                    "text": text,
                    "item_id": item.get("id", ""),
                })
                self._assistant_text_parts = []
            elif item_type == "error":
                error_text = ""
                content = item.get("content", [])
                if isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            error_text = part.get("text", "")
                if error_text:
                    logger.error(f"Codex error item: {error_text[:300]}")
            return

        # --- Codex v1 compat ---
        if method == "turn/completed":
            self._turn_active = False
            await self._message_queue.put({"type": "turn_completed"})

        elif method == "turn/failed":
            self._turn_active = False
            error_text = params.get("error", "Unknown error")
            if isinstance(error_text, dict):
                error_text = error_text.get("message", str(error_text))
            await self._message_queue.put({
                "type": "error",
                "text": str(error_text),
            })

        elif method == "turn/started":
            await self._message_queue.put({
                "type": "turn_started",
                "turn_id": params.get("turnId", ""),
            })


    def _extract_text_from_item(self, item: dict) -> str:
        content = item.get("content", [])
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict):
                    part_type = part.get("type", "")
                    if part_type in ("thinking", "reasoning"):
                        logger.info("[DEBUG_FILTER] Content part filtered: type=%s", part_type)
                        continue
                    if part_type in ("text", "output_text"):
                        text_val = part.get("text", "")
                        if text_val:
                            logger.info("[DEBUG_TEXT] type=%s len=%d preview=%s", part_type, len(text_val), text_val[:120])
                        parts.append(text_val)
                elif isinstance(part, str):
                    parts.append(part)
            result = "".join(parts)
            if result:
                logger.info("[DEBUG_RESULT] extracted %d chars, preview=%s", len(result), result[:200])
            return result
        return ""

    async def receive(self) -> Optional[dict]:
        try:
            return await asyncio.wait_for(self._message_queue.get(), timeout=30.0)
        except asyncio.TimeoutError:
            return {"type": "heartbeat"}

    async def close(self) -> None:
        self.connected = False
        if self.codex:
            await self.codex.close()
            self.codex = None


class LearningSessionManager:
    """Singleton manager for learning sessions."""

    def __init__(self):
        self._sessions: dict[str, LearningSession] = {}

    def get_or_create(self, user_id: str) -> LearningSession:
        if user_id not in self._sessions:
            self._sessions[user_id] = LearningSession()
        return self._sessions[user_id]

    async def remove(self, user_id: str) -> None:
        session = self._sessions.pop(user_id, None)
        if session:
            await session.close()

    async def close_all(self) -> None:
        for session in list(self._sessions.values()):
            await session.close()
        self._sessions.clear()


session_manager = LearningSessionManager()
