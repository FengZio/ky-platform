from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.routes.health import router as health_router
from src.routes.process import router as task_router
from src.routes.learning import router as learning_router
from src.routes.task_queue import router as task_queue_router
from src.routes.question_bank import router as question_bank_router
from src.services.relay_service import relay

logger = logging.getLogger(__name__)

# Playwright 单例（在 lifespan 中初始化）
_pdf_semaphore = asyncio.Semaphore(1)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    banner = f"""
  +---------------------------------------------------+
  |   考研AI助手 . 后端节点 v3.2 (Python)              |
  |   MinerU解析 / 任务队列 / 学习中心中继 / 题库系统   |
  +---------------------------------------------------+
  |   PORT     : {str(settings.port).ljust(42)}|
  |   MODEL    : {settings.embedding_model.ljust(42)}|
  |   BASE_URL : {settings.openai_base_url.ljust(42)}|
  |   MinerU   : {settings.mineru_base_url.ljust(42)}|
  +---------------------------------------------------+
"""
    print(banner)
    await relay.start_cleanup()

    # 初始化 Playwright 浏览器单例（用于 PDF 导出）
    from src.services.pdf_renderer import init_browser
    await init_browser()
    _app.state.pdf_semaphore = _pdf_semaphore

    yield

    # 清理
    from src.services.pdf_renderer import shutdown_browser
    await shutdown_browser()
    print("[ky-backend] Shutting down...")


app = FastAPI(title="ky-backend", version="3.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# 简单中间件：从 X-User-Id header 提取用户 ID
@app.middleware("http")
async def extract_user_id(request: Request, call_next):
    user_id = request.headers.get("X-User-Id", "")
    request.state.user_id = user_id
    response = await call_next(request)
    return response


app.include_router(health_router)
app.include_router(task_router)
app.include_router(learning_router)
app.include_router(task_queue_router)
app.include_router(question_bank_router)
