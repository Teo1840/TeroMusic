from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Response,
    status
)

from sqlalchemy.orm import Session

from ..database import get_db
from ..events import publish_user_registered
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
        role="user"
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    # Se publica después de responder: el alta no espera a RabbitMQ.
    background_tasks.add_task(
        publish_user_registered,
        user.id,
        user.email,
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

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials"
        )

    if not verify_password(
        data.password,
        user.hashed_password
    ):
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