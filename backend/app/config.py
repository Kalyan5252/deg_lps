from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://sqlforge:sqlforge@localhost:5433/sqlforge"
    # Connection tuning — Postgres runs on a DigitalOcean droplet, reached over a
    # stable SSH tunnel (localhost:5455 -> droplet:5432). Because the droplet is
    # always-on, we REUSE pooled connections instead of recycling after every
    # query (the old min=0/max_queries=1/5s-lifetime values were a workaround for
    # the flaky Lightning Studio tunnel and caused reconnect-per-request stalls).
    # sslmode: disable | require | verify-full  (disable is fine — the SSH tunnel
    # already encrypts the hop; Postgres only listens on the droplet's localhost).
    db_sslmode: str = "disable"
    db_pool_min: int = 1
    db_pool_max: int = 5
    db_pool_max_queries: int = 50000
    db_pool_max_inactive_connection_lifetime: float = 300.0
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
