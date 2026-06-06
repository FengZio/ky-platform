import asyncio, json, os, shutil, sys, uuid, logging
from typing import Optional
import websockets

SERVER_URL = os.getenv("CODEX_AGENT_SERVER", "wss://vq.zrj666.cn")
PAIRING_CODE = os.getenv("CODEX_AGENT_CODE", "")
CODEX_COMMAND = os.getenv("CODEX_AGENT_COMMAND", "codex")
PROJECT_ROOT = os.getenv("CODEX_AGENT_PROJECT_ROOT", os.path.dirname(os.path.abspath(__file__)))
CODEX_CWD = os.getenv("CODEX_AGENT_CWD", PROJECT_ROOT)
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
        self._current_reasoning_text = ""
        self._reasoning_sent = False
        self._current_assistant_text = ""
        self._current_assistant_id = ""
        self._stderr_task = None
        self.codex_cwd = os.path.abspath(CODEX_CWD)

    async def start(self):
        os.makedirs(self.workspace_dir, exist_ok=True)
        logger.info(f"Workspace: {self.workspace_dir}")
        logger.info(f"Codex cwd: {self.codex_cwd}")

        mcp_config = os.path.join(self.codex_cwd, ".mcp.json")
        if os.path.exists(mcp_config):
            logger.info(f"MCP project config found: {mcp_config}")
        else:
            logger.warning(f"MCP project config not found: {mcp_config}")

        cmd = [CODEX_COMMAND, "app-server"]
        logger.info(f"Spawning: {' '.join(cmd)}")
        self.process = await asyncio.create_subprocess_exec(*cmd, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=self.codex_cwd, env=self._build_process_env())
        self._read_task = asyncio.create_task(self._read_stdout())
        self._stderr_task = asyncio.create_task(self._read_stderr())
        await self._send_request("initialize", {"clientInfo": {"name": "ky_platform_local_agent", "title": "KY Platform Local Agent", "version": "0.1.0"}, "capabilities": {"experimentalApi": True}})
        await self._send_notification("initialized", {})
        result = await self._send_request("thread/start", {"cwd": self.codex_cwd, "approvalPolicy": "never", "sandboxPolicy": {"type": "dangerFullAccess"}})
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
            "你是考研辅导老师，用中文回复。用 MCP 工具 search_materials/search_knowledge 搜索资料后回答。\n"
            "用户消息中[前端上下文]含 material_ids/kp_ids 用于精准搜索。\n"
            "搜索时按学科路由：数学=高数/线代/概率/极限/导数/积分，408=数据结构/计组/OS/计网/二叉树/链表/排序/进程/内存，英语=阅读/作文/翻译/完形/词汇，政治=马原/毛概/史纲/思修/时政；无法判断或多学科混合时全库搜索。\n"
            "回复简洁，Markdown 格式。\n\n"
        )
        text = system_prompt + text
        await self._send_request("turn/start", {"threadId": self.thread_id, "input": [{"type": "text", "text": text}], "cwd": self.codex_cwd, "approvalPolicy": "never", "sandboxPolicy": {"type": "dangerFullAccess"}, "thinkingBudget": 4000})

    def _build_process_env(self) -> dict:
        env = os.environ.copy()
        extra_path_dirs = []

        rg_path = os.getenv("CODEX_AGENT_RG_PATH") or shutil.which("rg") or shutil.which("rg.exe")
        if rg_path:
            rg_dir = os.path.dirname(os.path.abspath(rg_path))
            if rg_dir:
                extra_path_dirs.append(rg_dir)
                logger.info(f"Using rg from: {rg_path}")
        else:
            logger.warning("rg not found in current PATH; Codex search commands may fail.")

        codex_path = shutil.which(CODEX_COMMAND)
        if codex_path:
            codex_dir = os.path.dirname(os.path.abspath(codex_path))
            if codex_dir:
                extra_path_dirs.append(codex_dir)

        if extra_path_dirs:
            current_path = env.get("PATH", "")
            env["PATH"] = os.pathsep.join(dict.fromkeys(extra_path_dirs + current_path.split(os.pathsep)))

        env.setdefault("CODEX_WORKSPACE", self.codex_cwd)
        return env

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
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Read stdout error: {e}")

    async def _read_stderr(self):
        try:
            while self.process and self.process.stderr:
                line = await self.process.stderr.readline()
                if not line: break
                text = line.decode("utf-8", errors="replace").strip()
                if text:
                    logger.info(f"[codex stderr] {text[:300]}")
        except Exception:
            pass

    async def _handle_codex_event(self, method: str, params: dict):
        # Log ALL events verbosely for debugging
        item = params.get("item", {}) if isinstance(params, dict) else {}
        item_type = item.get("type", "") if isinstance(item, dict) else ""
        item_role = item.get("role", "") if isinstance(item, dict) else ""
        item_status = item.get("status", "") if isinstance(item, dict) else ""
        # --- Codex v2 event handling ---

        # item/started: track current item type
        if method == "item/started":
            if item_type == "agentMessage":
                # Send collected reasoning before starting reply
                if self._current_reasoning_text and not self._reasoning_sent:
                    await self._codex_events.put({
                        "type": "reasoning_end",
                        "text": self._current_reasoning_text,
                    })
                    self._reasoning_sent = True
                self._current_assistant_text = ""
                self._current_assistant_id = item.get("id", "")
            return

        # codex/event/agent_message_content_delta: wraps text delta
        if method == "codex/event/agent_message_content_delta":
            delta_text = self._extract_delta_text(params)
            if delta_text:
                self._current_assistant_text += delta_text
                logger.info(f"[CHUNK] {delta_text[:120]}")
            return

        # item/agentMessage/delta: text delta (new version uses this)
        if method == "item/agentMessage/delta":
            delta_text = self._extract_delta_text(params)
            if delta_text:
                self._current_assistant_text += delta_text
            return

        # Reasoning deltas can arrive with several method names across Codex builds.
        if method in (
            "item/reasoning/summaryTextDelta",
            "item/reasoning/delta",
            "item/reasoning/textDelta",
            "item/reasoning/summaryDelta",
            "codex/event/reasoning_delta",
            "codex/event/reasoning_summary_delta",
        ):
            delta_text = self._extract_delta_text(params)
            if delta_text:
                self._current_reasoning_text += delta_text
                await self._codex_events.put({
                    "type": "reasoning_chunk",
                    "text": delta_text,
                })
            return

        # item/reasoning/summaryPartAdded: reset reasoning for new turn
        if method == "item/reasoning/summaryPartAdded":
            self._current_reasoning_text = ""
            self._reasoning_sent = False
            return

        # item/completed: finalize and emit
        if method == "item/completed":
            if item_type == "agentMessage" and self._current_assistant_text:
                await self._codex_events.put({
                    "type": "assistant_chunk",
                    "text": self._current_assistant_text,
                    "item_id": self._current_assistant_id,
                })
                self._current_assistant_text = ""
            elif item_type == "commandExecution":
                pass
            elif item_type == "error":
                error_text = self._extract_text_from_item(item)
                if error_text:
                    logger.error(f"[ERROR_ITEM] {error_text[:300]}")
            return

        # --- Codex v1 compat (turn-level events still used by v2) ---
        if method == "turn/completed":
            self.turn_active = False
            logger.info(f"[TURN] completed, reason={params.get('reason', '')}")
            await self._codex_events.put({"type": "turn_completed"})
        elif method == "turn/started":
            await self._codex_events.put({"type": "turn_started", "turn_id": params.get("turnId", "")})
        elif method == "turn/failed":
            self.turn_active = False
            error = params.get("error", "Unknown error")
            if isinstance(error, dict): error = error.get("message", str(error))
            logger.error(f"[TURN_FAILED] {error}")
            await self._codex_events.put({"type": "error", "text": str(error)})
        # Tool call logging (v2 format)
        elif method == "mcpServer/startupStatus/updated":
            server_name = params.get("serverName", "") or params.get("name", "")
            status = params.get("status", "")
            error = params.get("error", "")
            if error:
                logger.error(f"[MCP_SERVER] {server_name} status={status} error={error}")
            else:
                logger.info(f"[MCP_SERVER] {server_name} status={status}")
            await self._codex_events.put({
                "type": "mcp_status",
                "server": server_name,
                "status": status,
                "error": error,
            })
        elif method == "codex/event/mcp_tool_call_begin":
            tool_name = params.get("toolName", "") or params.get("name", "")
            if not tool_name:
                # Try nested msg.invocation.tool for v2 format
                msg = params.get("msg", {})
                invocation = msg.get("invocation", {}) if isinstance(msg, dict) else {}
                tool_name = invocation.get("tool", "")
                server = invocation.get("server", "")
                if tool_name:
                    tool_input = invocation.get("arguments", {})
                    logger.info(f"[MCP] {server}/{tool_name}({json.dumps(tool_input, ensure_ascii=False)[:200]})")
                    await self._codex_events.put({
                        "type": "tool_call",
                        "server": server,
                        "tool": tool_name,
                    })
        elif method == "item/commandExecution/outputDelta":
            delta_text = self._extract_delta_text(params)
            if delta_text:
                logger.info(f"[COMMAND_OUTPUT] {delta_text[:300]}")
                await self._codex_events.put({
                    "type": "tool_output_chunk",
                    "text": delta_text,
                })

        else:
            # Catch-all for unhandled events to discover new method names
            if not hasattr(self, '_unhandled'):
                self._unhandled = set()
            if method not in self._unhandled:
                self._unhandled.add(method)
                item_info = f" type={item_type}" if item_type else ""
                logger.info(f"[UNHANDLED] method={method}{item_info}")

    def _extract_delta_text(self, params: dict) -> str:
        """Extract text from delta params (Codex v2 format)."""
        msg = params.get("msg", {})
        if isinstance(msg, dict):
            delta = msg.get("delta", "")
            # delta may be a string directly, e.g. {"msg": {"delta": "some text"}}
            if isinstance(delta, str) and delta:
                return delta
            # or a dict, e.g. {"msg": {"delta": {"text": "..."}}}
            if isinstance(delta, dict):
                text = delta.get("text", "")
                if text:
                    return text
                content = delta.get("content", [])
                if isinstance(content, list):
                    parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
                    if parts:
                        return "".join(parts)
        # Fallback: params.delta can be string or dict
        delta = params.get("delta", "")
        if isinstance(delta, str) and delta:
            return delta
        if isinstance(delta, dict):
            text = delta.get("text", "")
            if text:
                return text
            content = delta.get("content", [])
            if isinstance(content, list):
                parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
                if parts:
                    return "".join(parts)
        # Try params.text directly
        text = params.get("text", "")
        if isinstance(text, str) and text:
            return text
        # Try params.content (string or array)
        content = params.get("content", "")
        if isinstance(content, str) and content:
            return content
        if isinstance(content, list):
            parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
            if parts:
                return "".join(parts)
        return ""

    def _extract_text_from_item(self, item: dict) -> str:
        """Extract text from an item object."""
        content = item.get("content", [])
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict):
                    pt = part.get("type", "")
                    if pt in ("text", "output_text"):
                        parts.append(part.get("text", ""))
                elif isinstance(part, str):
                    parts.append(part)
            return "".join(parts)
        return ""


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
        if self._stderr_task: self._stderr_task.cancel()
        if self.process:
            try:
                if self.process.stdin:
                    self.process.stdin.close()
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
    async with websockets.connect(ws_url, ping_interval=30, ping_timeout=30) as ws:
        logger.info("Connected to server")
        await codex.start()
        await ws.send(json.dumps({"type": "codex_ready", "thread_id": codex.thread_id}, ensure_ascii=False))
        async def server_to_codex():
            try:
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
            except websockets.ConnectionClosed:
                pass
        async def codex_to_server():
            try:
                while True:
                    event = await codex._codex_events.get()
                    t = event.get("type", "")
                    if t == "assistant_chunk": logger.info(f"<- Codex: {event['text'][:80]}...")
                    else: logger.info(f"<- Codex event: {t}")
                    await ws.send(json.dumps(event, ensure_ascii=False))
            except websockets.ConnectionClosed:
                pass
        st = asyncio.create_task(server_to_codex())
        ct = asyncio.create_task(codex_to_server())
        done, pending = await asyncio.wait([st, ct], return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            if t.exception():
                logger.warning(f"Task error: {t.exception()}")
        for t in pending:
            t.cancel()
    await codex.close()

if __name__ == "__main__":
    try: asyncio.run(main())
    except KeyboardInterrupt: logger.info("Agent stopped")
