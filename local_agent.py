import asyncio
import json
import logging
import os
import shutil
import sys
import uuid
from typing import Optional

import websockets

SERVER_URL = os.getenv("CODEX_AGENT_SERVER", "wss://vq.zrj666.cn")
PAIRING_CODE = os.getenv("CODEX_AGENT_CODE", "")
CODEX_COMMAND = os.getenv("CODEX_AGENT_COMMAND", "codex")
AGENT_ROOT = os.path.dirname(os.path.abspath(__file__))
USER_PROJECT_ROOT = os.getenv("CODEX_AGENT_PROJECT_ROOT", os.getenv("CODEX_AGENT_CWD", "")).strip()
WORKSPACE_ROOT = os.getenv(
    "CODEX_AGENT_WORKSPACE",
    os.path.join(os.path.expanduser("~"), "CodexAgentWorkspaces"),
)
RECONNECT_DELAY = 5
MAX_RECONNECT_DELAY = 60
MCP_SERVER_PATH = os.path.join(AGENT_ROOT, "backend", "src", "mcp_server.py")
MCP_PYTHON = os.getenv("CODEX_AGENT_MCP_PYTHON", "").strip()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [agent] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("local_agent")


class SessionConfig:
    def __init__(self, payload: Optional[dict] = None):
        payload = payload or {}
        self.supabase_url = str(payload.get("supabase_url", "") or "").strip()
        self.supabase_anon_key = str(payload.get("supabase_anon_key", "") or "").strip()
        self.supabase_access_token = str(payload.get("supabase_access_token", "") or "").strip()
        self.openai_api_key = str(payload.get("openai_api_key", "") or "").strip()
        self.openai_base_url = str(payload.get("openai_base_url", "") or "").strip()
        self.embedding_model = str(payload.get("embedding_model", "") or "").strip()

    def validate(self) -> None:
        missing = []
        if not self.supabase_url:
            missing.append("supabase_url")
        if not self.supabase_anon_key:
            missing.append("supabase_anon_key")
        if not self.supabase_access_token:
            missing.append("supabase_access_token")
        if missing:
            raise RuntimeError("缺少会话配置: " + ", ".join(missing))


class CodexProcess:
    def __init__(self, workspace_id: str, session_config: SessionConfig):
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
        self._current_reasoning_text = ""
        self._reasoning_sent = False
        self._current_assistant_text = ""
        self._current_assistant_id = ""
        self._assistant_streaming = False
        self._debug_sent_methods = set()
        self._stderr_task = None
        self.session_config = session_config
        self.mcp_python = self._resolve_mcp_python()
        self.process_cwd = os.path.abspath(self.workspace_dir)
        self.thread_cwd = self._resolve_thread_cwd()
        self._mcp_config_path = os.path.join(self.process_cwd, ".mcp.json")

    def _redact_debug_value(self, value):
        if isinstance(value, dict):
            redacted = {}
            for key, item in value.items():
                lower_key = str(key).lower()
                if any(secret in lower_key for secret in ("key", "token", "authorization", "secret")):
                    redacted[key] = "<redacted>"
                else:
                    redacted[key] = self._redact_debug_value(item)
            return redacted
        if isinstance(value, list):
            return [self._redact_debug_value(item) for item in value[:8]]
        if isinstance(value, str):
            return value if len(value) <= 300 else value[:300] + "...<truncated>"
        return value

    async def _emit_debug_event(self, method: str, params: dict) -> None:
        if not method:
            return
        item = params.get("item", {}) if isinstance(params, dict) else {}
        item_type = item.get("type", "") if isinstance(item, dict) else ""
        msg = params.get("msg", {}) if isinstance(params, dict) else {}
        invocation = msg.get("invocation", {}) if isinstance(msg, dict) else {}
        tool_name = (
            params.get("toolName", "")
            or params.get("name", "")
            or invocation.get("tool", "")
        )
        server_name = (
            params.get("serverName", "")
            or params.get("server", "")
            or invocation.get("server", "")
        )
        is_reasoning = method.startswith("item/reasoning") or "reasoning" in method
        is_assistant = item_type == "agentMessage" or "agent_message" in method or "agentMessage" in method
        is_tool = (
            "mcp" in method.lower()
            or "tool" in method.lower()
            or tool_name
            or item_type in ("toolCall", "functionCall", "commandExecution")
        )
        is_turn = method.startswith("turn/")
        is_error = item_type == "error" or "failed" in method.lower() or "error" in method.lower()
        if not (is_reasoning or is_assistant or is_tool or is_turn or is_error):
            return
        if method in ("codex/event/agent_message_content_delta", "item/agentMessage/delta"):
            return
        debug_key = (method, item_type, server_name, tool_name)
        if debug_key in self._debug_sent_methods:
            return
        self._debug_sent_methods.add(debug_key)

        summary = ""
        try:
            safe_params = self._redact_debug_value(params)
            summary = json.dumps(safe_params, ensure_ascii=False)
        except Exception:
            summary = str(params)
        event = {
            "type": "codex_debug",
            "method": method,
            "item_type": item_type,
            "server": server_name,
            "tool": tool_name,
            "label": self._debug_label(method, item_type, tool_name),
            "summary": summary[:1200],
        }
        logger.info(
            "[DEBUG] method=%s item_type=%s tool=%s/%s",
            method,
            item_type or "-",
            server_name or "-",
            tool_name or "-",
        )
        await self._codex_events.put(event)

    def _debug_label(self, method: str, item_type: str, tool_name: str) -> str:
        if "reasoning" in method:
            return "Codex 思考事件"
        if tool_name or "mcp" in method.lower() or "tool" in method.lower():
            return "Codex 工具事件"
        if item_type == "agentMessage" or "agent_message" in method or "agentMessage" in method:
            return "Codex 回复事件"
        if method.startswith("turn/"):
            return "Codex 回合事件"
        if item_type == "error" or "error" in method.lower() or "failed" in method.lower():
            return "Codex 错误事件"
        return "Codex 调试事件"

    def _resolve_thread_cwd(self) -> str:
        configured = os.path.abspath(USER_PROJECT_ROOT) if USER_PROJECT_ROOT else ""
        if configured and os.path.isdir(configured):
            return configured
        return self.process_cwd

    def _validate_runtime(self) -> None:
        if not shutil.which(CODEX_COMMAND):
            raise RuntimeError(f"未找到 Codex 可执行文件: {CODEX_COMMAND}")
        if not os.path.isfile(MCP_SERVER_PATH):
            raise RuntimeError(f"未找到 MCP 服务脚本: {MCP_SERVER_PATH}")
        if not self.mcp_python:
            raise RuntimeError(
                "未找到可运行 MCP 的 Python。请安装 backend/requirements.txt 依赖，"
                "或设置 CODEX_AGENT_MCP_PYTHON 指向可 import mcp/supabase 的 python.exe"
            )
        self.session_config.validate()

    def _python_supports_mcp(self, python_path: str) -> bool:
        if not python_path:
            return False
        resolved = shutil.which(python_path) or python_path
        if not os.path.isfile(resolved):
            return False
        try:
            import subprocess

            result = subprocess.run(
                [
                    resolved,
                    "-c",
                    "import mcp, supabase, httpx, pydantic_settings",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=8,
                check=False,
            )
            return result.returncode == 0
        except Exception:
            return False

    def _resolve_mcp_python(self) -> str:
        candidates = [
            MCP_PYTHON,
            sys.executable,
            shutil.which("python"),
            shutil.which("python3"),
            os.path.join(os.path.expanduser("~"), "anaconda3", "python.exe"),
        ]
        seen = set()
        for candidate in candidates:
            if not candidate:
                continue
            resolved = os.path.abspath(shutil.which(candidate) or candidate)
            if resolved in seen:
                continue
            seen.add(resolved)
            if self._python_supports_mcp(resolved):
                if resolved != sys.executable:
                    logger.info(f"Using MCP Python: {resolved}")
                return resolved
        return ""

    def _write_mcp_config(self) -> None:
        payload = {
            "mcpServers": {
                "ky-platform-search": {
                    "type": "stdio",
                    "command": self.mcp_python,
                    "args": [MCP_SERVER_PATH],
                    "cwd": AGENT_ROOT,
                    "env": {
                        "SUPABASE_URL": self.session_config.supabase_url,
                        "SUPABASE_ANON_KEY": self.session_config.supabase_anon_key,
                        "SUPABASE_ACCESS_TOKEN": self.session_config.supabase_access_token,
                        "OPENAI_API_KEY": self.session_config.openai_api_key,
                        "OPENAI_BASE_URL": self.session_config.openai_base_url,
                        "EMBEDDING_MODEL": self.session_config.embedding_model,
                    },
                    "description": "ky-platform 知识库语义搜索",
                }
            }
        }
        with open(self._mcp_config_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        logger.info(f"Session MCP config ready: {self._mcp_config_path}")

    def _build_codex_command(self) -> list[str]:
        redacted_env = {
            "SUPABASE_URL": self.session_config.supabase_url,
            "SUPABASE_ANON_KEY": self.session_config.supabase_anon_key,
            "SUPABASE_ACCESS_TOKEN": self.session_config.supabase_access_token,
            "OPENAI_API_KEY": self.session_config.openai_api_key,
            "OPENAI_BASE_URL": self.session_config.openai_base_url,
            "EMBEDDING_MODEL": self.session_config.embedding_model,
        }
        return [
            CODEX_COMMAND,
            "-c",
            f"mcp_servers.ky-platform-search.command={json.dumps(self.mcp_python)}",
            "-c",
            f"mcp_servers.ky-platform-search.args={json.dumps([MCP_SERVER_PATH])}",
            "-c",
            f"mcp_servers.ky-platform-search.cwd={json.dumps(AGENT_ROOT)}",
            "-c",
            f"mcp_servers.ky-platform-search.env.SUPABASE_URL={json.dumps(self.session_config.supabase_url)}",
            "-c",
            f"mcp_servers.ky-platform-search.env.SUPABASE_ANON_KEY={json.dumps(self.session_config.supabase_anon_key)}",
            "-c",
            f"mcp_servers.ky-platform-search.env.SUPABASE_ACCESS_TOKEN={json.dumps(self.session_config.supabase_access_token)}",
            "-c",
            f"mcp_servers.ky-platform-search.env.OPENAI_API_KEY={json.dumps(self.session_config.openai_api_key)}",
            "-c",
            f"mcp_servers.ky-platform-search.env.OPENAI_BASE_URL={json.dumps(self.session_config.openai_base_url)}",
            "-c",
            f"mcp_servers.ky-platform-search.env.EMBEDDING_MODEL={json.dumps(self.session_config.embedding_model)}",
            "app-server",
        ]

    def _log_codex_command(self, cmd: list[str]) -> None:
        redacted = []
        secret_keys = (
            "SUPABASE_ANON_KEY=",
            "SUPABASE_ACCESS_TOKEN=",
            "OPENAI_API_KEY=",
        )
        for part in cmd:
            if any(key in part for key in secret_keys):
                key = part.split("=", 1)[0]
                redacted.append(key + '="<redacted>"')
            else:
                redacted.append(part)
        logger.info(f"Spawning: {' '.join(redacted)}")

    async def start(self):
        self._validate_runtime()
        os.makedirs(self.workspace_dir, exist_ok=True)
        self._write_mcp_config()
        logger.info(f"Workspace: {self.workspace_dir}")
        logger.info(f"Codex process cwd: {self.process_cwd}")
        logger.info(f"Codex thread cwd: {self.thread_cwd}")
        if USER_PROJECT_ROOT and os.path.isdir(os.path.abspath(USER_PROJECT_ROOT)):
            logger.info(f"Using user project root: {os.path.abspath(USER_PROJECT_ROOT)}")
        else:
            logger.info("Using isolated session workspace (no local repo required)")

        cmd = self._build_codex_command()
        self._log_codex_command(cmd)
        self.process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.process_cwd,
            env=self._build_process_env(),
        )
        self._read_task = asyncio.create_task(self._read_stdout())
        self._stderr_task = asyncio.create_task(self._read_stderr())
        await self._send_request(
            "initialize",
            {
                "clientInfo": {
                    "name": "ky_platform_local_agent",
                    "title": "KY Platform Local Agent",
                    "version": "0.1.0",
                },
                "capabilities": {"experimentalApi": True},
            },
        )
        await self._send_notification("initialized", {})
        result = await self._send_request(
            "thread/start",
            {
                "cwd": self.thread_cwd,
                "approvalPolicy": "never",
                "sandboxPolicy": {"type": "dangerFullAccess"},
            },
        )
        if isinstance(result, dict):
            thread_obj = result.get("thread", {})
            self.thread_id = (
                thread_obj.get("id", "")
                or result.get("id", "")
                or result.get("threadId", "")
            )
        elif isinstance(result, str):
            self.thread_id = result
        logger.info(f"Codex ready, thread_id={self.thread_id}")

    async def send_user_message(self, text: str):
        if not self.thread_id:
            logger.warning("No thread_id")
            return
        self.turn_active = True
        self._debug_sent_methods = set()
        self._assistant_streaming = False
        system_prompt = (
            "你是考研辅导老师，用中文回复。回答知识点、资料、题目生成、举一反三、讲解类问题前，必须先调用 MCP 工具 search_materials 或 search_knowledge 检索资料；如果用户给了[前端上下文]里的 kp_ids/material_ids，更必须优先围绕这些上下文检索。\n"
            "用户消息中[前端上下文]含 material_ids/kp_ids 用于精准搜索。\n"
            "检索失败时请明确说明检索失败原因，再基于通用知识补充回答；不要假装已检索。\n"
            "搜索时按学科路由：数学=高数/线代/概率/极限/导数/积分，408=数据结构/计组/OS/计网/二叉树/链表/排序/进程/内存，英语=阅读/作文/翻译/完形/词汇，政治=马原/毛概/史纲/思修/时政；无法判断或多学科混合时全库搜索。\n"
            "回复简洁，Markdown 格式。\n\n"
        )
        text = system_prompt + text
        await self._send_request(
            "turn/start",
            {
                "threadId": self.thread_id,
                "input": [{"type": "text", "text": text}],
                "cwd": self.thread_cwd,
                "approvalPolicy": "never",
                "sandboxPolicy": {"type": "dangerFullAccess"},
                "thinkingBudget": 4000,
            },
        )

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
            env["PATH"] = os.pathsep.join(
                dict.fromkeys(extra_path_dirs + current_path.split(os.pathsep))
            )

        env.setdefault("CODEX_WORKSPACE", self.process_cwd)
        env["SUPABASE_URL"] = self.session_config.supabase_url
        env["SUPABASE_ANON_KEY"] = self.session_config.supabase_anon_key
        env["SUPABASE_ACCESS_TOKEN"] = self.session_config.supabase_access_token
        if self.session_config.openai_api_key:
            env["OPENAI_API_KEY"] = self.session_config.openai_api_key
        if self.session_config.openai_base_url:
            env["OPENAI_BASE_URL"] = self.session_config.openai_base_url
        if self.session_config.embedding_model:
            env["EMBEDDING_MODEL"] = self.session_config.embedding_model
        return env

    async def _read_stdout(self):
        try:
            while self.process and self.process.stdout:
                line = await self.process.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                try:
                    msg = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if "id" in msg and "method" not in msg:
                    req_id = msg["id"]
                    future = self._pending.pop(req_id, None)
                    if future and not future.done():
                        if "error" in msg:
                            future.set_exception(RuntimeError(str(msg["error"])))
                        else:
                            future.set_result(msg.get("result", msg))
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
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if text:
                    logger.info(f"[codex stderr] {text[:300]}")
        except Exception:
            pass

    async def _handle_codex_event(self, method: str, params: dict):
        await self._emit_debug_event(method, params)

        item = params.get("item", {}) if isinstance(params, dict) else {}
        item_type = item.get("type", "") if isinstance(item, dict) else ""

        if method == "item/started":
            if item_type == "agentMessage":
                if self._current_reasoning_text and not self._reasoning_sent:
                    await self._codex_events.put(
                        {
                            "type": "reasoning_end",
                            "text": self._current_reasoning_text,
                        }
                    )
                    self._reasoning_sent = True
                self._current_assistant_text = ""
                self._current_assistant_id = item.get("id", "")
                self._assistant_streaming = False
            return

        if method in ("codex/event/agent_message_content_delta", "item/agentMessage/delta"):
            delta_text = self._extract_delta_text(params)
            if delta_text:
                self._current_assistant_text += delta_text
                self._assistant_streaming = True
                await self._codex_events.put(
                    {
                        "type": "assistant_chunk",
                        "text": delta_text,
                        "item_id": self._current_assistant_id,
                    }
                )
            return

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
                await self._codex_events.put({"type": "reasoning_chunk", "text": delta_text})
            return

        if method == "item/reasoning/summaryPartAdded":
            self._current_reasoning_text = ""
            self._reasoning_sent = False
            return

        if method == "item/completed":
            if item_type == "agentMessage" and self._current_assistant_text and not self._assistant_streaming:
                await self._codex_events.put(
                    {
                        "type": "assistant_chunk",
                        "text": self._current_assistant_text,
                        "item_id": self._current_assistant_id,
                    }
                )
                self._current_assistant_text = ""
            elif item_type == "agentMessage":
                self._current_assistant_text = ""
                self._assistant_streaming = False
            elif item_type == "error":
                error_text = self._extract_text_from_item(item)
                if error_text:
                    logger.error(f"[ERROR_ITEM] {error_text[:300]}")
            return

        if method == "turn/completed":
            self.turn_active = False
            logger.info(f"[TURN] completed, reason={params.get('reason', '')}")
            await self._codex_events.put({"type": "turn_completed"})
        elif method == "turn/started":
            await self._codex_events.put({"type": "turn_started", "turn_id": params.get("turnId", "")})
        elif method == "turn/failed":
            self.turn_active = False
            error = params.get("error", "Unknown error")
            if isinstance(error, dict):
                error = error.get("message", str(error))
            logger.error(f"[TURN_FAILED] {error}")
            await self._codex_events.put({"type": "error", "text": str(error)})
        elif method == "mcpServer/startupStatus/updated":
            server_name = params.get("serverName", "") or params.get("name", "")
            status = params.get("status", "")
            error = params.get("error", "")
            if error:
                logger.error(f"[MCP_SERVER] {server_name} status={status} error={error}")
            else:
                logger.info(f"[MCP_SERVER] {server_name} status={status}")
            await self._codex_events.put(
                {
                    "type": "mcp_status",
                    "server": server_name,
                    "status": status,
                    "error": error,
                }
            )
        elif method in (
            "codex/event/mcp_tool_call_begin",
            "mcpToolCall/begin",
            "toolCall/begin",
            "item/toolCall/started",
            "item/functionCall/started",
        ) or (method == "item/started" and item_type in ("toolCall", "functionCall")):
            tool_name = params.get("toolName", "") or params.get("name", "")
            if not tool_name:
                msg = params.get("msg", {})
                invocation = msg.get("invocation", {}) if isinstance(msg, dict) else {}
                tool_name = invocation.get("tool", "") or item.get("name", "") or item.get("tool", "")
                server = invocation.get("server", "") or item.get("server", "")
            else:
                server = params.get("server", "") or params.get("serverName", "")
            if tool_name:
                logger.info(f"[MCP] {server}/{tool_name}")
                await self._codex_events.put(
                    {
                        "type": "tool_call",
                        "server": server,
                        "tool": tool_name,
                    }
                )
        elif method == "item/commandExecution/outputDelta":
            delta_text = self._extract_delta_text(params)
            if delta_text:
                logger.info(f"[COMMAND_OUTPUT] {delta_text[:300]}")
                await self._codex_events.put({"type": "tool_output_chunk", "text": delta_text})
        else:
            if not hasattr(self, "_unhandled"):
                self._unhandled = set()
            if method not in self._unhandled:
                self._unhandled.add(method)
                item_info = f" type={item_type}" if item_type else ""
                logger.info(f"[UNHANDLED] method={method}{item_info}")

    def _extract_delta_text(self, params: dict) -> str:
        msg = params.get("msg", {})
        if isinstance(msg, dict):
            delta = msg.get("delta", "")
            if isinstance(delta, str) and delta:
                return delta
            if isinstance(delta, dict):
                text = delta.get("text", "")
                if text:
                    return text
                content = delta.get("content", [])
                if isinstance(content, list):
                    parts = [
                        p.get("text", "")
                        for p in content
                        if isinstance(p, dict) and p.get("type") == "text"
                    ]
                    if parts:
                        return "".join(parts)

        delta = params.get("delta", "")
        if isinstance(delta, str) and delta:
            return delta
        if isinstance(delta, dict):
            text = delta.get("text", "")
            if text:
                return text
            content = delta.get("content", [])
            if isinstance(content, list):
                parts = [
                    p.get("text", "")
                    for p in content
                    if isinstance(p, dict) and p.get("type") == "text"
                ]
                if parts:
                    return "".join(parts)

        text = params.get("text", "")
        if isinstance(text, str) and text:
            return text

        content = params.get("content", "")
        if isinstance(content, str) and content:
            return content
        if isinstance(content, list):
            parts = [
                p.get("text", "")
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            if parts:
                return "".join(parts)
        return ""

    def _extract_text_from_item(self, item: dict) -> str:
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
            try:
                return await asyncio.wait_for(future, timeout=120.0)
            except asyncio.TimeoutError:
                self._pending.pop(req_id, None)
                raise RuntimeError(f"Timeout: {method}")

    async def _send_notification(self, method: str, params: Optional[dict] = None):
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        self.process.stdin.write(line.encode("utf-8"))
        await self.process.stdin.drain()

    async def close(self):
        logger.info("Closing codex process...")
        if self._read_task:
            self._read_task.cancel()
        if self._stderr_task:
            self._stderr_task.cancel()
        if self.process:
            try:
                if self.process.stdin:
                    self.process.stdin.close()
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), timeout=5)
                except asyncio.TimeoutError:
                    self.process.kill()
                    await self.process.wait()
            except Exception as e:
                logger.warning(f"Cleanup: {e}")
            self.process = None
        try:
            if os.path.exists(self._mcp_config_path):
                os.remove(self._mcp_config_path)
                logger.info(f"MCP config removed: {self._mcp_config_path}")
        except Exception as e:
            logger.warning(f"Cleanup MCP config failed: {e}")
        try:
            if os.path.exists(self.workspace_dir):
                shutil.rmtree(self.workspace_dir, ignore_errors=True)
                logger.info(f"Workspace removed: {self.workspace_dir}")
        except Exception:
            pass


async def main():
    code = PAIRING_CODE.strip().upper()
    if not code:
        code = input("Pairing code: ").strip().upper()
    if not code:
        logger.error("No pairing code")
        return
    ws_url = f"{SERVER_URL}/api/learning/agent/ws?code={code}"
    logger.info(f"Server: {ws_url}")
    reconnect_delay = RECONNECT_DELAY
    while True:
        try:
            await run_session(ws_url)
            reconnect_delay = RECONNECT_DELAY
        except websockets.ConnectionClosed as e:
            logger.warning(f"Closed: {e}, reconnecting in {reconnect_delay}s...")
        except (OSError, asyncio.TimeoutError) as e:
            logger.warning(
                f"Network: {type(e).__name__}: {e!r}, reconnecting in {reconnect_delay}s..."
            )
        except Exception as e:
            logger.error(f"Error: {e}, reconnecting in {reconnect_delay}s...")
        await asyncio.sleep(reconnect_delay)
        reconnect_delay = min(reconnect_delay * 2, MAX_RECONNECT_DELAY)


async def run_session(ws_url: str):
    workspace_id = f"agent-{uuid.uuid4().hex[:8]}"
    codex = None
    async with websockets.connect(
        ws_url,
        ping_interval=30,
        ping_timeout=30,
        open_timeout=30,
        close_timeout=10,
    ) as ws:
        logger.info("Connected to server")
        session_payload = None
        while session_payload is None:
            raw = await ws.recv()
            msg = json.loads(raw)
            msg_type = msg.get("type", "")
            if msg_type == "session_config":
                session_payload = msg
            elif msg_type == "ping":
                await ws.send(json.dumps({"type": "pong"}))
            elif msg_type == "error":
                raise RuntimeError(msg.get("text", "会话初始化失败"))

        codex = CodexProcess(workspace_id, SessionConfig(session_payload))
        try:
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
                        elif t == "session_config":
                            codex.session_config = SessionConfig(msg)
                            logger.info("Session config refreshed")
                        elif t == "ping":
                            await ws.send(json.dumps({"type": "pong"}))
                        elif t in ("browser_connected", "browser_disconnected"):
                            logger.info(f"Browser: {t}")
                except websockets.ConnectionClosed:
                    pass

            async def codex_to_server():
                try:
                    while True:
                        event = await codex._codex_events.get()
                        t = event.get("type", "")
                        if t == "assistant_chunk":
                            logger.info(f"<- Codex: {event['text'][:80]}...")
                        elif t == "codex_debug":
                            logger.info(
                                "<- Debug: %s method=%s item=%s tool=%s/%s",
                                event.get("label", "Codex 调试事件"),
                                event.get("method", ""),
                                event.get("item_type", "") or "-",
                                event.get("server", "") or "-",
                                event.get("tool", "") or "-",
                            )
                        else:
                            logger.info(f"<- Codex event: {t}")
                        await ws.send(json.dumps(event, ensure_ascii=False))
                except websockets.ConnectionClosed:
                    pass

            st = asyncio.create_task(server_to_codex())
            ct = asyncio.create_task(codex_to_server())
            done, pending = await asyncio.wait([st, ct], return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task.exception():
                    logger.warning(f"Task error: {task.exception()}")
            for task in pending:
                task.cancel()
        finally:
            await codex.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Agent stopped")
