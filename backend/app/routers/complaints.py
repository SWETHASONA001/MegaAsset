"""Complaint submission (multipart with validated attachments), history and attachment download."""
from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Asset, Attachment, Complaint, Station, Ticket, User
from ..provenance import CATEGORY_TEAM, COMPLAINT_CATEGORIES
from ..security import get_current_user, has_perm
from ..serializers import complaint_dict
from ..services.common import audit, new_code, notify, staff_ids
from ..services.tickets import add_event, initial_priority

router = APIRouter(prefix="/api/complaints", tags=["complaints"])

# kind -> (extensions, MIME prefixes, magic-byte signatures, max MB, max files)
UPLOAD_RULES = {
    "image": ({".jpg", ".jpeg", ".png", ".webp"}, ("image/jpeg", "image/png", "image/webp"),
              [b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"RIFF"], 10, 5),
    "video": ({".mp4", ".webm", ".mov"}, ("video/mp4", "video/webm", "video/quicktime"), None, 50, 2),
    "document": ({".pdf", ".txt", ".docx"}, ("application/pdf", "text/plain",
                 "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                 [b"%PDF", b"PK\x03\x04"], 20, 3),
}
STORE_DIR = {"image": "images", "video": "videos", "document": "attachments"}


@router.get("/categories")
def categories():
    return [{"value": k, **v} for k, v in COMPLAINT_CATEGORIES.items()]


def _validate(kind: str, f: UploadFile, data: bytes):
    exts, mimes, magics, max_mb, _ = UPLOAD_RULES[kind]
    ext = Path(f.filename or "").suffix.lower()
    if ext not in exts:
        raise HTTPException(422, f"{f.filename}: file type {ext or '(none)'} not allowed for {kind}s ({', '.join(sorted(exts))})")
    if (f.content_type or "") not in mimes:
        raise HTTPException(422, f"{f.filename}: content type {f.content_type} not allowed")
    if len(data) == 0:
        raise HTTPException(422, f"{f.filename}: empty file")
    if len(data) > max_mb * 1024 * 1024:
        raise HTTPException(413, f"{f.filename}: exceeds {max_mb} MB limit")
    if magics and ext != ".txt" and not any(data.startswith(m) for m in magics):
        raise HTTPException(422, f"{f.filename}: file content does not match its type")
    if kind == "video" and not (data[4:8] == b"ftyp" or data.startswith(b"\x1a\x45\xdf\xa3")):
        raise HTTPException(422, f"{f.filename}: file content does not match a supported video format")
    return ext


@router.post("")
async def create_complaint(description: str = Form(...), station_id: int = Form(...), category: str = Form(...),
                           language: str = Form("en"), client_request_id: str | None = Form(None),
                           asset_id: int | None = Form(None), images: list[UploadFile] = File(default=[]),
                           videos: list[UploadFile] = File(default=[]), documents: list[UploadFile] = File(default=[]),
                           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    description = description.strip()
    if len(description) < 10:
        raise HTTPException(422, "Please describe the issue in at least 10 characters")
    if len(description) > 4000:
        raise HTTPException(422, "Description is too long (max 4000 characters)")
    if category not in COMPLAINT_CATEGORIES:
        raise HTTPException(422, "Unknown category")
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(422, "Unknown station")
    if language not in ("en", "ta"):
        language = "en"
    if client_request_id:
        client_request_id = client_request_id.strip()[:64]
        existing = db.scalar(select(Complaint).where(Complaint.user_id == user.id, Complaint.client_request_id == client_request_id))
        if existing:  # retry / double-click: return the already-created complaint, never a second ticket
            return {**complaint_dict(existing), "duplicate_request": True}
    asset = None
    if asset_id:
        asset = db.get(Asset, asset_id)
        if not asset or asset.station_id != station.id:
            raise HTTPException(422, "The selected asset does not belong to the selected station")
    # Validate all files before writing anything
    staged = []
    for kind, files in (("image", images), ("video", videos), ("document", documents)):
        files = [f for f in files if f and f.filename]
        if len(files) > UPLOAD_RULES[kind][4]:
            raise HTTPException(422, f"Too many {kind}s (max {UPLOAD_RULES[kind][4]})")
        for f in files:
            data = await f.read()
            ext = _validate(kind, f, data)
            staged.append((kind, f, data, ext))
    written = []
    try:
        c = Complaint(complaint_code=new_code(db, Complaint, "complaint_code", "CMP"), user_id=user.id,
                      description=description, language=language, station_id=station.id, category=category,
                      client_request_id=client_request_id or None, asset_id=asset.id if asset else None)
        db.add(c)
        db.flush()
        try:
            from ..services.similarity import ensure_embedding
            ensure_embedding(db, c)
        except Exception:  # similarity is an enhancement; never block complaint persistence
            pass
        for kind, f, data, ext in staged:
            stored = f"{uuid.uuid4().hex}{ext}"  # never use the client-supplied name on disk
            path = settings.uploads_dir / STORE_DIR[kind] / stored
            path.write_bytes(data)
            written.append(path)
            safe_name = Path(f.filename).name[:200]
            db.add(Attachment(complaint_id=c.id, kind=kind, original_name=safe_name, stored_name=f"{STORE_DIR[kind]}/{stored}",
                              mime_type=f.content_type, size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
        priority, reason = initial_priority(db, station.id, category)
        t = Ticket(ticket_code=new_code(db, Ticket, "ticket_code", "TKT"), complaint_id=c.id, status="RECEIVED",
                   priority=priority, priority_reason=reason, assigned_team=CATEGORY_TEAM.get(category))
        db.add(t)
        db.flush()
        add_event(db, t, user, "COMPLAINT_RECEIVED", f"Complaint {c.complaint_code} submitted", None, "RECEIVED",
                  attachments=len(staged), language=language, reported_asset=asset.asset_code if asset else None)
        notify(db, [user.id], "complaint_submitted", f"Complaint {c.complaint_code} received",
               f"Ticket {t.ticket_code} created for your {COMPLAINT_CATEGORIES[category]['en'].lower()} complaint at {station.display_name}.",
               f"/app/complaints/{c.id}")
        notify(db, staff_ids(db, ("operator", "supervisor", "admin")), "new_ticket", f"New ticket {t.ticket_code} ({priority})",
               f"{COMPLAINT_CATEGORIES[category]['en']} at {station.display_name}", f"/app/tickets/{t.id}")
        audit(db, user, "complaint.create", "complaint", c.complaint_code, ticket=t.ticket_code, attachments=len(staged))
        db.flush()
        from ..services.graph import sync_records
        db.refresh(c)
        sync_records(db, complaint=c)
        db.commit()
    except IntegrityError:
        db.rollback()
        for p in written:
            p.unlink(missing_ok=True)
        existing = db.scalar(select(Complaint).where(Complaint.user_id == user.id, Complaint.client_request_id == client_request_id)) if client_request_id else None
        if existing:  # concurrent duplicate request won the race: return the persisted complaint
            return {**complaint_dict(existing), "duplicate_request": True}
        raise
    except Exception:
        db.rollback()
        for p in written:
            p.unlink(missing_ok=True)
        raise
    db.refresh(c)
    return complaint_dict(c)


@router.get("")
def list_complaints(mine: bool = False, q: str | None = None, page: int = 1, page_size: int = 20,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = select(Complaint)
    if mine or not has_perm(user, "ticket:read_all"):
        query = query.where(Complaint.user_id == user.id)
    if q:
        query = query.where((Complaint.description.ilike(f"%{q}%")) | (Complaint.complaint_code.ilike(f"%{q}%")))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(Complaint.created_at.desc()).offset((page - 1) * page_size).limit(min(page_size, 100)))
    return {"total": total, "items": [complaint_dict(c, include_user=has_perm(user, "ticket:read_all")) for c in rows]}


@router.get("/{complaint_id}")
def get_complaint(complaint_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.get(Complaint, complaint_id)
    if not c:
        raise HTTPException(404, "Complaint not found")
    if c.user_id != user.id and not has_perm(user, "ticket:read_all"):
        raise HTTPException(403, "You can only view your own complaints")
    d = complaint_dict(c, include_user=has_perm(user, "ticket:read_all"))
    if c.ticket:
        from ..models import TicketEvent
        from ..serializers import iso
        from .tickets import PUBLIC_EVENTS, PUBLIC_NOTE
        keep_note = {"COMPLAINT_RECEIVED", "VERIFIED_RESOLVED", "VERIFIED_STILL_EXISTS", "ADMIN_CLOSED", "AUTO_CLOSED"}
        d["timeline"] = [{"event_type": e.event_type, "to_status": e.to_status, "created_at": iso(e.created_at),
                          "note": PUBLIC_NOTE.get(e.event_type, e.note if e.event_type in keep_note else None)}
                         for e in c.ticket.events if e.event_type in PUBLIC_EVENTS]
        d["closure_type"] = c.ticket.closure_type
        d["can_verify"] = c.ticket.status == "AWAITING_VERIFICATION" and c.user_id == user.id
        d["can_reopen"] = c.ticket.status in ("RESOLVED", "CLOSED") and c.user_id == user.id
    return d


@router.get("/attachments/{attachment_id}")
def download_attachment(attachment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    a = db.get(Attachment, attachment_id)
    if not a:
        raise HTTPException(404, "Attachment not found")
    if a.complaint.user_id != user.id and not has_perm(user, "ticket:read_all"):
        raise HTTPException(403, "Not allowed")
    base = settings.uploads_dir.resolve()
    path = (base / a.stored_name).resolve()
    if base not in path.parents or not path.exists():  # path traversal guard
        raise HTTPException(404, "File missing")
    return FileResponse(path, media_type=a.mime_type, filename=a.original_name,
                        content_disposition_type="inline" if a.kind in ("image", "video") else "attachment")
