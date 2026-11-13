"""Cuenta del usuario logueado: perfil, contraseña y baja.

Va por /api/v1/auth/me (el gateway reenvía el Authorization y acá se valida el JWT).
- Cambiar el nombre publica user.profile_updated.v1 (catalog_service actualiza su copia).
- Cambiar la contraseña sube token_version: las otras sesiones dejan de valer y
  esta recibe un token nuevo.
- Borrar la cuenta publica user.deleted.v1: catálogo borra sus canciones y playlists,
  notificaciones sus avisos y métricas deja de contarlo.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..events import DELETED, PROFILE_UPDATED, deleted_data, profile_data, publish, username_from_email
from ..models import User
from ..schemas import AccountDelete, PasswordChange, ProfileResponse, ProfileUpdate, TokenResponse
from ..security import create_access_token, get_current_user, hash_password, verify_password
from .auth import _session_user

router = APIRouter(tags=["profile"])


def _user(current_user: dict, db: Session) -> User:
    return _session_user(current_user, db)


def _profile(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "username": username_from_email(user.email),
        "display_name": user.display_name or username_from_email(user.email),
        "role": user.role,
        "created_at": user.created_at,
    }


def _check_password(user: User, password: str) -> None:
    # 403 y no 401: el front toma 401 como "sesión vencida" y manda al login.
    if not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=403, detail="La contraseña actual no es correcta")


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


@router.post("/me/password", response_model=TokenResponse)
def change_password(
    data: PasswordChange,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cambia la contraseña. Devuelve un token nuevo para esta sesión; los demás
    tokens (otros dispositivos) dejan de valer en el próximo pedido."""
    user = _user(current_user, db)
    _check_password(user, data.current_password)
    if verify_password(data.new_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="La contraseña nueva tiene que ser distinta de la actual")

    user.hashed_password = hash_password(data.new_password)
    user.token_version = (user.token_version or 0) + 1
    db.commit()

    token = create_access_token(
        user.id,
        user.email,
        user.role,
        user.token_version,
        auth_time=current_user.get("auth_time") or current_user.get("iat"),
    )
    return {"access_token": token, "token_type": "bearer"}


@router.delete("/me", status_code=204)
def delete_me(
    data: AccountDelete,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    x_correlation_id: str | None = Header(default=None),
):
    """Borra la cuenta. Desde este momento ningún token suyo pasa por el gateway
    (/verify ya no encuentra al usuario). El resto de los servicios limpian lo
    suyo al recibir user.deleted.v1."""
    user = _user(current_user, db)
    _check_password(user, data.password)

    user_id = user.id
    db.delete(user)
    db.commit()

    background_tasks.add_task(
        publish,
        DELETED,
        user_id,
        deleted_data(user_id, datetime.now(timezone.utc)),
        x_correlation_id,
    )
    return Response(status_code=204)
