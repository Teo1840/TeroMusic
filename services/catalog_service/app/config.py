from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Valores por defecto: AJÚSTALOS a los de tu .env (o define estas
    # variables en el .env de la raíz del repo).
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/songs_db"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_secure: bool = False
    raw_bucket: str = "raw-audio"
    processed_bucket: str = "processed-audio"

    max_upload_mb: int = 100

    # Busca primero el .env de la raíz del repo y luego uno local
    model_config = SettingsConfigDict(env_file=("../../.env", ".env"), extra="ignore")


settings = Settings()
