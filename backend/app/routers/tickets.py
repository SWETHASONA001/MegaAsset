"""Operational ticket workspace: listing with filters, detail aggregation and lifecycle actions."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import (Approval, Asset, Complaint, Document, EngineerFinding, GraphEntity, Incident, Investigation,
                      MaintenanceRecord, ResolutionMemory, RiskAssessment, SolutionProposal, Station, Ticket, User,
                      VerificationRecord, WorkAttachment, WorkSubmission, utcnow)
from ..provenance import COMPLAINT_CATEGORIES, TEAMS
from ..security import get_current_user, has_perm, require_perm, require_staff
from ..serializers import attachment_dict, complaint_dict, iso, station_brief, ticket_row
from ..services.common import audit, user_brief
from ..services.graph import neighbourhood
from ..services.tickets import (ACTIONS, ACTIVE_STATES, STATES, TRANSITIONS, add_event, add_finding, admin_close,
                                ensure_view, passenger_verify, perform_action, policy, record_maintenance, review_solution,
                                review_work, submit_work)

# Ticket events a passenger may see on their own ticket; internal notes (rejections, findings) are hidden.
PUBLIC_EVENTS = {"COMPLAINT_RECEIVED", "STATUS_CHANGE", "ASSIGNED", "WORK_STARTED", "WORK_SUBMITTED", "WORK_APPROVED",
                 "VERIFICATION_REQUESTED", "VERIFIED_RESOLVED", "VERIFIED_STILL_EXISTS", "REOPENED", "CLOSED", "AUTO_CLOSED",
                 "ADMIN_CLOSED", "FINDING_ADDED"}
PUBLIC_NOTE = {"FINDING_ADDED": "An engineer recorded a finding", "WORK_SUBMITTED": "Work completed; under supervisor review",
               "WORK_APPROVED": "Work approved by supervisor", "ASSIGNED": "Assigned to the responsible team",
               "WORK_STARTED": "Work started"}

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

SORTS = {"updated": Ticket.updated_at, "created": Ticket.created_at, "priority": Ticket.priority, "status": Ticket.status}
PRIORITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


@router.get("/meta")
def meta(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    staff = [user_brief(u) for u in db.scalars(select(User).where(User.role.in_(["engineer", "operator", "supervisor", "admin"]), User.is_active.is_(True)))]
    return {"states": STATES, "active_states": ACTIVE_STATES, "transitions": {k: sorted(v) for k, v in TRANSITIONS.items()},
            "teams": TEAMS, "policy": policy(),
            "priorities": ["LOW", "MEDIUM", "HIGH", "CRITICAL"], "staff": staff,
            "categories": [{"value": k, **v} for k, v in COMPLAINT_CATEGORIES.items()]}


@router.get("")
def list_tickets(q: str | None = None, status: list[str] = Query(default=[]), priority: list[str] = Query(default=[]),
                 station_id: int | None = None, category: str | None = None, team: str | None = None,
                 assignee_id: int | None = None, date_from: str | None = None, date_to: str | None = None,
                 mine: bool = False, unassigned: bool = False, active: bool = False, min_age_days: int | None = None,
                 asset_id: int | None = None,
                 sort: str = "updated", order: str = "desc", page: int = 1, page_size: int = 20,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = select(Ticket).join(Complaint)
    if not has_perm(user, "ticket:read_all"):
        query = query.where(Complaint.user_id == user.id)
    if q:
        like = f"%{q}%"
        query = query.where(or_(Ticket.ticket_code.ilike(like), Complaint.complaint_code.ilike(like), Complaint.description.ilike(like)))
    if status:
        query = query.where(Ticket.status.in_(status))
    if priority:
        query = query.where(Ticket.priority.in_(priority))
    if station_id:
        query = query.where(Complaint.station_id == station_id)
    if category:
        query = query.where(Complaint.category == category)
    if team:
        query = query.where(Ticket.assigned_team == team)
    if assignee_id:
        query = query.where(Ticket.assignee_id == assignee_id)
    if mine:
        query = query.where(Ticket.assignee_id == user.id)
    if unassigned:
        query = query.where(Ticket.assignee_id.is_(None))
    if active:
        query = query.where(Ticket.status.in_(ACTIVE_STATES))
    if min_age_days:
        query = query.where(Ticket.created_at <= utcnow() - timedelta(days=min_age_days))
    if asset_id:
        query = query.where(Complaint.asset_id == asset_id)
    if date_from:
        query = query.where(Ticket.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        query = query.where(Ticket.created_at <= datetime.fromisoformat(date_to + "T23:59:59"))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    col = SORTS.get(sort, Ticket.updated_at)
    rows = list(db.scalars(query))
    if sort == "priority":
        rows.sort(key=lambda t: (PRIORITY_ORDER.get(t.priority, 9), -t.updated_at.timestamp()), reverse=(order == "asc"))
    else:
        rows.sort(key=lambda t: getattr(t, col.key) or datetime.min, reverse=(order == "desc"))
    page_size = min(max(page_size, 1), 100)
    items = rows[(page - 1) * page_size: page * page_size]
    counts = {}
    for t in rows:
        counts[t.status] = counts.get(t.status, 0) + 1
    return {"total": total, "page": page, "page_size": page_size, "items": [ticket_row(t) for t in items], "status_counts": counts}


def _get(db, ticket_id) -> Ticket:
    t = db.get(Ticket, ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    return t


def _solution_dict(s: SolutionProposal, db):
    approvals = [{"decision": a.decision, "comment": a.comment, "reviewer": user_brief(a.reviewer), "created_at": iso(a.created_at)}
                 for a in db.scalars(select(Approval).where(Approval.solution_id == s.id))]
    return {"id": s.id, "title": s.title, "problem": s.problem, "rationale": s.rationale, "evidence": s.evidence,
            "benefits": s.benefits, "risks": s.risks, "dependencies": s.dependencies, "missing_info": s.missing_info,
            "approval_requirements": s.approval_requirements, "verification_criteria": s.verification_criteria,
            "status": s.status, "provenance": s.provenance, "investigation_id": s.investigation_id,
            "proposed_by": user_brief(db.get(User, s.proposed_by)) if s.proposed_by else None,
            "created_at": iso(s.created_at), "approvals": approvals}


@router.get("/{ticket_id}")
def ticket_detail(ticket_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _get(db, ticket_id)
    ensure_view(user, t)
    c = t.complaint
    staff = has_perm(user, "ticket:read_all")
    out = {**ticket_row(t), "complaint": complaint_dict(c, include_user=staff), "priority_reason": t.priority_reason,
           "resolved_at": iso(t.resolved_at), "closed_at": iso(t.closed_at),
           "events": [{"id": e.id, "event_type": e.event_type, "from_status": e.from_status, "to_status": e.to_status,
                       "note": e.note if staff else PUBLIC_NOTE.get(e.event_type, e.note if e.event_type in ("COMPLAINT_RECEIVED", "VERIFIED_RESOLVED", "VERIFIED_STILL_EXISTS", "ADMIN_CLOSED", "AUTO_CLOSED") else None),
                       "data": e.data if staff else {}, "actor": user_brief(e.actor) if staff else None, "created_at": iso(e.created_at)}
                      for e in t.events if staff or e.event_type in PUBLIC_EVENTS],
           "policy": policy(),
           "allowed_transitions": sorted(TRANSITIONS.get(t.status, [])),
           "verifications": [{"outcome": v.outcome, "verifier_type": v.verifier_type, "comment": v.comment, "verifier": user_brief(v.verifier) if staff else None,
                              "created_at": iso(v.created_at)} for v in db.scalars(select(VerificationRecord).where(VerificationRecord.ticket_id == t.id))]}
    perms = {a: has_perm(user, p) for a, (_, p) in ACTIONS.items()}
    perms["reopen"] = perms["reopen"] or c.user_id == user.id
    pending = db.scalar(select(WorkSubmission).where(WorkSubmission.ticket_id == t.id, WorkSubmission.status == "SUBMITTED")
                        .order_by(WorkSubmission.id.desc()))
    is_assignee_or_free = (t.assignee_id in (None, user.id)) or user.role == "admin"
    perms.update(finding=has_perm(user, "ticket:finding"), propose=has_perm(user, "ticket:propose"),
                 approve=has_perm(user, "solution:approve"), verify=(c.user_id == user.id or has_perm(user, "ticket:close")),
                 maintenance=has_perm(user, "maintenance:record"), investigate=has_perm(user, "investigation:run"),
                 start_work=has_perm(user, "ticket:progress") and (is_assignee_or_free or user.role == "supervisor"),
                 submit_work=has_perm(user, "ticket:submit_work") and t.status == "IN_PROGRESS" and is_assignee_or_free,
                 review_work=has_perm(user, "ticket:review") and t.status == "PENDING_REVIEW" and bool(pending)
                             and (settings.allow_self_approval or (pending and pending.engineer_id != user.id)),
                 self_review_blocked=bool(has_perm(user, "ticket:review") and pending and pending.engineer_id == user.id and not settings.allow_self_approval),
                 admin_close=user.role == "admin" and t.status != "CLOSED",
                 request_verification=has_perm(user, "ticket:request_verification") and not settings.require_supervisor_review)
    out["permissions"] = perms
    if not staff:
        return out
    out["work_submissions"] = [_work_dict(w) for w in db.scalars(select(WorkSubmission).where(WorkSubmission.ticket_id == t.id).order_by(WorkSubmission.id.desc()))]
    out["station_assets"] = [{"id": a.id, "name": a.name, "asset_type": a.asset_type, "asset_code": a.asset_code}
                             for a in db.scalars(select(Asset).where(Asset.station_id == c.station_id).order_by(Asset.asset_type, Asset.name))]
    from ..services.similarity import similar_complaints
    try:
        out["similar_complaints"] = similar_complaints(db, c, limit=8)
        db.commit()  # persists any newly computed complaint embeddings
    except Exception as exc:
        out["similar_complaints"] = []
        out["similarity_error"] = str(exc)
    out["findings"] = [{"id": f.id, "finding": f.finding, "root_cause": f.root_cause, "cause_verified": f.cause_verified,
                        "confirmed_incident": f.confirmed_incident,
                        "asset_id": f.asset_id, "author": user_brief(f.author), "provenance": f.provenance, "created_at": iso(f.created_at)}
                       for f in db.scalars(select(EngineerFinding).where(EngineerFinding.ticket_id == t.id).order_by(EngineerFinding.id))]
    out["solutions"] = [_solution_dict(s, db) for s in db.scalars(select(SolutionProposal).where(SolutionProposal.ticket_id == t.id).order_by(SolutionProposal.id.desc()))]
    invs = list(db.scalars(select(Investigation).where(Investigation.ticket_id == t.id).order_by(Investigation.id.desc())))
    out["investigations"] = [{"id": i.id, "code": i.code, "status": i.status, "sufficiency": i.sufficiency, "summary": i.summary,
                              "created_at": iso(i.created_at)} for i in invs]
    latest = invs[0] if invs else None
    if latest:
        st = latest.state or {}
        out["analysis"] = {"investigation_id": latest.id, "code": latest.code, "classification": st.get("classification"),
                           "risk": st.get("risk"), "sufficiency": st.get("sufficiency"), "documents": st.get("documents", []),
                           "assets": st.get("assets", []), "operations": st.get("operations", {}), "provenance": "AI_HYPOTHESIS"}
    out["incidents"] = [{"id": i.id, "code": i.code, "title": i.title, "severity": i.severity, "status": i.status, "provenance": i.provenance,
                         "created_at": iso(i.created_at)} for i in db.scalars(select(Incident).where(Incident.ticket_id == t.id))]
    out["maintenance"] = [{"id": m.id, "work_type": m.work_type, "description": m.description, "status": m.status,
                           "created_at": iso(m.created_at)} for m in db.scalars(select(MaintenanceRecord).where(MaintenanceRecord.ticket_id == t.id))]
    related = db.scalars(select(Complaint).where(Complaint.station_id == c.station_id, Complaint.id != c.id)
                         .order_by(Complaint.created_at.desc()).limit(8))
    out["related_complaints"] = [{"id": r.id, "complaint_code": r.complaint_code, "category": r.category, "summary": r.description[:120],
                                  "same_category": r.category == c.category, "ticket_id": r.ticket.id if r.ticket else None,
                                  "status": r.ticket.status if r.ticket else None, "created_at": iso(r.created_at)} for r in related]
    g = neighbourhood(db, [f"complaint:{c.complaint_code}", f"station:{c.station.code}"], depth=1, limit=40)
    out["graph"] = g
    out["resolution_memory"] = [{"id": m.id, "outcome": m.outcome, "action": m.approved_action, "created_at": iso(m.created_at)}
                                for m in db.scalars(select(ResolutionMemory).where(ResolutionMemory.ticket_id == t.id))]
    return out


def _work_dict(w: WorkSubmission):
    return {"id": w.id, "solution": w.solution, "action_taken": w.action_taken, "notes": w.notes, "status": w.status,
            "asset": {"id": w.asset_id} if w.asset_id else None, "engineer": user_brief(w.engineer), "reviewer": user_brief(w.reviewer),
            "review_reason": w.review_reason, "review_type": w.review_type, "reviewed_at": iso(w.reviewed_at), "created_at": iso(w.created_at),
            "attachments": [{"id": a.id, "kind": a.kind, "original_name": a.original_name, "size_bytes": a.size_bytes,
                             "url": f"/api/tickets/work-attachments/{a.id}"} for a in w.attachments]}


class ActionIn(BaseModel):
    action: str
    note: str | None = Field(default=None, max_length=2000)
    team: str | None = None
    assignee_id: int | None = None
    expected_version: int | None = None


@router.post("/{ticket_id}/actions")
def ticket_action(ticket_id: int, body: ActionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _get(db, ticket_id)
    ensure_view(user, t)
    if body.team and body.team not in TEAMS:
        raise HTTPException(422, "Unknown team")
    perform_action(db, t, body.action, user, body.note, body.team, body.assignee_id, body.expected_version)
    db.commit()
    return ticket_row(t)


@router.post("/{ticket_id}/work")
async def post_work(ticket_id: int, solution: str = Form(...), action_taken: str = Form(...), notes: str | None = Form(None),
                    asset_id: int | None = Form(None), expected_version: int | None = Form(None),
                    files: list[UploadFile] = File(default=[]), user: User = Depends(require_staff), db: Session = Depends(get_db)):
    from .complaints import STORE_DIR, UPLOAD_RULES, _validate
    t = _get(db, ticket_id)
    staged = []
    for f in [f for f in files if f and f.filename][:5]:
        ext = Path(f.filename).suffix.lower()
        kind = next((k for k, r in UPLOAD_RULES.items() if ext in r[0]), None)
        if not kind:
            raise HTTPException(422, f"{f.filename}: file type not allowed")
        data = await f.read()
        _validate(kind, f, data)
        staged.append((kind, f, data, ext))
    ws = submit_work(db, t, user, solution, action_taken, notes, asset_id, expected_version)
    written = []
    try:
        for kind, f, data, ext in staged:
            stored = f"{uuid.uuid4().hex}{ext}"
            path = settings.uploads_dir / STORE_DIR[kind] / stored
            path.write_bytes(data)
            written.append(path)
            db.add(WorkAttachment(submission_id=ws.id, kind=kind, original_name=Path(f.filename).name[:200], stored_name=f"{STORE_DIR[kind]}/{stored}",
                                  mime_type=f.content_type, size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
        db.commit()
    except Exception:
        db.rollback()
        for pth in written:
            pth.unlink(missing_ok=True)
        raise
    db.refresh(ws)
    return {"ticket": ticket_row(t), "submission": _work_dict(ws)}


class ReviewWorkIn(BaseModel):
    decision: str
    reason: str | None = Field(default=None, max_length=2000)
    review_type: str | None = None
    expected_version: int | None = None


@router.post("/{ticket_id}/review")
def post_review(ticket_id: int, body: ReviewWorkIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = _get(db, ticket_id)
    ws = review_work(db, t, user, body.decision, body.reason, body.review_type, body.expected_version)
    db.commit()
    return {"ticket": ticket_row(t), "submission": _work_dict(ws)}


class AdminCloseIn(BaseModel):
    reason: str = Field(min_length=10, max_length=2000)
    expected_version: int | None = None


@router.post("/{ticket_id}/admin-close")
def post_admin_close(ticket_id: int, body: AdminCloseIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = _get(db, ticket_id)
    admin_close(db, t, user, body.reason, body.expected_version)
    db.commit()
    return ticket_row(t)


@router.get("/{ticket_id}/similar")
def similar(ticket_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    from ..services.similarity import similar_complaints
    t = _get(db, ticket_id)
    out = similar_complaints(db, t.complaint, limit=15)
    db.commit()
    return {"threshold": settings.complaint_similarity_threshold, "items": out,
            "note": "Similarity links reports that read alike. Complaints are never merged and similarity does not confirm a shared fault."}


@router.get("/work-attachments/{attachment_id}")
def work_attachment(attachment_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    a = db.get(WorkAttachment, attachment_id)
    if not a:
        raise HTTPException(404, "Attachment not found")
    base = settings.uploads_dir.resolve()
    path = (base / a.stored_name).resolve()
    if base not in path.parents or not path.exists():
        raise HTTPException(404, "File missing")
    return FileResponse(path, media_type=a.mime_type, filename=a.original_name)


class FindingIn(BaseModel):
    finding: str = Field(min_length=5, max_length=4000)
    root_cause: str | None = Field(default=None, max_length=2000)
    cause_verified: bool = False
    confirmed_incident: bool = False
    asset_id: int | None = None


@router.post("/{ticket_id}/findings")
def post_finding(ticket_id: int, body: FindingIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = _get(db, ticket_id)
    f = add_finding(db, t, user, body.finding, body.root_cause, body.confirmed_incident, body.asset_id, body.cause_verified)
    db.commit()
    return {"id": f.id}


class SolutionIn(BaseModel):
    title: str = Field(min_length=5, max_length=255)
    problem: str = Field(min_length=5)
    rationale: str = Field(min_length=5)
    benefits: list[str] = []
    risks: list[str] = []
    dependencies: list[str] = []
    missing_info: list[str] = []
    verification_criteria: list[str] = []


@router.post("/{ticket_id}/solutions")
def propose_solution(ticket_id: int, body: SolutionIn, user: User = Depends(require_perm("ticket:propose")), db: Session = Depends(get_db)):
    t = _get(db, ticket_id)
    s = SolutionProposal(ticket_id=t.id, title=body.title, problem=body.problem, rationale=body.rationale,
                         evidence=[{"type": "staff", "provenance": "REQUIRES_REVIEW", "excerpt": f"Proposed by {user.full_name} ({user.role})"}],
                         benefits=body.benefits, risks=body.risks, dependencies=body.dependencies, missing_info=body.missing_info,
                         approval_requirements=["Supervisor approval in MegaAsset-Agentic"], verification_criteria=body.verification_criteria,
                         status="PROPOSED", provenance="REQUIRES_REVIEW", proposed_by=user.id)
    db.add(s)
    db.flush()
    add_event(db, t, user, "SOLUTION_PROPOSED", body.title, solution_id=s.id)
    audit(db, user, "solution.propose", "ticket", t.ticket_code, solution_id=s.id)
    db.commit()
    return _solution_dict(s, db)


class ReviewIn(BaseModel):
    decision: str
    comment: str | None = None


@router.post("/solutions/{solution_id}/review")
def review(solution_id: int, body: ReviewIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = db.get(SolutionProposal, solution_id)
    if not s:
        raise HTTPException(404, "Solution not found")
    review_solution(db, s, user, body.decision, body.comment)
    db.commit()
    return _solution_dict(s, db)


class VerifyIn(BaseModel):
    outcome: str
    comment: str | None = Field(default=None, max_length=2000)
    expected_version: int | None = None


@router.post("/{ticket_id}/verify")
def verify(ticket_id: int, body: VerifyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _get(db, ticket_id)
    ensure_view(user, t)
    passenger_verify(db, t, user, body.outcome, body.comment, body.expected_version)
    db.commit()
    return ticket_row(t)


class MaintenanceIn(BaseModel):
    work_type: str = Field(min_length=3, max_length=48)
    description: str = Field(min_length=5)
    status: str = "COMPLETED"
    asset_id: int | None = None


@router.post("/{ticket_id}/maintenance")
def maintenance(ticket_id: int, body: MaintenanceIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = _get(db, ticket_id)
    if body.status not in ("PLANNED", "IN_PROGRESS", "COMPLETED"):
        raise HTTPException(422, "Invalid status")
    m = record_maintenance(db, t, user, body.work_type, body.description, body.status, body.asset_id)
    db.commit()
    return {"id": m.id}
