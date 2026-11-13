import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext


SECRET_KEY = os.getenv("JWT_SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY is not configured")


ALGORITHM = "HS256"

# Roles (ver routers/admin.py). Las cuentas de ADMIN_EMAILS (separados por coma)
# son admin desde que se registran, y al arrancar se promueven si ya existían.
USER = "user"
ADMIN = "admin"
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ADMIN_EMAILS", "").split(",")
    if email.strip()
}


def initial_role(email: str) -> str:
    return ADMIN if email.lower() in ADMIN_EMAILS else USER


ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60")
)


pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)

bearer_scheme = HTTPBearer()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(
    plain_password: str,
    hashed_password: str
) -> bool:
    return pwd_context.verify(
        plain_password,
        hashed_password
    )


# Tope de una sesión aunque se renueve: pasado este tiempo desde el login hay
# que volver a poner la contraseña.
SESSION_MAX_HOURS = int(
    os.getenv("SESSION_MAX_HOURS", "168")
)


def create_access_token(
    user_id,
    email: str,
    role: str,
    version: int = 0,
    auth_time: int | None = None
) -> str:
    """JWT de la sesión. auth_time es el momento del login (segundos epoch):
    se conserva al renovar para respetar SESSION_MAX_HOURS. ver = token_version."""

    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "ver": version,
        "iat": int(now.timestamp()),
        "auth_time": auth_time if auth_time is not None else int(now.timestamp()),
        "exp": expire
    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


def session_matches(payload: dict, user) -> bool:
    """El usuario sigue existiendo y el token es de su contraseña actual.
    Los tokens anteriores a token_version no traen "ver": cuentan como 0."""
    return user is not None and payload.get("ver", 0) == (user.token_version or 0)


def session_expired(payload: dict, now: datetime | None = None) -> bool:
    """Pasó SESSION_MAX_HOURS desde el login: no se renueva más."""
    now = now or datetime.now(timezone.utc)
    started = payload.get("auth_time") or payload.get("iat")
    if not isinstance(started, (int, float)):
        return True
    return now.timestamp() - started > SESSION_MAX_HOURS * 3600


def decode_token(token: str) -> dict:

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        if not payload.get("sub"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )

        return payload

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(
        bearer_scheme
    )
):
    return decode_token(credentials.credentials)