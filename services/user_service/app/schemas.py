from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


def _clean_display_name(value: str | None) -> str | None:
    """Saca espacios de más; vacío no vale como nombre de artista."""
    if value is None:
        return None
    value = " ".join(value.split())
    if not value:
        raise ValueError("El nombre de artista no puede estar vacío")
    return value


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    # Opcional: si no viene, se usa la parte del email antes de la @.
    display_name: str | None = Field(default=None, max_length=64)

    _clean = field_validator("display_name")(_clean_display_name)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str


class UserResponse(BaseModel):
    id: UUID
    email: EmailStr
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class ProfileResponse(BaseModel):
    id: UUID
    email: EmailStr
    username: str
    display_name: str
    role: str
    created_at: datetime


class ProfileUpdate(BaseModel):
    display_name: str = Field(max_length=64)

    _clean = field_validator("display_name")(_clean_display_name)
