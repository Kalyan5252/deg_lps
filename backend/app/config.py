from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://sqlforge:sqlforge@localhost:5433/sqlforge"
    # Connection tuning — works for both a local Postgres and a remote one
    # (e.g. Postgres running in a Lightning Studio, reached directly or over an
    # SSH tunnel). sslmode: disable | require | verify-full
    db_sslmode: str = "disable"
    db_pool_min: int = 1
    db_pool_max: int = 4
    db_connect_timeout: int = 30
    db_connect_retries: int = 10  # remote DBs may take a moment to accept conns

    jwt_secret: str = "change-me-in-production"
    jwt_ttl_hours: int = 720

    lightning_api_key: str = ""
    ai_base_url: str = "https://lightning.ai/api/v1"
    ai_model: str = "lightning-ai/gemma-4-31B-it"
    ai_timeout_seconds: int = 60

    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def _is_local_ai(self) -> bool:
        u = self.ai_base_url.lower()
        return any(s in u for s in ("localhost", "127.0.0.1", "11434", "ollama"))

    @property
    def ai_enabled(self) -> bool:
        # A key enables hosted providers; local providers (Ollama) need no key.
        return bool(self.lightning_api_key.strip()) or self._is_local_ai


@lru_cache
def get_settings() -> Settings:
    return Settings()
