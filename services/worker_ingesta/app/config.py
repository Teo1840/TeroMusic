from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    events_exchange: str = "musicapp.events"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_secure: bool = False
    minio_bucket: str = "audio"  # contrato: un solo bucket, prefijos raw/ y processed/
    processed_prefix: str = "processed/"

    max_attempts: int = 3

    model_config = SettingsConfigDict(extra="ignore")


settings = Settings()
