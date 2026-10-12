"""Shared helpers: identifiers, audit logging, notifications, JSON-safe serialisation."""
from __future__ import annotations

import secrets
import string

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AuditLog, Notification, User

_ALPHABET = string.ascii_uppercase + string.digits


def new_code(db: Session, model, column: str, prefix: str, length: int = 8) -> str:
    col = getattr(model, column)
    while True:
        code = f"{prefix}-{''.join(secrets.choice(_ALPHABET) for _ in range(length))}"
        if not db.scalar(select(model.id).where(col == code)):
            return code


def audit(db: Session, actor: User | None, action: str, entity_type: str | None = None,
          entity_id=None, **detail) -> None:
    db.add(AuditLog(actor_id=actor.id if actor else None, action=action, entity_type=entity_type,
                    entity_id=str(entity_id) if entity_id is not None else None, detail=detail))


def notify(db: Session, user_ids, type_: str, title: str, body: str, link: str | None = None) -> None:
    for uid in {u for u in user_ids if u}:
        db.add(Notification(user_id=uid, type=type_, title=title, body=body, link=link))


def staff_ids(db: Session, roles=("operator", "admin"), team: str | None = None) -> list[int]:
    q = select(User.id).where(User.role.in_(roles), User.is_active.is_(True))
    ids = list(db.scalars(q))
    if team:
        team_ids = list(db.scalars(select(User.id).where(User.team == team, User.is_active.is_(True))))
        ids += team_ids
    return ids


def user_brief(u: User | None):
    if not u:
        return None
    return {"id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role, "team": u.team}
