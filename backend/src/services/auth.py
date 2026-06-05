from fastapi import HTTPException, Request, WebSocket

from src.services.supabase import get_admin


PUBLIC_HTTP_PATHS = (
    "/health",
    "/api/health",
    "/docs",
    "/openapi.json",
    "/redoc",
)


def _extract_bearer_token(value: str | None) -> str:
    if not value:
        return ""
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return ""
    return token.strip()


def get_bearer_token(request: Request) -> str:
    return _extract_bearer_token(request.headers.get("Authorization"))


def get_ws_token(ws: WebSocket, token: str = "") -> str:
    return token.strip() or _extract_bearer_token(ws.headers.get("Authorization"))


def verify_supabase_token(token: str) -> str:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        user_resp = get_admin().auth.get_user(token)
        user = getattr(user_resp, "user", None)
        user_id = getattr(user, "id", None)
        if not user_id:
            raise ValueError("Supabase token has no user")
        return str(user_id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def path_requires_auth(path: str) -> bool:
    if path in PUBLIC_HTTP_PATHS:
        return False
    if path.startswith("/api/learning/agent/"):
        return False
    return path.startswith("/api/")
