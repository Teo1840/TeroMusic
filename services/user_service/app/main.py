import logging
import threading
import time
from datetime import datetime, timezone

from fastapi import FastAPI
from sqlalchemy import text

from .database import Base, SessionLocal, engine
from .events import PROFILE_UPDATED, profile_data, publish, username_from_email
from .models import User
from .routers.auth import router as auth_router
from .routers.profile import router as profile_router


logging.basicConfig(level=logging.INFO)
log = logging.getLogger("user.main")

Base.metadata.create_all(bind=engine)

# create_all no agrega columnas a una tabla que ya existe: las bases
# creadas antes del nombre de artista las reciben acá.
with engine.begin() as conn:
    conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(64)"))
    conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ"))


BACKFILL_ROUNDS = 30
BACKFILL_PAUSE_SEC = 10


def backfill_display_names() -> int:
    """Cuentas creadas antes del nombre de artista: les pone el nombre del email
    y avisa a catálogo con user.profile_updated.v1. Solo se guarda si el evento
    llegó a una cola (mandatory): si catálogo todavía no conectó su cola, la
    cuenta queda pendiente para la próxima vuelta. Devuelve cuántas faltan."""
    db = SessionLocal()
    try:
        pending = db.query(User).filter(User.display_name.is_(None)).all()
        done = 0
        for user in pending:
            name = username_from_email(user.email)
            now = datetime.now(timezone.utc)
            data = profile_data(user.id, user.email, name, now)
            if publish(PROFILE_UPDATED, user.id, data, mandatory=True):
                user.display_name = name
                user.profile_updated_at = now
                db.commit()
                done += 1
        if done:
            log.info("Nombre de artista completado en %d cuentas viejas", done)
        return len(pending) - done
    finally:
        db.close()


def backfill_loop() -> None:
    for _ in range(BACKFILL_ROUNDS):
        try:
            if backfill_display_names() == 0:
                return
        except Exception:  # noqa: BLE001
            log.exception("No se pudo completar el nombre de artista de las cuentas viejas")
        time.sleep(BACKFILL_PAUSE_SEC)
    log.error("Quedaron cuentas sin nombre de artista; se reintenta al reiniciar")


# En otro hilo: el servicio arranca aunque RabbitMQ todavía no esté listo.
threading.Thread(target=backfill_loop, daemon=True).start()


app = FastAPI(
    title="User Service",
    version="1.0.0"
)


app.include_router(
    auth_router
)

app.include_router(
    profile_router
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "user_service"
    }
