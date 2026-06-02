import time

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])

_start_time = time.time()


@router.get("")
async def health():
    return {"status": "ok", "uptime": round(time.time() - _start_time, 1)}
