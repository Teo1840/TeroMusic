"""Perfil del usuario logueado: ver y cambiar el nombre de artista.

Va por /api/v1/auth/me (el gateway reenvía el Authorization y acá se valida el JWT).
Cada cambio publica user.profile_updated.v1 para que catalog_service actualice su copia.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..events import PROFILE_UPDATED, profile_data, publish, username_from_email
from ..models import User
from ..schemas import ProfileResponse, ProfileUpdate
from ..security import get_current_user

router = APIRouter(tags=["profile"])


def _user(current_user: dict, db: Session) -> User:
    user = db.get(User, uuid.UUID(current_user["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def _profile(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "username": username_from_email(user.email),
        "display_name": user.display_name or username_from_email(user.email),
        "role": user.role,
        "created_at": user.created_at,
    }


@router.get("/me", response_model=ProfileResponse)
def get_me(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return _profile(_user(current_user, db))


@router.patch("/me", response_model=ProfileResponse)
def update_me(
    data: ProfileUpdate,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    x_correlation_id: str | None = Header(default=None),
):
    user = _user(current_user, db)
    if user.display_name != data.display_name:
        user.display_name = data.display_name
        user.profile_updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user)
        background_tasks.add_task(
            publish,
            PROFILE_UPDATED,
            user.id,
            profile_data(user.id, user.email, user.display_name, user.profile_updated_at),
            x_correlation_id,
        )
    return _profile(user)
