from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.routes.health import router as health_router
from src.routes.process import router as task_router
from src.routes.learning import router as learning_router
from src.services.relay_service import relay


@asynccontextmanager
async def lifespan(_app: FastAPI):
    banner = f"""
  ┌─────────────────────────────────────────┐
  │   考研AI助手 · 后端节点 v3.1 (Python)    │
  │   MinerU解析 / 任务队列 / 学习中心中继    │
  ├─────────────────────────────────────────┤
  │   PORT     : {str(settings.port).ljust(29)}│
  │   MODEL    : {settings.embedding_model.ljust(29)}│
  │   BASE_URL : {settings.openai_base_url.ljust(29)}│
  │   MinerU   : {settings.mineru_base_url.ljust(29)}│
  └─────────────────────────────────────────┘
"""
    print(banner)
    await relay.start_cleanup()
    yield
    print("[ky-backend] Shutting down...")


app = FastAPI(title="ky-backend", version="3.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(task_router)
app.include_router(learning_router)
