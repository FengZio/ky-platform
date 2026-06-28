import asyncio
import os
import sys

from src.config import settings
from src.services.embedding import get_embedding
from src.services.supabase import get_admin, get_ai_config_for_client, get_user_client


def mask_secret(value: str) -> str:
    if not value:
        return "<empty>"
    if len(value) <= 10:
        return "<set>"
    return f"{value[:5]}...{value[-4:]}"


def print_config(label: str, api_key: str, base_url: str, model: str) -> None:
    print(f"[{label}] base_url={base_url or '<empty>'}")
    print(f"[{label}] api_key={mask_secret(api_key)}")
    print(f"[{label}] model={model or '<empty>'}")


async def try_embedding(label: str) -> bool:
    try:
        embedding = await get_embedding("mcp embedding path connectivity test")
    except Exception as exc:
        print(f"[{label}] FAILED {type(exc).__name__}: {exc}")
        return False
    print(f"[{label}] OK dims={len(embedding)}")
    return True


async def main() -> int:
    print("== process env ==")
    print_config(
        "env",
        os.getenv("OPENAI_API_KEY", ""),
        os.getenv("OPENAI_BASE_URL", ""),
        os.getenv("EMBEDDING_MODEL", ""),
    )

    print("\n== backend settings ==")
    print_config(
        "settings",
        settings.openai_api_key,
        settings.openai_base_url,
        settings.embedding_model,
    )

    print("\n== direct get_embedding with current env/settings ==")
    direct_ok = await try_embedding("direct")

    access_token = os.getenv("SUPABASE_ACCESS_TOKEN", "").strip()
    if not access_token:
        print("\n== supabase ai_configs ==")
        print("SKIP: SUPABASE_ACCESS_TOKEN is empty, cannot test MCP user-client config read.")
        print("\n== supabase ai_configs via service role read-only ==")
        try:
            admin = get_admin()
            response = (
                admin.table("ai_configs")
                .select("id,is_active,api_key,base_url,embed_api_key,embed_base_url,embed_model")
                .execute()
            )
            rows = response.data or []
        except Exception as exc:
            print(f"[admin_ai_configs] FAILED {type(exc).__name__}: {exc}")
            return 1 if not direct_ok else 0

        if not rows:
            print("[admin_ai_configs] no rows found")
            return 0 if direct_ok else 1

        for index, row in enumerate(rows, 1):
            label = f"ai_config#{index} active={row.get('is_active')}"
            print_config(
                label,
                row.get("embed_api_key") or row.get("api_key") or "",
                row.get("embed_base_url") or row.get("base_url") or "",
                row.get("embed_model") or row.get("embedding_model") or "",
            )
            if row.get("is_active"):
                old_api_key = os.environ.get("OPENAI_API_KEY")
                old_base_url = os.environ.get("OPENAI_BASE_URL")
                old_model = os.environ.get("EMBEDDING_MODEL")
                try:
                    os.environ["OPENAI_API_KEY"] = row.get("embed_api_key") or row.get("api_key") or ""
                    os.environ["OPENAI_BASE_URL"] = row.get("embed_base_url") or row.get("base_url") or ""
                    os.environ["EMBEDDING_MODEL"] = row.get("embed_model") or row.get("embedding_model") or ""
                    await try_embedding(label)
                finally:
                    if old_api_key is None:
                        os.environ.pop("OPENAI_API_KEY", None)
                    else:
                        os.environ["OPENAI_API_KEY"] = old_api_key
                    if old_base_url is None:
                        os.environ.pop("OPENAI_BASE_URL", None)
                    else:
                        os.environ["OPENAI_BASE_URL"] = old_base_url
                    if old_model is None:
                        os.environ.pop("EMBEDDING_MODEL", None)
                    else:
                        os.environ["EMBEDDING_MODEL"] = old_model
        return 0 if direct_ok else 1

    print("\n== supabase ai_configs via user client ==")
    try:
        client = get_user_client(access_token)
        cfg = await get_ai_config_for_client(client)
    except Exception as exc:
        print(f"[ai_configs] FAILED {type(exc).__name__}: {exc}")
        return 1

    print_config(
        "ai_configs",
        cfg.get("api_key", ""),
        cfg.get("base_url", ""),
        cfg.get("embed_model", ""),
    )

    old_api_key = os.environ.get("OPENAI_API_KEY")
    old_base_url = os.environ.get("OPENAI_BASE_URL")
    old_model = os.environ.get("EMBEDDING_MODEL")
    try:
        os.environ["OPENAI_API_KEY"] = cfg.get("api_key", "") or ""
        os.environ["OPENAI_BASE_URL"] = cfg.get("base_url", "") or ""
        os.environ["EMBEDDING_MODEL"] = cfg.get("embed_model", "") or ""
        print("\n== get_embedding after MCP ai_configs override ==")
        mcp_ok = await try_embedding("mcp_override")
    finally:
        if old_api_key is None:
            os.environ.pop("OPENAI_API_KEY", None)
        else:
            os.environ["OPENAI_API_KEY"] = old_api_key
        if old_base_url is None:
            os.environ.pop("OPENAI_BASE_URL", None)
        else:
            os.environ["OPENAI_BASE_URL"] = old_base_url
        if old_model is None:
            os.environ.pop("EMBEDDING_MODEL", None)
        else:
            os.environ["EMBEDDING_MODEL"] = old_model

    return 0 if direct_ok and mcp_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
