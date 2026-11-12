import logging

from fastapi import FastAPI

from .database import Base, engine
from .routers.auth import router as auth_router
from .routers.users import router as users_router

logging.basicConfig(level=logging.INFO)

Base.metadata.create_all(bind=engine)


app = FastAPI(
    title="User Service",
    version="1.0.0"
)


app.include_router(
    auth_router,
    users_router
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "user_service"
    }