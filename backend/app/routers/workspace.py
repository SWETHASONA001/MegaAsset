"""Role workspaces and station aggregates: live station activity counts, station inventory with reliability tiers,
engineer work queue and supervisor review queue. All counts are computed in the database from real records."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, distinct, func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import (Asset, Complaint, EngineerFinding, GraphEntity, GraphRelationship, Investigation, ResolutionMemory,
                      Station, Ticket, TicketEvent, User, WorkSubmission, utcnow)
from ..provenance import COMPLAINT_CATEGORIES
from ..security import get_current_user, has_perm, require_perm, require_staff
from ..serializers import iso, station_brief, ticket_row
from ..services.common import user_brief
from ..services.tickets import ACTIVE_STATES, policy

router = APIRouter(prefix="/api", tags=["workspace"])

PRIORITY_RANK = case((Ticket.priority == "CRITICAL", 4), (Ticket.priority == "HIGH", 3), (Ticket.priority == "MEDIUM", 2),
                     (Ticket.priority == "LOW", 1), else_=0)
RANK_NAME = {4: "CRITICAL", 3: "HIGH", 2: "MEDIUM", 1: "LOW"}


@router.get("/stations/activity")
def station_activity(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Per-station live counts. Active = ticket status not RESOLVED/CLOSED. Complaint and ticket counts are kept separate."""
    rows = db.execute(
        select(Complaint.station_id,
               func.count(distinct(Complaint.id)).label("active_complaints"),
               func.count(distinct(Ticket.id)).label("open_tickets"),
               func.sum(case((Ticket.status == "PENDING_REVIEW", 1), else_=0)).label("pending_review"),
               func.sum(case((Ticket.status == "AWAITING_VERIFICATION", 1), else_=0)).label("awaiting_verification"),
               func.sum(case((Ticket.status == "REOPENED", 1), else_=0)).label("reopened"),
               func.max(PRIORITY_RANK).label("max_rank"))
        .join(Ticket, Ticket.complaint_id == Complaint.id)
        .where(Ticket.status.in_(ACTIVE_STATES)).group_by(Complaint.station_id)).all()
    agg = {r.station_id: r for r in rows}
    totals = dict(db.execute(select(Complaint.station_id, func.count(Complaint.id)).group_by(Complaint.station_id)).all())
    assets = dict(db.execute(select(Asset.station_id, func.count(Asset.id)).where(Asset.asset_type != "station_entrance")
                             .group_by(Asset.station_id)).all())
    items = []
    for s in db.scalars(select(Station).order_by(Station.display_name)):
        r = agg.get(s.id)
        rank = r.max_rank if r else 0
        items.append({"id": s.id, "code": s.code, "name": s.display_name, "lines": s.lines,
                      "active_complaints": r.active_complaints if r else 0, "open_tickets": r.open_tickets if r else 0,
                      "pending_review": int(r.pending_review or 0) if r else 0,
                      "awaiting_verification": int(r.awaiting_verification or 0) if r else 0,
                      "reopened": int(r.reopened or 0) if r else 0, "total_complaints": totals.get(s.id, 0),
                      "highest_open_priority": RANK_NAME.get(rank), "severity": "high" if rank >= 3 else "medium" if rank == 2 else "low" if rank == 1 else "none",
                      "documented_access_assets": assets.get(s.id, 0)})
    return {"items": items, "definition": {"active_states": ACTIVE_STATES,
            "note": "Counts are computed from ticket status. RESOLVED and CLOSED tickets are not active. Severity reflects the highest "
                    "triage priority among active tickets; it is not a confirmed fault severity.",
            "assets": "Documented access-asset references (lifts, escalators, ramps) from GTFS entrance descriptions."}}


ASSET_KEYWORDS = {"lift": ["lift", "elevator", "மின்தூக்கி", "லிஃப்ட்"], "escalator": ["escalator", "நகரும் படிக்கட்டு", "எஸ்கலேட்டர்"],
                  "accessibility_ramp": ["ramp", "wheelchair"], "station_entrance": ["entrance", "gate", "exit"], "platform": ["platform"]}
ASSET_LABELS = {"lift": "Lifts", "escalator": "Escalators", "accessibility_ramp": "Accessibility ramps", "station_entrance": "Entrances",
                "platform": "Platforms"}


@router.get("/stations/{station_id}/inventory")
def station_inventory(station_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    s = db.get(Station, station_id)
    if not s:
        raise HTTPException(404, "Station not found")
    staff = has_perm(user, "ticket:read_all")
    gtfs = dict(db.execute(select(Asset.asset_type, func.count(Asset.id)).where(Asset.station_id == s.id).group_by(Asset.asset_type)).all())
    verified_ids = set(db.scalars(select(EngineerFinding.asset_id).join(Ticket).join(Complaint)
                                  .where(Complaint.station_id == s.id, EngineerFinding.asset_id.isnot(None))))
    verified_ids |= set(db.scalars(select(WorkSubmission.asset_id).join(Ticket).join(Complaint)
                                   .where(Complaint.station_id == s.id, WorkSubmission.asset_id.isnot(None),
                                          WorkSubmission.status.in_(["APPROVED", "APPROVED_FAILED"]))))
    verified_types = {}
    for a in db.scalars(select(Asset).where(Asset.id.in_(verified_ids))) if verified_ids else []:
        verified_types[a.asset_type] = verified_types.get(a.asset_type, 0) + 1
    complaints = list(db.scalars(select(Complaint).where(Complaint.station_id == s.id)))
    categories = []
    for t, label in ASSET_LABELS.items():
        reported = [c for c in complaints if (c.asset and c.asset.asset_type == t)
                    or any(k in c.description.lower() for k in ASSET_KEYWORDS[t])]
        doc_count = gtfs.get(t, 0)
        categories.append({
            "asset_type": t, "label": label,
            "verified_count": verified_types.get(t, 0),
            "verified_basis": "Assets an engineer recorded in a finding or approved work at this station",
            "document_derived_count": doc_count,
            "document_basis": ("GTFS entrance records" if t == "station_entrance" else "References in GTFS entrance descriptions (presence near an entrance, not unit count)")
                              if doc_count else None,
            "reported_unverified": len(reported),
            "reported_basis": "Complaints at this station that select or mention this asset type (reports, not verified faults)",
            "inventory_status": "Not inventoried" if t == "platform" or (doc_count == 0 and not verified_types.get(t)) else "Partial (no authoritative asset register)",
        })
    active = [c for c in complaints if c.ticket and c.ticket.status in ACTIVE_STATES]
    from ..services.similarity import station_groups
    groups = station_groups(db, s.id) if staff else []
    db.commit()
    docs = []
    ent = db.scalar(select(GraphEntity).where(GraphEntity.key == f"station:{s.code}"))
    if ent:
        for r in db.scalars(select(GraphRelationship).where(GraphRelationship.target_id == ent.id, GraphRelationship.type == "MENTIONS")
                            .order_by(GraphRelationship.weight.desc()).limit(10)):
            src = db.get(GraphEntity, r.source_id)
            docs.append({"document_id": src.ref_id, "title": src.label, "doc_kind": (src.properties or {}).get("doc_kind"), "mentions": int(r.weight)})
    ticket_ids = [c.ticket.id for c in complaints if c.ticket]
    invs = list(db.scalars(select(Investigation).where(Investigation.ticket_id.in_(ticket_ids)).order_by(Investigation.id.desc()).limit(10))) if ticket_ids and staff else []
    res = list(db.scalars(select(ResolutionMemory).where(ResolutionMemory.station_id == s.id).order_by(ResolutionMemory.id.desc()).limit(10))) if staff else []
    missing = ["No authoritative asset register (make, model, unit IDs) is present in the workspace data",
               "No equipment telemetry or maintenance work-order history is connected"]
    if not verified_ids:
        missing.append("No asset at this station has been confirmed by an engineer yet")
    return {"station": {**station_brief(s), "official_name": s.name, "source": s.source},
            "categories": categories,
            "open_complaints": len(active), "open_tickets": len({c.ticket.id for c in active}),
            "total_complaints": len(complaints),
            "active_items": [{"complaint_id": c.id, "complaint_code": c.complaint_code, "ticket_id": c.ticket.id, "ticket_code": c.ticket.ticket_code,
                              "status": c.ticket.status, "priority": c.ticket.priority, "category": c.category,
                              "summary": c.description[:120] if staff else None} for c in active] if staff else [],
            "repeated_groups": groups, "documents": docs,
            "investigations": [{"id": i.id, "code": i.code, "status": i.status, "sufficiency": i.sufficiency} for i in invs],
            "resolutions": [{"id": m.id, "outcome": m.outcome, "action": m.approved_action, "ticket_id": m.ticket_id} for m in res],
            "missing": missing,
            "note": "Reliability tiers are shown separately and are never summed: verified (engineer-confirmed), document-derived, and reported (unverified)."}


def _age_hours(t: Ticket) -> float:
    return (utcnow() - t.created_at).total_seconds() / 3600


def _row(t: Ticket, extra: dict | None = None):
    r = ticket_row(t)
    r["age_hours"] = round(_age_hours(t), 1)
    r["sla_hours"] = settings.sla_hours.get(t.priority)
    r["overdue"] = t.status in ACTIVE_STATES and r["sla_hours"] is not None and r["age_hours"] > r["sla_hours"]
    r["reported_asset"] = t.complaint.asset.name if t.complaint.asset else None
    if extra:
        r.update(extra)
    return r


@router.get("/work/queue")
def work_queue(station_id: int | None = None, category: str | None = None, priority: str | None = None,
               status: str | None = None, min_age_days: int | None = None, asset_type: str | None = None,
               user: User = Depends(require_perm("ticket:progress")), db: Session = Depends(get_db)):
    base = select(Ticket).join(Complaint)
    if station_id:
        base = base.where(Complaint.station_id == station_id)
    if category:
        base = base.where(Complaint.category == category)
    if priority:
        base = base.where(Ticket.priority == priority)
    if status:
        base = base.where(Ticket.status == status)
    if min_age_days:
        base = base.where(Ticket.created_at <= utcnow() - timedelta(days=min_age_days))
    if asset_type:
        base = base.join(Asset, Asset.id == Complaint.asset_id).where(Asset.asset_type == asset_type)
    mine = list(db.scalars(base.where(Ticket.assignee_id == user.id, Ticket.status.in_(ACTIVE_STATES)).order_by(Ticket.updated_at.desc())))
    team_or_free = or_(Ticket.assignee_id.is_(None), Ticket.assigned_team == user.team) if user.team else Ticket.assignee_id.is_(None)
    available = list(db.scalars(base.where(Ticket.assignee_id.is_(None), Ticket.status.in_(["RECEIVED", "INVESTIGATING", "ASSIGNED", "REOPENED"]))
                                .where(team_or_free).order_by(Ticket.created_at)))
    latest_sub = {}
    for w in db.scalars(select(WorkSubmission).where(WorkSubmission.engineer_id == user.id).order_by(WorkSubmission.id)):
        latest_sub[w.ticket_id] = w
    returned = [t for t in mine if t.status == "IN_PROGRESS" and t.id in latest_sub and latest_sub[t.id].status == "REJECTED"]
    submitted = [t for t in mine if t.status == "PENDING_REVIEW"]

    def sub_extra(t):
        w = latest_sub.get(t.id)
        return {"last_submission": {"status": w.status, "review_reason": w.review_reason, "review_type": w.review_type,
                                    "reviewer": user_brief(w.reviewer), "reviewed_at": iso(w.reviewed_at)} if w else None}
    return {"assigned": [_row(t, sub_extra(t)) for t in mine], "available": [_row(t) for t in available],
            "returned": [_row(t, sub_extra(t)) for t in returned], "submitted": [_row(t, sub_extra(t)) for t in submitted],
            "policy": policy()}


@router.get("/review/queue")
def review_queue(user: User = Depends(require_perm("ticket:review")), db: Session = Depends(get_db)):
    pending = []
    for t in db.scalars(select(Ticket).where(Ticket.status == "PENDING_REVIEW").order_by(Ticket.updated_at)):
        w = db.scalar(select(WorkSubmission).where(WorkSubmission.ticket_id == t.id, WorkSubmission.status == "SUBMITTED").order_by(WorkSubmission.id.desc()))
        pending.append(_row(t, {"submission": {"id": w.id, "solution": w.solution, "action_taken": w.action_taken, "notes": w.notes,
                                               "engineer": user_brief(w.engineer), "created_at": iso(w.created_at),
                                               "own_work": w.engineer_id == user.id and not settings.allow_self_approval} if w else None}))
    active = list(db.scalars(select(Ticket).where(Ticket.status.in_(ACTIVE_STATES))))
    reopened = [_row(t) for t in active if t.reopen_count > 0]
    overdue = sorted([_row(t) for t in active], key=lambda r: -r["age_hours"])
    overdue = [r for r in overdue if r["overdue"]]
    awaiting = []
    for t in active:
        if t.status != "AWAITING_VERIFICATION":
            continue
        since = db.scalar(select(func.max(TicketEvent.created_at)).where(TicketEvent.ticket_id == t.id, TicketEvent.to_status == "AWAITING_VERIFICATION")) or t.updated_at
        days = (utcnow() - since).total_seconds() / 86400
        awaiting.append(_row(t, {"waiting_days": round(days, 1), "reminder_due": days > settings.verification_reminder_days}))
    return {"pending_review": pending, "reopened": reopened, "overdue": overdue, "awaiting_verification": awaiting, "policy": policy()}
