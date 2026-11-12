from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import RoleUpdate
from ..security import get_current_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/{user_id}/public")
def get_public_profile(
    user_id: UUID,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return {
        "id": str(user.id),
        "role": user.role
    }

@router.put("/{user_id}/role")
def update_user_role(
    user_id: UUID,
    data: RoleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )

    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    user.role = data.role

    db.commit()
    db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "role": user.role
    }