import asyncio
import json
import os
import subprocess
import sys
import logging
from asyncio import StreamReader, StreamWriter
from typing import Optional

logger = logging.getLogger(__name__)

IS_WINDOWS = sys.platform == "win32"
DEFAULT_CODEX_COMMAND = "codex"

CLIENT_INFO = {
    "name": "ky_platform_agent",
    "title": "考研AI助手 Agent",
    "version": "0.1.0",
}


class CodexService:
    """
    Manages a spawned codex app-server child process and communicates with it
    via JSON-RPC over stdio (same pattern as the cyberboss CodexRpcClient).

    Usage::

        svc = CodexService()
        await svc.connect()
        await svc.initialize()
        result = await svc.start_thread(cwd=os.getcwd())
        thread_id = result.get("result", {}).get("id") or result.get("id")
        turn = await svc.send_user_message(thread_id=thread_id, text="Hello")
        # Listen for assistant responses via add_message_listener
        await svc.close()
    """

    def __init__(self, endpoint: Optional[str] = None, codex_command: Optional[str] = None):
        self.endpoint = endpoint
        self.codex_command = codex_command or DEFAULT_CODEX_COMMAND
        self.mode = "endpoint" if endpoint else "spawn"
        self.process: Optional[subprocess.Popen] = None
        self.reader: Optional[StreamReader] = None
        self.writer: Optional[StreamWriter] = None
        self.is_ready = False
        self._pending: dict[int, asyncio.Future] = {}
        self._request_id = 0
        self._read_task: Optional[asyncio.Task] = None
        self._message_listeners: list = []
        self._lock = asyncio.Lock()
        self._system_prompt: str = ""

    def add_message_listener(self, listener):
        self._message_listeners.append(listener)

    def remove_message_listener(self, listener):
        if listener in self._message_listeners:
            self._message_listeners.remove(listener)

    def set_system_prompt(self, prompt: str) -> None:
        """Set a system prompt that will be prepended to every user message."""
        self._system_prompt = prompt

    async def connect(self) -> None:
        if self.mode == "spawn":
            await self._connect_spawn()
        else:
            raise NotImplementedError("WebSocket endpoint mode not implemented yet")

    async def _connect_spawn(self) -> None:
        candidates = self._build_command_candidates()
        last_error = None

        for cmd in candidates:
            try:
                self.process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env={**os.environ},
                    shell=False,
                )
                break
            except (FileNotFoundError, OSError) as e:
                last_error = e
                continue

        if not self.process:
            attempted = ", ".join(" ".join(c) for c in candidates)
            raise RuntimeError(
                f"Unable to spawn codex app-server. Tried: {attempted}. "
                f"Last error: {last_error}"
            )

        loop = asyncio.get_event_loop()
        self.reader = asyncio.StreamReader()
        reader_protocol = asyncio.StreamReaderProtocol(self.reader)
        await loop.connect_read_pipe(lambda: reader_protocol, self.process.stdout)

        write_transport, write_protocol = await loop.connect_write_pipe(
            asyncio.BaseProtocol, self.process.stdin
        )
        self.writer = asyncio.StreamWriter(write_transport, write_protocol, self.reader, loop)

        self._read_task = asyncio.create_task(self._read_loop())
        asyncio.create_task(self._read_stderr())

        logger.info("Codex app-server spawned successfully")

    async def _read_stderr(self) -> None:
        try:
            while self.process and self.process.stderr:
                line = await asyncio.get_event_loop().run_in_executor(
                    None, self.process.stderr.readline
                )
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if text:
                    logger.debug(f"[codex stderr] {text}")
        except Exception:
            pass

    async def _read_loop(self) -> None:
        try:
            while self.reader:
                line = await self.reader.readline()
                if not line:
                    logger.warning("Codex stdout closed")
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                await self._handle_incoming(text)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in codex read loop: {e}")

    async def _handle_incoming(self, text: str) -> None:
        try:
            message = json.loads(text)
        except json.JSONDecodeError:
            logger.debug(f"Non-JSON codex output: {text[:200]}")
            return

        # Response to a pending request
        if "id" in message and "method" not in message:
            req_id = message["id"]
            future = self._pending.pop(req_id, None)
            if future and not future.done():
                if "error" in message:
                    future.set_exception(RuntimeError(str(message["error"])))
                else:
                    future.set_result(message.get("result", message))
            return

        # Notification or server-initiated message
        for listener in self._message_listeners:
            try:
                if asyncio.iscoroutinefunction(listener):
                    await listener(message)
                else:
                    listener(message)
            except Exception:
                pass

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    async def _send_request(self, method: str, params: Optional[dict] = None) -> dict:
        async with self._lock:
            req_id = self._next_id()
            payload = {
                "jsonrpc": "2.0",
                "id": req_id,
                "method": method,
                "params": params or {},
            }
            future: asyncio.Future = asyncio.get_event_loop().create_future()
            self._pending[req_id] = future

            line = json.dumps(payload, ensure_ascii=False) + "\n"
            self.writer.write(line.encode("utf-8"))
            await self.writer.drain()

            try:
                result = await asyncio.wait_for(future, timeout=120.0)
                return result
            except asyncio.TimeoutError:
                self._pending.pop(req_id, None)
                raise RuntimeError(f"Codex RPC timeout for method: {method}")

    async def _send_notification(self, method: str, params: Optional[dict] = None) -> None:
        async with self._lock:
            payload = {
                "jsonrpc": "2.0",
                "method": method,
                "params": params or {},
            }
            line = json.dumps(payload, ensure_ascii=False) + "\n"
            self.writer.write(line.encode("utf-8"))
            await self.writer.drain()

    async def initialize(self) -> dict:
        if self.is_ready:
            return {"status": "already_ready"}
        result = await self._send_request("initialize", {
            "clientInfo": CLIENT_INFO,
            "capabilities": {"experimentalApi": True},
        })
        await self._send_notification("initialized", {})
        self.is_ready = True
        logger.info(f"Codex initialized: {json.dumps(result, ensure_ascii=False)[:200]}")
        return result

    async def start_thread(self, cwd: str = "", model: str = "", model_provider: str = "") -> dict:
        params = {}
        if cwd:
            params["cwd"] = cwd
        if model:
            params["model"] = model
        if model_provider:
            params["modelProvider"] = model_provider
        return await self._send_request("thread/start", params)

    async def resume_thread(self, thread_id: str, model: str = "", model_provider: str = "") -> dict:
        params = {"threadId": thread_id}
        if model:
            params["model"] = model
        if model_provider:
            params["modelProvider"] = model_provider
        return await self._send_request("thread/resume", params)

    async def send_user_message(
        self,
        thread_id: str,
        text: str,
        attachments: Optional[list] = None,
        model: str = "",
        model_provider: str = "",
        workspace_root: str = "",
    ) -> dict:
        input_parts = []
        if text.strip():
            if self._system_prompt:
                input_parts.append({"type": "text", "text": self._system_prompt + "\n\n" + text})
            else:
                input_parts.append({"type": "text", "text": text})
        for att in (attachments or []):
            if att.get("type") == "localImage" and att.get("path"):
                input_parts.append({"type": "localImage", "path": att["path"]})

        params = {"threadId": thread_id, "input": input_parts}
        if workspace_root:
            params["cwd"] = workspace_root
        if model:
            params["model"] = model
        if model_provider:
            params["modelProvider"] = model_provider

        return await self._send_request("turn/start", params)

    async def cancel_turn(self, thread_id: str, turn_id: str) -> dict:
        return await self._send_request("turn/cancel", {
            "threadId": thread_id, "turnId": turn_id,
        })

    async def list_threads(self, cursor: str = "", limit: int = 20) -> dict:
        params = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        return await self._send_request("thread/list", params)

    async def close(self) -> None:
        self.is_ready = False
        if self._read_task:
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
        if self.process:
            try:
                self.process.terminate()
                await asyncio.get_event_loop().run_in_executor(None, self.process.wait, 5)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
            self.process = None
        self.reader = None
        self.writer = None
        self._pending.clear()
        logger.info("Codex service closed")

    def _build_command_candidates(self) -> list[list[str]]:
        config_args = []
        base_commands = []
        if self.codex_command:
            base_commands.append(self.codex_command)
        base_commands.append("codex")

        candidates = []
        for cmd in base_commands:
            candidates.append([cmd, *config_args, "app-server"])
            if IS_WINDOWS:
                candidates.append([cmd + ".exe", *config_args, "app-server"])
                candidates.append([cmd + ".cmd", *config_args, "app-server"])
        return candidates
