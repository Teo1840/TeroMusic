"""Administración de cuentas: solo para usuarios con rol "admin".

Roles:
  user  → el de todos al registrarse. Sube canciones, arma playlists, crea salas.
  admin → además ve todas las cuentas, cambia roles, borra canciones de cualquiera
          (catalog_service) y cierra cualquier sala (rooms_service).

El primer admin se define con ADMIN_EMAILS (ver main.py y security.initial_role).
Va por /api/v1/auth/admin/... : el gateway reenvía el Authorization y acá se valida
el JWT; el rol se lee de la base, no del token, así un cambio vale al instante.
"""
import logging
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..security import ADMIN, get_current_user, session_matches

log = logging.getLogger("user.admin")

router = APIRouter(prefix="/admin", tags=["admin"])


def current_db_user(current_user: dict, db: Session) -> User:
    """Usuario del token según la base. 401 si la cuenta ya no existe o la sesión
    fue revocada (cambio de contraseña), igual que /verify."""
    try:
        user = db.get(User, uuid.UUID(current_user["sub"]))
    except ValueError:
        user = None
    if not session_matches(current_user, user):
        raise HTTPException(status_code=401, detail="Session revoked")
    return user


def require_admin(current_user=Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    user = current_db_user(current_user, db)
    if user.role != ADMIN:
        raise HTTPException(status_code=403, detail="Solo para administradores")
    return user


class AdminUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str | None
    role: str
    created_at: datetime


class RoleUpdate(BaseModel):
    role: Literal["user", "admin"]


@router.get("/users", response_model=list[AdminUser])
def list_users(
    q: str | None = Query(default=None, max_length=100, description="Busca en email y nombre de artista"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    text = (q or "").strip().lower()
    if text:
        query = query.filter(or_(
            func.lower(User.email).contains(text, autoescape=True),
            func.lower(User.display_name).contains(text, autoescape=True),
        ))
    return query.order_by(User.created_at.desc(), User.id).offset(offset).limit(limit).all()


@router.patch("/users/{user_id}/role", response_model=AdminUser)
def set_role(
    user_id: uuid.UUID,
    data: RoleUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.role == data.role:
        return user

    if user.role == ADMIN:
        # Bloquea las filas de los admins: si dos se quitan el rol a la vez, el
        # segundo ve que ya queda uno solo.
        admins = db.query(User).filter(User.role == ADMIN).with_for_update().all()
        if len(admins) <= 1:
            raise HTTPException(status_code=409, detail="Tiene que quedar al menos un administrador")

    user.role = data.role
    db.commit()
    db.refresh(user)
    log.info("Rol de %s cambiado a %s por %s", user.id, user.role, admin.id)
    return user
