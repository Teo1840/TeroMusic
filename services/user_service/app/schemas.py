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


# bcrypt solo usa los primeros 72 bytes: más largo daría una falsa sensación de seguridad.
PASSWORD_MIN = 8
PASSWORD_MAX_BYTES = 72


def _check_password(value: str) -> str:
    if len(value) < PASSWORD_MIN:
        raise ValueError(f"La contraseña tiene que tener al menos {PASSWORD_MIN} caracteres")
    if len(value.encode("utf-8")) > PASSWORD_MAX_BYTES:
        raise ValueError(f"La contraseña puede tener hasta {PASSWORD_MAX_BYTES} bytes")
    return value


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    _password = field_validator("password")(_check_password)
    # Opcional: si no viene, se usa la parte del email antes de la @.
    display_name: str | None = Field(default=None, max_length=64)

    _clean = field_validator("display_name")(_clean_display_name)


class UserLogin(BaseModel):
    email: EmailStr
    # Sin mínimo: las cuentas creadas antes de la regla tienen que poder entrar.
    # El tope evita gastar CPU con contraseñas enormes.
    password: str = Field(max_length=1024)


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


class PasswordChange(BaseModel):
    # La actual sin mínimo, como en el login (cuentas viejas con clave corta).
    current_password: str = Field(max_length=1024)
    new_password: str
    _new = field_validator("new_password")(_check_password)


class AccountDelete(BaseModel):
    # Se pide la contraseña: un token robado no alcanza para borrar la cuenta.
    password: str = Field(max_length=1024)
