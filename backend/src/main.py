from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI, Request, HTTPException as FastAPIHTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.routes.health import router as health_router
from src.routes.process import router as task_router
from src.routes.learning import router as learning_router
from src.routes.task_queue import router as task_queue_router
from src.routes.question_bank import router as question_bank_router
from src.services.auth import get_bearer_token, path_requires_auth, verify_supabase_token
from src.services.relay_service import relay

logger = logging.getLogger(__name__)

# Playwright 单例（在 lifespan 中初始化）
_pdf_semaphore = asyncio.Semaphore(1)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    banner = f"""
  +---------------------------------------------------+
  |   考研AI助手 . 后端节点 v3.2 (Python)              |
  |   MinerU解析 / 资源库任务 / 学习中心中继 / 资源库题库 |
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


# CORS-safe exception handler: ensure error responses also include CORS headers
from starlette.responses import JSONResponse

@app.exception_handler(FastAPIHTTPException)
async def http_exception_handler(request: Request, exc: FastAPIHTTPException):
    """HTTPException 处理：确保所有状态码响应都带 CORS 头，避免被 Cloudflare 等代理拦截后丢失 CORS"""
    # 502 会被 Cloudflare 拦截，改为 500 避免 CORS 丢失
    status = 500 if exc.status_code == 502 else exc.status_code
    return JSONResponse(
        status_code=status,
        content={"detail": exc.detail, "status_code": exc.status_code},
        headers={"Access-Control-Allow-Origin": "*"},
    )

@app.exception_handler(Exception)
async def cors_safe_exception_handler(request: Request, exc: Exception):
    """全局异常处理：保证 500 响应也带 CORS 头"""
    if isinstance(exc, FastAPIHTTPException):
        # Already handled by http_exception_handler, but just in case
        status = 500 if exc.status_code == 502 else exc.status_code
        return JSONResponse(
            status_code=status,
            content={"detail": exc.detail, "status_code": exc.status_code},
            headers={"Access-Control-Allow-Origin": "*"},
        )
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)[:300]},
        headers={"Access-Control-Allow-Origin": "*"},
    )


# 鉴权中间件：所有用户 API 必须携带 Supabase JWT
@app.middleware("http")
async def authenticate_user(request: Request, call_next):
    request.state.user_id = ""
    if request.method == "OPTIONS":
        return await call_next(request)
    if path_requires_auth(request.url.path):
        token = get_bearer_token(request)
        request.state.user_id = verify_supabase_token(token)
    response = await call_next(request)
    return response


app.include_router(health_router)
app.include_router(learning_router)
app.include_router(task_queue_router)   # /api/resources/tasks 必须在前，避免被 /api/tasks/{task_id} 类参数路由拦截
app.include_router(task_router)
app.include_router(question_bank_router)
