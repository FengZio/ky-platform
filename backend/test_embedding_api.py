import os
import sys

import httpx


def mask_secret(value: str) -> str:
    if not value:
        return "<empty>"
    if len(value) <= 10:
        return "<set>"
    return f"{value[:5]}...{value[-4:]}"


def main() -> int:
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    api_key = os.getenv("OPENAI_API_KEY", "")
    model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

    print(f"OPENAI_BASE_URL={base_url}")
    print(f"OPENAI_API_KEY={mask_secret(api_key)}")
    print(f"EMBEDDING_MODEL={model}")

    if not api_key:
        print("ERROR: OPENAI_API_KEY is empty", file=sys.stderr)
        return 2

    try:
        response = httpx.post(
            f"{base_url}/embeddings",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "input": "embedding connectivity test",
            },
            timeout=httpx.Timeout(connect=15.0, read=60.0, write=15.0, pool=15.0),
        )
    except Exception as exc:
        print(f"REQUEST_FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(f"HTTP_STATUS={response.status_code}")
    if response.status_code != 200:
        print(f"ERROR_BODY={response.text[:1000]}")
        return 1

    try:
        data = response.json()
        embedding = data.get("data", [{}])[0].get("embedding")
    except Exception as exc:
        print(f"INVALID_JSON: {type(exc).__name__}: {exc}", file=sys.stderr)
        print(f"RAW_BODY={response.text[:1000]}")
        return 1

    if not embedding:
        print("ERROR: response has no embedding")
        print(f"RAW_BODY={response.text[:1000]}")
        return 1

    print(f"OK embedding_dims={len(embedding)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
