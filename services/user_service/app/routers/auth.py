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
    get_current_user
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
        role="user",
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
        user.role
    )

    return {
        "access_token": token,
        "token_type": "bearer"
    }


@router.get("/verify")
def verify_token(
    response: Response,
    current_user=Depends(get_current_user)
):

    response.headers["X-User-Id"] = current_user["sub"]
    response.headers["X-User-Role"] = current_user["role"]

    return {
        "valid": True
    }