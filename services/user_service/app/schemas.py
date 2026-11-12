from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr
from typing import Literal

class UserRegister(BaseModel):
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str


class RoleUpdate(BaseModel):
    role: Literal["user", "artist", "admin"]


class UserResponse(BaseModel):
    id: UUID
    email: EmailStr
    role: str
    created_at: datetime

    class Config:
        from_attributes = True