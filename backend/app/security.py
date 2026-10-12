"""Password hashing, JWT issuance and role-based authorization dependencies."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

ROLES = {
    "passenger": {"description": "Raises complaints, tracks own tickets, verifies resolutions",
                  "permissions": ["complaint:create", "complaint:read_own", "ticket:verify_own"]},
    "operator": {"description": "Control-room operator: triage, assign and close tickets",
                 "permissions": ["ticket:read_all", "ticket:assign", "ticket:investigate", "ticket:propose",
                                 "ticket:request_verification", "ticket:close", "ticket:reopen", "chat:use",
                                 "document:upload", "investigation:run"]},
    "engineer": {"description": "Field / maintenance engineer: findings, solutions, work progress",
                 "permissions": ["ticket:read_all", "ticket:investigate", "ticket:finding", "ticket:propose",
                                 "ticket:progress", "ticket:submit_work", "ticket:reopen", "chat:use",
                                 "investigation:run", "incident:record", "maintenance:record"]},
    "supervisor": {"description": "Supervisor: reviews engineer work, approves solutions, oversees overdue and reopened tickets",
                   "permissions": ["ticket:read_all", "ticket:assign", "ticket:investigate", "ticket:propose", "ticket:review",
                                   "solution:approve", "ticket:close", "ticket:reopen", "ticket:request_verification",
                                   "chat:use", "investigation:run", "document:upload"]},
    "admin": {"description": "Administrator: users, ingestion, audited administrative closure, all actions",
              "permissions": ["*"]},
}
STAFF_ROLES = {"operator", "engineer", "supervisor", "admin"}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode())
    except ValueError:
        return False


def create_access_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": str(user.id), "role": user.role, "exp": exp}, settings.jwt_secret,
                      algorithm=settings.jwt_algorithm)


def has_perm(user: User, perm: str) -> bool:
    perms = ROLES.get(user.role, {}).get("permissions", [])
    return "*" in perms or perm in perms


def get_current_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    cred_exc = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated",
                             headers={"WWW-Authenticate": "Bearer"})
    if not token:
        raise cred_exc
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        uid = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise cred_exc
    user = db.get(User, uid)
    if not user or not user.is_active:
        raise cred_exc
    return user


def require_perm(perm: str):
    def dep(user: User = Depends(get_current_user)) -> User:
        if not has_perm(user, perm):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Your role ({user.role}) lacks permission '{perm}'")
        return user
    return dep


def require_staff(user: User = Depends(get_current_user)) -> User:
    if user.role not in STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Staff access required")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator access required")
    return user
