from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Supabase
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # AI
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    embedding_model: str = "text-embedding-3-small"

    # MinerU 文档解析
    mineru_api_token: str = ""
    mineru_base_url: str = "https://mineru.net"
    mineru_model_version: str = "vlm"
    mineru_poll_interval: int = 3
    mineru_poll_max_retries: int = 200

    # Supabase Storage (MinerU 中转用)
    supabase_storage_bucket: str = "temp-uploads"

    # Server
    host: str = "0.0.0.0"
    port: int = 3456

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()