from fastapi import FastAPI

from .database import Base, engine
from .routers.auth import router as auth_router


Base.metadata.create_all(bind=engine)


app = FastAPI(
    title="User Service",
    version="1.0.0"
)


app.include_router(
    auth_router
)


@app.get("/health")
def health():

    return {
        "status": "ok",
        "service": "user_service"
    }