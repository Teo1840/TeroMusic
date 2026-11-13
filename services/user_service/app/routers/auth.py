import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Response,
    status
)

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..events import REGISTERED, publish, registered_data, username_from_email
from ..models import User
from ..schemas import (
    UserRegister,
    UserLogin,
    TokenResponse
)
from ..security import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    initial_role,
    session_expired,
    session_matches
)


router = APIRouter()

DUMMY_HASH = hash_password("relleno-para-igualar-tiempos")


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED
)
def register(
    data: UserRegister,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_correlation_id: str | None = Header(default=None)
):

    existing_user = (
        db.query(User)
        .filter(User.email == data.email)
        .first()
    )

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Email already registered"
        )

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        role=initial_role(data.email),
        display_name=data.display_name or username_from_email(data.email)
    )

    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Dos registros simultáneos con el mismo email: los dos pasan la consulta
        # de arriba y el índice único frena al segundo.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Email already registered"
        )
    db.refresh(user)

    # Se publica después de responder: el alta no espera a RabbitMQ.
    background_tasks.add_task(
        publish,
        REGISTERED,
        user.id,
        registered_data(user.id, user.email, user.display_name),
        x_correlation_id
    )

    token = create_access_token(
        user.id,
        user.email,
        user.role
    )

    return {
        "access_token": token,
        "token_type": "bearer"
    }


@router.post(
    "/login",
    response_model=TokenResponse
)
def login(
    data: UserLogin,
    db: Session = Depends(get_db)
):

    user = (
        db.query(User)
        .filter(User.email == data.email)
        .first()
    )

    # Si el email no existe se compara igual contra un hash de relleno: así la
    # respuesta tarda lo mismo y no revela qué emails están registrados.
    hashed = user.hashed_password if user else DUMMY_HASH
    password_ok = verify_password(data.password, hashed)

    if not user or not password_ok:
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials"
        )

    token = create_access_token(
        user.id,
        user.email,
        user.role,
        user.token_version or 0
    )

    return {
        "access_token": token,
        "token_type": "bearer"
    }


def _session_user(current_user: dict, db: Session) -> User:
    """Usuario del token si la sesión sigue valiendo: la cuenta existe y la
    contraseña no cambió desde que se emitió (si no, 401)."""
    try:
        user = db.get(User, uuid.UUID(current_user["sub"]))
    except ValueError:
        user = None
    if not session_matches(current_user, user):
        raise HTTPException(
            status_code=401,
            detail="Session revoked"
        )
    return user


@router.post(
    "/refresh",
    response_model=TokenResponse
)
def refresh(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Cambia un token vigente por otro nuevo (otros 60 minutos), así la sesión
    no se corta mientras se usa la app. Un token vencido ya no se renueva, y
    tampoco pasado SESSION_MAX_HOURS desde el login."""
    user = _session_user(current_user, db)
    if session_expired(current_user):
        raise HTTPException(
            status_code=401,
            detail="Session too old, log in again"
        )

    token = create_access_token(
        user.id,
        user.email,
        user.role,
        user.token_version or 0,
        auth_time=current_user.get("auth_time") or current_user.get("iat")
    )

    return {
        "access_token": token,
        "token_type": "bearer"
    }


@router.get("/verify")
def verify_token(
    response: Response,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Una consulta por clave primaria: así una cuenta borrada o una contraseña
    # cambiada cortan las sesiones abiertas al instante, sin esperar a que venzan.
    # El rol también sale de la base: un cambio de rol (routers/admin.py) vale al instante.
    user = _session_user(current_user, db)

    response.headers["X-User-Id"] = str(user.id)
    response.headers["X-User-Role"] = user.role

    return {
        "valid": True
    }