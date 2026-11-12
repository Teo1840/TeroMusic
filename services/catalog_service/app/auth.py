import uuid

from fastapi import Header, HTTPException


def current_user_id(x_user_id: str | None = Header(default=None)) -> uuid.UUID:
    """Id del usuario autenticado. Lo inyecta el gateway (nginx) en X-User-Id
    después de validar el JWT con user_service. Este servicio no decodifica
    el token: confía en el gateway, por eso no debe exponerse sin él."""
    if not x_user_id:
        raise HTTPException(401, "Falta autenticación (cabecera X-User-Id)")
    try:
        return uuid.UUID(x_user_id)
    except ValueError:
        raise HTTPException(401, "X-User-Id inválido")
