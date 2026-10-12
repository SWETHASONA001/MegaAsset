from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User, utcnow
from ..security import ROLES, create_access_token, get_current_user, hash_password, verify_password
from ..serializers import user_dict
from ..services.common import audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    preferred_language: str = "en"


class LoginIn(BaseModel):
    email: str
    password: str


def _token_response(user: User):
    return {"access_token": create_access_token(user), "token_type": "bearer", "user": user_dict(user),
            "permissions": ROLES[user.role]["permissions"]}


@router.post("/signup")
def signup(body: SignupIn, db: Session = Depends(get_db)):
    if not re.search(r"[A-Za-z]", body.password) or not re.search(r"\d", body.password):
        raise HTTPException(422, "Password must contain letters and numbers")
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    u = User(email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password),
             role="passenger", preferred_language=body.preferred_language if body.preferred_language in ("en", "ta") else "en")
    db.add(u)
    db.flush()
    audit(db, u, "user.signup", "user", u.id)
    u.last_login_at = utcnow()
    db.commit()
    return _token_response(u)


@router.post("/login")
async def login(request: Request, db: Session = Depends(get_db)):
    # Accept JSON or OAuth2 form (for the OpenAPI "Authorize" button)
    if request.headers.get("content-type", "").startswith("application/json"):
        data = LoginIn(**(await request.json()))
        email, password = data.email, data.password
    else:
        form = await request.form()
        email, password = str(form.get("username", "")), str(form.get("password", ""))
    u = db.scalar(select(User).where(User.email == email.lower().strip()))
    if not u or not verify_password(password, u.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    if not u.is_active:
        raise HTTPException(403, "Account disabled")
    u.last_login_at = utcnow()
    audit(db, u, "user.login", "user", u.id)
    db.commit()
    return _token_response(u)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"user": user_dict(user), "permissions": ROLES[user.role]["permissions"]}


class ProfileIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    preferred_language: str | None = None


@router.patch("/me")
def update_me(body: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.full_name:
        user.full_name = body.full_name.strip()
    if body.preferred_language in ("en", "ta"):
        user.preferred_language = body.preferred_language
    db.merge(user)
    db.commit()
    return user_dict(user)


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/change-password")
def change_password(body: PasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    u = db.get(User, user.id)
    if not verify_password(body.current_password, u.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    u.password_hash = hash_password(body.new_password)
    audit(db, u, "user.password_changed", "user", u.id)
    db.commit()
    return {"ok": True}
