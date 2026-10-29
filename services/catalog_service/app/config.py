from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/songs_db"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_secure: bool = False

    # Contrato: un solo bucket "audio"; los originales van bajo raw/
    # y los procesados bajo processed/
    minio_bucket: str = "audio"
    raw_prefix: str = "raw/"
    processed_prefix: str = "processed/"

    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    events_exchange: str = "musicapp.events"

    max_upload_mb: int = 100

    model_config = SettingsConfigDict(env_file=("../../.env", ".env"), extra="ignore")


settings = Settings()
