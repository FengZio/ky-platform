"""
Relay Service --- Lightweight WebSocket message relay

Pure relay architecture:
  Browser WS (/api/learning/ws)  <-->  RelayManager  <-->  Local Agent WS (/api/learning/agent/ws)

Backend does ZERO AI inference. No vector search, no context injection.
Codex autonomously uses MCP tools (search_knowledge, search_materials) to query the vector DB.

Frontend context (selected material_ids, kp_ids) is passed through as metadata
so Codex can use it to narrow MCP searches.
"""

import asyncio
import json
import logging
import secrets
import string
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

AGENT_IDLE_TIMEOUT = 600
BROWSER_IDLE_TIMEOUT = 300
PAIRING_CODE_TTL = 300


@dataclass
class BrowserSession:
    ws: any
    pairing_code: str
    message_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    last_active: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class AgentSession:
    ws: any
    pairing_code: str
    message_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    last_active: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class PairingStore:
    """Manage one-time pairing codes"""

    def __init__(self):
        self._codes: dict[str, str] = {}
        self._code_created: dict[str, datetime] = {}

    def generate(self) -> str:
        while True:
            code = "-".join([
                "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4)),
                "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4)),
            ])
            if code not in self._codes:
                self._codes[code] = code
                self._code_created[code] = datetime.now(timezone.utc)
                return code

    def claim(self, code: str) -> bool:
        if code not in self._codes:
            return False
        created = self._code_created.get(code)
        if created and (datetime.now(timezone.utc) - created).total_seconds() > PAIRING_CODE_TTL:
            self._codes.pop(code, None)
            self._code_created.pop(code, None)
            return False
        return True

    def remove(self, code: str):
        self._codes.pop(code, None)
        self._code_created.pop(code, None)

    def cleanup_expired(self):
        now = datetime.now(timezone.utc)
        for code, created in list(self._code_created.items()):
            if (now - created).total_seconds() > PAIRING_CODE_TTL:
                self._codes.pop(code, None)
                self._code_created.pop(code, None)


class RelayManager:
    """Singleton: pair browser and agent by one-time pairing code"""

    def __init__(self):
        self._browsers: dict[str, BrowserSession] = {}
        self._agents: dict[str, AgentSession] = {}
        self._pairing = PairingStore()
        self._cleanup_task: Optional[asyncio.Task] = None

    @property
    def pairing(self) -> PairingStore:
        return self._pairing

    async def start_cleanup(self):
        if self._cleanup_task and not self._cleanup_task.done():
            return
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self):
        while True:
            await asyncio.sleep(60)
            now = datetime.now(timezone.utc)
            for code, session in list(self._browsers.items()):
                if (now - session.last_active).total_seconds() > BROWSER_IDLE_TIMEOUT:
                    await self._close_browser(code, "idle timeout")
            for code, session in list(self._agents.items()):
                if (now - session.last_active).total_seconds() > AGENT_IDLE_TIMEOUT:
                    await self._close_agent(code, "idle timeout")
            self._pairing.cleanup_expired()

    async def register_browser(self, ws) -> tuple[str, asyncio.Queue]:
        code = self._pairing.generate()
        session = BrowserSession(ws=ws, pairing_code=code)
        self._browsers[code] = session
        logger.info(f"Browser connected, pairing code: {code}")
        return code, session.message_queue

    async def register_agent(self, ws, code: str) -> Optional[asyncio.Queue]:
        if not self._pairing.claim(code):
            return None

        browser = self._browsers.get(code)
        if not browser:
            self._pairing.remove(code)
            return None

        old_agent = self._agents.pop(code, None)
        if old_agent:
            await self._close_ws(old_agent.ws)

        session = AgentSession(ws=ws, pairing_code=code)
        self._agents[code] = session
        self._pairing.remove(code)
        logger.info(f"Agent paired: {code}")

        await browser.message_queue.put({"type": "agent_connected"})
        return session.message_queue

    async def browser_to_agent(self, code: str, message: dict) -> bool:
        """Pure relay: pass message through, enrich with frontend context for MCP."""
        agent = self._agents.get(code)
        if not agent:
            return False
        agent.last_active = datetime.now(timezone.utc)

        if message.get("type") == "user_message":
            text = message.get("text", "")
            kp_ids = message.get("kp_ids", []) or []
            mat_ids = message.get("material_ids", []) or []

            if text.strip() and (kp_ids or mat_ids):
                # Pass frontend context as structured hint for Codex's MCP search
                hints = []
                if mat_ids:
                    hints.append("material_ids=" + ",".join(mat_ids[:10]))
                if kp_ids:
                    hints.append("kp_ids=" + ",".join(kp_ids[:10]))
                hint_text = "; ".join(hints)

                message = dict(message)
                message["text"] = (
                    "[前端上下文: " + hint_text + "]\n"
                    + text + "\n"
                    + "(你可以用 MCP 工具 search_materials 或 search_knowledge 在这些范围内搜索)"
                )
                logger.info("Relay: enriched with frontend context hints")

        await agent.message_queue.put(message)
        return True

    async def agent_to_browser(self, code: str, message: dict) -> bool:
        browser = self._browsers.get(code)
        if not browser:
            return False
        browser.last_active = datetime.now(timezone.utc)
        await browser.message_queue.put(message)
        return True

    async def remove_browser(self, code: str):
        browser = self._browsers.pop(code, None)
        if browser:
            agent = self._agents.get(code)
            if agent:
                await agent.message_queue.put({"type": "browser_disconnected"})
        logger.info(f"Browser disconnected: code={code}")

    async def remove_agent(self, code: str):
        agent = self._agents.pop(code, None)
        if agent:
            browser = self._browsers.get(code)
            if browser:
                await browser.message_queue.put({"type": "agent_disconnected"})
        logger.info(f"Agent disconnected: code={code}")

    async def _close_browser(self, code: str, reason: str):
        logger.info(f"Closing browser: code={code} reason={reason}")
        session = self._browsers.pop(code, None)
        if session:
            await self._close_ws(session.ws)
            self._pairing.remove(code)

    async def _close_agent(self, code: str, reason: str):
        logger.info(f"Closing agent: code={code} reason={reason}")
        session = self._agents.pop(code, None)
        if session:
            await self._close_ws(session.ws)
            browser = self._browsers.get(code)
            if browser:
                await browser.message_queue.put({
                    "type": "agent_disconnected",
                    "reason": reason,
                })

    @staticmethod
    async def _close_ws(ws) -> None:
        try:
            await ws.close()
        except Exception:
            pass


relay = RelayManager()
