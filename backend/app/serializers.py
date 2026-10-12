"""Model → JSON helpers shared by routers."""
from __future__ import annotations

from .models import Attachment, Complaint, Document, Station, Ticket, User
from .provenance import COMPLAINT_CATEGORIES
from .services.common import user_brief


def iso(dt):
    return dt.isoformat() + "Z" if dt else None


def station_brief(s: Station | None):
    if not s:
        return None
    return {"id": s.id, "code": s.code, "name": s.display_name, "lines": s.lines}


def attachment_dict(a: Attachment):
    return {"id": a.id, "kind": a.kind, "original_name": a.original_name, "mime_type": a.mime_type,
            "size_bytes": a.size_bytes, "url": f"/api/complaints/attachments/{a.id}", "created_at": iso(a.created_at)}


def complaint_dict(c: Complaint, include_user=False):
    d = {"id": c.id, "complaint_code": c.complaint_code, "description": c.description, "language": c.language,
         "category": c.category, "category_label": COMPLAINT_CATEGORIES.get(c.category, {}),
         "station": station_brief(c.station), "provenance": c.provenance, "created_at": iso(c.created_at),
         "reported_asset": {"id": c.asset.id, "name": c.asset.name, "asset_type": c.asset.asset_type, "provenance": "REPORTED"} if c.asset else None,
         "attachments": [attachment_dict(a) for a in c.attachments],
         "ticket": ticket_brief(c.ticket) if c.ticket else None}
    if include_user:
        d["user"] = user_brief(c.user)
    return d


def ticket_brief(t: Ticket):
    return {"id": t.id, "ticket_code": t.ticket_code, "status": t.status, "priority": t.priority,
            "assigned_team": t.assigned_team, "assignee": user_brief(t.assignee), "updated_at": iso(t.updated_at),
            "created_at": iso(t.created_at), "reopen_count": t.reopen_count, "version": t.version, "closure_type": t.closure_type}


def ticket_row(t: Ticket):
    c = t.complaint
    return {**ticket_brief(t), "complaint_id": c.id, "complaint_code": c.complaint_code, "category": c.category,
            "category_label": COMPLAINT_CATEGORIES.get(c.category, {}).get("en", c.category),
            "station": station_brief(c.station), "summary": c.description[:160], "language": c.language,
            "attachments": len(c.attachments), "priority_reason": t.priority_reason}


def user_dict(u: User):
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "team": u.team,
            "preferred_language": u.preferred_language, "is_active": u.is_active, "is_demo": u.is_demo,
            "created_at": iso(u.created_at), "last_login_at": iso(u.last_login_at)}


def document_dict(d: Document):
    return {"id": d.id, "filename": d.filename, "title": d.title, "category": d.category, "collection": d.collection,
            "file_type": d.file_type, "size_bytes": d.size_bytes, "checksum": d.checksum, "page_count": d.page_count,
            "status": d.status, "error": d.error, "ocr_used": d.ocr_used, "ocr_pages": d.ocr_pages,
            "empty_pages": d.empty_pages, "chunk_count": d.chunk_count, "char_count": d.char_count, "origin": d.origin,
            "doc_kind": d.doc_kind, "duplicate_of_id": d.duplicate_of_id, "rel_path": d.rel_path,
            "created_at": iso(d.created_at), "indexed_at": iso(d.indexed_at), "warnings": (d.meta or {}).get("warnings", []),
            "detected_period": (d.meta or {}).get("detected_period"), "filename_mismatch": (d.meta or {}).get("filename_mismatch"),
            "ocr_pending_pages": len((d.meta or {}).get("ocr_pending_pages") or [])}
