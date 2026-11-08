from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import (
    UserRegister,
    UserLogin,
    TokenResponse
)
from ..security import (
    hash_password,
    verify_password,
    create_access_token
)


router = APIRouter()


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED
)
def register(
    data: UserRegister,
    db: Session = Depends(get_db)
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

    token = create_access_token(
        user.id,
        user.email
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
        user.email
    )

    return {
        "access_token": token,
        "token_type": "bearer"
    }