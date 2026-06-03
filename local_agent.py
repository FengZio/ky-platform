"""
local_agent.py -- Local PC Agent Daemon
Connects to remote server, spawns codex app-server, relays messages.
Usage: python local_agent.py  (enter pairing code when prompted)
"""
import asyncio, json, os, shutil, sys, uuid, logging
from typing import Optional
import websockets

SERVER_URL = os.getenv("CODEX_AGENT_SERVER", "wss://vq.zrj666.cn")
PAIRING_CODE = os.getenv("CODEX_AGENT_CODE", "")
CODEX_COMMAND = os.getenv("CODEX_AGENT_COMMAND", "codex")
WORKSPACE_ROOT = os.getenv("CODEX_AGENT_WORKSPACE", os.path.join(os.environ.get("TEMP", "/tmp"), "codex-agent-workspaces"))
RECONNECT_DELAY = 5
MAX_RECONNECT_DELAY = 60

logging.basicConfig(level=logging.INFO, format="%(asctime)s [agent] %(levelname)s %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("local_agent")

class CodexProcess:
    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.workspace_dir = os.path.join(WORKSPACE_ROOT, workspace_id)
        self.process = None
        self._request_id = 0
        self._pending = {}
        self._read_task = None
        self.thread_id = ""
        self.turn_active = False
        self._lock = asyncio.Lock()
        self._codex_events = asyncio.Queue()
        self._first_message = True

    async def start(self):
        os.makedirs(self.workspace_dir, exist_ok=True)
        logger.info(f"Workspace: {self.workspace_dir}")
        cmd = [CODEX_COMMAND, "app-server"]
        logger.info(f"Spawning: {' '.join(cmd)}")
        self.process = await asyncio.create_subprocess_exec(*cmd, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        self._read_task = asyncio.create_task(self._read_stdout())
        asyncio.create_task(self._read_stderr())
        await self._send_request("initialize", {"clientInfo": {"name": "ky_platform_local_agent", "title": "KY Platform Local Agent", "version": "0.1.0"}, "capabilities": {"experimentalApi": True}})
        await self._send_notification("initialized", {})
        result = await self._send_request("thread/start", {"cwd": self.workspace_dir, "approvalPolicy": "never", "sandboxPolicy": {"type": "dangerFullAccess"}})
        if isinstance(result, dict):
            thread_obj = result.get("thread", {})
            self.thread_id = thread_obj.get("id", "") or result.get("id", "") or result.get("threadId", "")
        elif isinstance(result, str):
            self.thread_id = result
        logger.info(f"Codex ready, thread_id={self.thread_id}")

    async def send_user_message(self, text: str):
        if not self.thread_id:
            logger.warning("No thread_id")
            return
        self.turn_active = True
        system_prompt = (
            "[SYSTEM] 你必须始终用中文回复。你是考研全科辅导老师，覆盖以下科目：\n"
            "- 数学（数学一/二/三）：高等数学、线性代数、概率论与数理统计\n"
            "- 408计算机学科专业基础综合：数据结构、计算机组成原理、操作系统、计算机网络\n"
            "- 英语：完形填空、阅读理解、翻译、写作\n"
            "- 政治：马原、毛中特、史纲、思修法基、时政\n"
            "你可以讲解知识点、分析题型、制定复习计划、答疑解惑。\n"
            "你有 MCP 搜索工具可用：\n"
            "  search_knowledge — 语义搜索知识点\n"
            "  search_materials — 语义搜索学习资料（支持 knowledge_tags 标签过滤）\n"
            "  get_chunk_detail — 查看资料分块完整内容\n"
            "用户消息中的[前端上下文]包含用户勾选的资料和知识点范围，请用 MCP 工具精准搜索。\n"
            "所有回复必须使用中文。禁止使用英文回复。\n"
            "输出格式：使用 Markdown 格式化回复，标题(##)、列表(-)、加粗(**文字**)、代码块(`)等。\n\n"
        )
        text = system_prompt + text
        await self._send_request("turn/start", {"threadId": self.thread_id, "input": [{"type": "text", "text": text}], "cwd": self.workspace_dir, "approvalPolicy": "never", "sandboxPolicy": {"type": "dangerFullAccess"}})

    async def _read_stdout(self):
        try:
            while self.process and self.process.stdout:
                line = await self.process.stdout.readline()
                if not line: break
                text = line.decode("utf-8", errors="replace").strip()
                if not text: continue
                try: msg = json.loads(text)
                except json.JSONDecodeError: continue
                if "id" in msg and "method" not in msg:
                    req_id = msg["id"]
                    future = self._pending.pop(req_id, None)
                    if future and not future.done():
                        if "error" in msg: future.set_exception(RuntimeError(str(msg["error"])))
                        else: future.set_result(msg.get("result", msg))
                    continue
                await self._handle_codex_event(msg.get("method", ""), msg.get("params", {}))
        except asyncio.CancelledError: pass
        except Exception as e: logger.error(f"Stdout error: {e}")

    async def _read_stderr(self):
        try:
            while self.process and self.process.stderr:
                line = await self.process.stderr.readline()
                if not line: break
                text = line.decode("utf-8", errors="replace").strip()
                if text: logger.debug(f"[codex] {text}")
        except Exception: pass

    async def _handle_codex_event(self, method: str, params: dict):
        # Drop reasoning/thinking stream events entirely
        if method in ("item/reasoning/summaryTextDelta", "item/reasoning/summaryPartAdded",
                      "codex/event/reasoning_content_delta", "codex/event/agent_reasoning_delta",
                      "codex/event/agent_reasoning_section_break"):
            pass
        # Real answer streaming
        elif method == "item/agentMessage/delta":
            delta = params.get("delta", "")
            if isinstance(delta, str) and delta:
                await self._codex_events.put({"type": "assistant_chunk", "text": delta})
        # item/completed as fallback
        elif method in ("turn/item/updated", "item/completed"):
            item = params.get("item", {})
            item_type = item.get("type", "")
            if item_type in ("thinking", "reasoning"):
                return
            if item.get("role") == "assistant":
                content_list = item.get("content", [])
                for part in (content_list if isinstance(content_list, list) else []):
                    if isinstance(part, dict):
                        pt = part.get("type", "")
                        if pt in ("thinking", "reasoning"):
                            continue
                        if pt in ("text", "output_text"):
                            text = part.get("text", "")
                            if text:
                                await self._codex_events.put({"type": "assistant_chunk", "text": text})
        elif method == "turn/completed":
            self.turn_active = False
            await self._codex_events.put({"type": "turn_completed"})
        elif method == "turn/started":
            await self._codex_events.put({"type": "turn_started", "turn_id": params.get("turnId", "")})
        elif method == "turn/failed":
            self.turn_active = False
            error = params.get("error", "Unknown error")
            if isinstance(error, dict): error = error.get("message", str(error))
            await self._codex_events.put({"type": "error", "text": str(error)})

    async def _send_request(self, method: str, params: Optional[dict] = None) -> dict:
        async with self._lock:
            self._request_id += 1
            req_id = self._request_id
            payload = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}
            future = asyncio.get_event_loop().create_future()
            self._pending[req_id] = future
            line = json.dumps(payload, ensure_ascii=False) + "\n"
            self.process.stdin.write(line.encode("utf-8"))
            await self.process.stdin.drain()
            try: return await asyncio.wait_for(future, timeout=120.0)
            except asyncio.TimeoutError: self._pending.pop(req_id, None); raise RuntimeError(f"Timeout: {method}")

    async def _send_notification(self, method: str, params: Optional[dict] = None):
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        self.process.stdin.write(line.encode("utf-8"))
        await self.process.stdin.drain()

    async def close(self):
        logger.info("Closing codex process...")
        if self._read_task: self._read_task.cancel()
        if self.process:
            try:
                self.process.terminate()
                try: await asyncio.wait_for(self.process.wait(), timeout=5)
                except asyncio.TimeoutError: self.process.kill(); await self.process.wait()
            except Exception as e: logger.warning(f"Cleanup: {e}")
            self.process = None
        try:
            if os.path.exists(self.workspace_dir):
                shutil.rmtree(self.workspace_dir, ignore_errors=True)
                logger.info(f"Workspace removed: {self.workspace_dir}")
        except Exception: pass

async def main():
    code = PAIRING_CODE.strip().upper()
    if not code:
        code = input("Pairing code: ").strip().upper()
    if not code:
        logger.error("No pairing code"); return
    ws_url = f"{SERVER_URL}/api/learning/agent/ws?code={code}"
    logger.info(f"Server: {ws_url}")
    reconnect_delay = RECONNECT_DELAY
    while True:
        try:
            await run_session(ws_url, code)
            reconnect_delay = RECONNECT_DELAY
        except websockets.ConnectionClosed as e:
            logger.warning(f"Closed: {e}, reconnecting in {reconnect_delay}s...")
        except (OSError, asyncio.TimeoutError) as e:
            logger.warning(f"Network: {e}, reconnecting in {reconnect_delay}s...")
        except Exception as e:
            logger.error(f"Error: {e}, reconnecting in {reconnect_delay}s...")
        await asyncio.sleep(reconnect_delay)
        reconnect_delay = min(reconnect_delay * 2, MAX_RECONNECT_DELAY)

async def run_session(ws_url: str, code: str):
    workspace_id = f"agent-{uuid.uuid4().hex[:8]}"
    codex = CodexProcess(workspace_id)
    async with websockets.connect(ws_url, ping_interval=30, ping_timeout=10) as ws:
        logger.info("Connected to server")
        await codex.start()
        await ws.send(json.dumps({"type": "codex_ready", "thread_id": codex.thread_id}, ensure_ascii=False))
        async def server_to_codex():
            while True:
                raw = await ws.recv()
                msg = json.loads(raw)
                t = msg.get("type", "")
                if t == "user_message":
                    txt = msg.get("text", "")
                    if txt.strip():
                        logger.info(f"-> Codex: {txt[:80]}...")
                        await codex.send_user_message(txt)
                elif t == "ping": await ws.send(json.dumps({"type": "pong"}))
                elif t in ("browser_connected", "browser_disconnected"): logger.info(f"Browser: {t}")
        async def codex_to_server():
            while True:
                event = await codex._codex_events.get()
                t = event.get("type", "")
                if t == "assistant_chunk": logger.info(f"<- Codex: {event['text'][:60]}...")
                else: logger.info(f"<- Codex event: {t}")
                await ws.send(json.dumps(event, ensure_ascii=False))
        st = asyncio.create_task(server_to_codex())
        ct = asyncio.create_task(codex_to_server())
        done, pending = await asyncio.wait([st, ct], return_when=asyncio.FIRST_COMPLETED)
        for t in pending: t.cancel()
    await codex.close()

if __name__ == "__main__":
    try: asyncio.run(main())
    except KeyboardInterrupt: logger.info("Agent stopped")