from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://sqlforge:sqlforge@localhost:5433/sqlforge"

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
    def ai_enabled(self) -> bool:
        return bool(self.lightning_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
