import uuid

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    email = Column(
        String(255),
        unique=True,
        nullable=False,
        index=True
    )

    hashed_password = Column(
        String(255),
        nullable=False
    )

    role = Column(
        String(50),
        nullable=False,
        default="user"
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    # Nombre de artista que se ve en el catálogo. NULL en cuentas viejas
    # hasta que main.backfill_display_names lo completa.
    display_name = Column(
        String(64),
        nullable=True
    )

    profile_updated_at = Column(
        DateTime(timezone=True),
        nullable=True
    )

    # Sube en cada cambio de contraseña. Va en el JWT ("ver"): un token con un
    # número viejo deja de valer, así cambiar la clave cierra las otras sesiones.
    token_version = Column(
        Integer,
        nullable=False,
        default=0,
        server_default="0"
    )
