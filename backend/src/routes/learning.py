"""Learning Routes --- AI Learning Center API

WebSocket:
  GET /api/learning/ws          Browser side (generates pairing code)
  GET /api/learning/agent/ws    Agent side (consumes pairing code)
"""

import json
import logging
import asyncio
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query
from src.services.relay_service import relay
from src.routes.learning_context import search_vector_context, ContextRequest
from src.services.auth import get_ws_token, verify_supabase_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/learning", tags=["learning"])


# ======================================================================
# Browser WebSocket
# ======================================================================

@router.websocket("/ws")
async def browser_websocket(ws: WebSocket, token: str = Query(default="")):
    """Browser connects, gets a pairing code for the local agent to use"""
    ws_token = get_ws_token(ws, token)
    try:
        verify_supabase_token(ws_token)
    except HTTPException:
        await ws.accept()
        await ws.send_json({"type": "error", "text": "请先登录后再连接 AI 学习中心。"})
        await ws.close(code=1008)
        return

    await ws.accept()
    code, message_queue = await relay.register_browser(ws, ws_token)

    # Send pairing code immediately
    await ws.send_json({"type": "pairing_code", "code": code})

    try:
        async def read_from_browser():
            while True:
                try:
                    raw = await ws.receive_text()
                    msg = json.loads(raw)
                    # Intercept client heartbeat pings - respond directly
                    if msg.get("type") == "ping":
                        await ws.send_json({"type": "pong"})
                        continue
                    msg["from"] = "browser"
                    ok = await relay.browser_to_agent(code, msg)
                    if not ok and msg.get("type") == "user_message":
                        await ws.send_json({
                            "type": "agent_disconnected",
                            "text": "Agent 未连接，请先在电脑上运行 local_agent.py 并输入配对码: " + code,
                        })
                except WebSocketDisconnect:
                    break
                except json.JSONDecodeError:
                    pass

        async def forward_to_browser():
            while True:
                msg = await message_queue.get()
                try:
                    await ws.send_json(msg)
                except Exception:
                    break

        read_task = asyncio.create_task(read_from_browser())
        forward_task = asyncio.create_task(forward_to_browser())

        done, pending = await asyncio.wait(
            [read_task, forward_task], return_when=asyncio.FIRST_COMPLETED
        )
        for t in pending:
            t.cancel()

    except Exception as e:
        logger.error(f"Browser WS error: {e}")
    finally:
        await relay.remove_browser(code)


# ======================================================================
# Agent WebSocket
# ======================================================================

@router.websocket("/agent/ws")
async def agent_websocket(ws: WebSocket, code: str = Query(default="")):
    """Local PC agent connects with pairing code"""
    if not code:
        await ws.accept()
        await ws.send_json({"type": "error", "text": "Missing pairing code"})
        await ws.close()
        return

    await ws.accept()
    message_queue = await relay.register_agent(ws, code.upper())

    if message_queue is None:
        await ws.send_json({
            "type": "error",
            "text": "配对码无效或已过期。请刷新浏览器页面获取新码。",
        })
        await ws.close()
        return

    try:
        async def read_from_agent():
            while True:
                try:
                    raw = await ws.receive_text()
                    msg = json.loads(raw)
                    msg["from"] = "agent"
                    await relay.agent_to_browser(code.upper(), msg)
                except WebSocketDisconnect:
                    break
                except json.JSONDecodeError:
                    pass

        async def forward_to_agent():
            while True:
                msg = await message_queue.get()
                try:
                    await ws.send_json(msg)
                except Exception:
                    break

        read_task = asyncio.create_task(read_from_agent())
        forward_task = asyncio.create_task(forward_to_agent())

        done, pending = await asyncio.wait(
            [read_task, forward_task], return_when=asyncio.FIRST_COMPLETED
        )
        for t in pending:
            t.cancel()

    except Exception as e:
        logger.error(f"Agent WS error: {e}")
    finally:
        await relay.remove_agent(code.upper())


# ======================================================================
# REST
# ======================================================================


# ======================================================================
# Vector Context Search
# ======================================================================

@router.post("/context")
async def get_context(req: ContextRequest):
    """Retrieve relevant document chunks via vector search"""
    try:
        context = await search_vector_context(req)
        return {"context": context, "status": "ok"}
    except Exception as e:
        logger.error(f"Context search error: {e}")
        return {"context": "", "status": "error", "message": str(e)}
