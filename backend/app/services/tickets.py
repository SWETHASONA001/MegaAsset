"""Ticket lifecycle: valid transitions, permission checks, optimistic concurrency, events, notifications,
engineer work submission, supervisor review, passenger verification and resolution memory.
All rules are enforced here (the UI only reflects them)."""
from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..models import (Approval, Asset, Complaint, EngineerFinding, Incident, MaintenanceRecord, ResolutionMemory,
                      SolutionProposal, Ticket, TicketEvent, User, VerificationRecord, WorkSubmission, utcnow)
from ..provenance import CATEGORY_TEAM, COMPLAINT_CATEGORIES
from ..security import has_perm
from .common import audit, new_code, notify, staff_ids

STATES = ["RECEIVED", "INVESTIGATING", "ASSIGNED", "IN_PROGRESS", "PENDING_REVIEW", "AWAITING_VERIFICATION",
          "RESOLVED", "CLOSED", "REOPENED"]
# A complaint/ticket is "active" while it is in any of these states (RESOLVED and CLOSED are not active).
ACTIVE_STATES = [s for s in STATES if s not in ("RESOLVED", "CLOSED")]
TRANSITIONS = {
    "RECEIVED": {"INVESTIGATING", "ASSIGNED"},
    "INVESTIGATING": {"ASSIGNED"},
    "ASSIGNED": {"INVESTIGATING", "IN_PROGRESS"},
    # IN_PROGRESS -> AWAITING_VERIFICATION is only used when supervisor review is disabled by policy
    "IN_PROGRESS": {"PENDING_REVIEW", "AWAITING_VERIFICATION", "INVESTIGATING"},
    "PENDING_REVIEW": {"AWAITING_VERIFICATION", "IN_PROGRESS"},
    "AWAITING_VERIFICATION": {"RESOLVED", "REOPENED"},
    "RESOLVED": {"CLOSED", "REOPENED"},
    "CLOSED": {"REOPENED"},
    "REOPENED": {"INVESTIGATING", "ASSIGNED", "IN_PROGRESS"},
}
# action -> (target status, permission). submit_work / review_work / admin_close have dedicated functions.
ACTIONS = {
    "start_investigation": ("INVESTIGATING", "ticket:investigate"),
    "assign": ("ASSIGNED", "ticket:assign"),
    "start_work": ("IN_PROGRESS", "ticket:progress"),
    "request_verification": ("AWAITING_VERIFICATION", "ticket:request_verification"),
    "close": ("CLOSED", "ticket:close"),
    "reopen": ("REOPENED", "ticket:reopen"),
}


def policy() -> dict:
    return {"require_supervisor_review": settings.require_supervisor_review,
            "allow_self_approval": settings.allow_self_approval,
            "auto_close_on_passenger_confirmation": settings.auto_close_on_passenger_confirmation,
            "verification_reminder_days": settings.verification_reminder_days,
            "sla_hours": settings.sla_hours,
            "active_states": ACTIVE_STATES,
            "no_response_policy": "Tickets stay in AWAITING_VERIFICATION until the passenger answers or an administrator "
                                  "performs an audited closure. They are never marked passenger-verified automatically."}


def initial_priority(db: Session, station_id: int, category: str) -> tuple[str, str]:
    """Rules-based triage priority (documented rules; not a predictive model)."""
    since = utcnow() - timedelta(days=30)
    repeats = db.scalar(select(func.count(Complaint.id)).where(Complaint.station_id == station_id,
                                                               Complaint.category == category,
                                                               Complaint.created_at >= since)) or 0
    reasons = []
    level = 1  # LOW=0, MEDIUM=1, HIGH=2, CRITICAL=3
    if category == "safety":
        level = 2
        reasons.append("Safety concern category → HIGH by triage rule")
    elif category in ("lifts_escalators", "accessibility"):
        level = 2 if category == "accessibility" else 1
        reasons.append("Accessibility-related category" if category == "accessibility" else "Lift/escalator category → MEDIUM by triage rule")
    else:
        reasons.append("Default triage priority MEDIUM")
    if repeats >= 3:
        level = min(3, level + 1)
        reasons.append(f"{repeats} complaints in the same category at this station in the last 30 days (raises investigative priority; does not prove a failure)")
    return ["LOW", "MEDIUM", "HIGH", "CRITICAL"][level], "; ".join(reasons)


def claim_version(db: Session, ticket: Ticket, expected: int | None = None) -> None:
    """Optimistic concurrency: atomically bump the version only if nobody changed the ticket meanwhile.
    Concurrent duplicate actions therefore fail with 409 instead of both being applied."""
    base = expected if expected is not None else ticket.version
    res = db.execute(update(Ticket).where(Ticket.id == ticket.id, Ticket.version == base)
                     .values(version=base + 1, updated_at=utcnow()).execution_options(synchronize_session=False))
    if res.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "This ticket was updated by someone else. Reload it and try again.")
    ticket.version = base + 1


def add_event(db: Session, ticket: Ticket, actor: User | None, event_type: str, note: str | None = None,
              from_status=None, to_status=None, **data) -> TicketEvent:
    ev = TicketEvent(ticket_id=ticket.id, actor_id=actor.id if actor else None, event_type=event_type,
                     from_status=from_status, to_status=to_status, note=note, data=data)
    db.add(ev)
    ticket.updated_at = utcnow()
    return ev


def _can_view(user: User, ticket: Ticket) -> bool:
    return has_perm(user, "ticket:read_all") or ticket.complaint.user_id == user.id


def ensure_view(user: User, ticket: Ticket):
    if not _can_view(user, ticket):
        raise HTTPException(403, "You can only view your own tickets")


def transition(db: Session, ticket: Ticket, target: str, actor: User | None, note: str | None = None,
               event_type: str = "STATUS_CHANGE", **data):
    current = ticket.status
    if target not in TRANSITIONS.get(current, set()):
        raise HTTPException(409, f"Invalid transition {current} → {target}. Allowed: {sorted(TRANSITIONS.get(current, []))}")
    ticket.status = target
    if target == "RESOLVED":
        ticket.resolved_at = utcnow()
    if target == "CLOSED":
        ticket.closed_at = utcnow()
    if target == "REOPENED":
        ticket.reopen_count += 1
        ticket.resolved_at = ticket.closed_at = None
        ticket.closure_type = None
    add_event(db, ticket, actor, event_type, note, current, target, **data)
    audit(db, actor, f"ticket.{target.lower()}", "ticket", ticket.ticket_code, from_status=current, note=note)
    from .graph import update_ticket_entity
    update_ticket_entity(db, ticket)
    return ticket


def _notify_team(db, ticket, type_, title, body):
    notify(db, staff_ids(db, ("supervisor", "admin"), team=ticket.assigned_team) + ([ticket.assignee_id] if ticket.assignee_id else []),
           type_, title, body, f"/app/tickets/{ticket.id}")


def _notify_passenger(db, ticket, type_, title, body):
    notify(db, [ticket.complaint.user_id], type_, title, body, f"/app/complaints/{ticket.complaint_id}")


def perform_action(db: Session, ticket: Ticket, action: str, actor: User, note: str | None = None,
                   team: str | None = None, assignee_id: int | None = None, expected_version: int | None = None) -> Ticket:
    if action not in ACTIONS:
        raise HTTPException(400, f"Unknown action '{action}'")
    target, perm = ACTIONS[action]
    owner = ticket.complaint.user_id == actor.id
    if action == "reopen" and owner:
        pass  # passengers may reopen their own resolved/closed tickets
    elif not has_perm(actor, perm):
        raise HTTPException(403, f"Your role ({actor.role}) cannot perform '{action}'")
    if action == "request_verification" and settings.require_supervisor_review:
        raise HTTPException(409, "Policy requires supervisor review: the engineer submits completed work and a supervisor "
                                 "approves it before passenger verification is requested.")
    if action == "close" and ticket.status != "RESOLVED":
        raise HTTPException(409, "Only RESOLVED tickets can be closed. Unresolved tickets can only be closed by an audited administrative closure.")
    if action == "start_work" and ticket.assignee_id and ticket.assignee_id != actor.id and actor.role not in ("admin", "supervisor"):
        other = db.get(User, ticket.assignee_id)
        raise HTTPException(409, f"Ticket is assigned to {other.full_name if other else 'another engineer'}; ask a supervisor to reassign it.")
    claim_version(db, ticket, expected_version)
    complaint = ticket.complaint
    if action == "assign":
        team = team or ticket.assigned_team or CATEGORY_TEAM.get(complaint.category)
        assignee = db.get(User, assignee_id) if assignee_id else None
        if assignee_id and (not assignee or not assignee.is_active or assignee.role not in ("engineer", "operator", "supervisor", "admin")):
            raise HTTPException(400, "Assignee must be an active staff member")
        ticket.assigned_team, ticket.assignee_id = team, assignee_id
        transition(db, ticket, target, actor, note, "ASSIGNED", team=team, assignee_id=assignee_id)
        _notify_passenger(db, ticket, "ticket_assigned", f"{ticket.ticket_code} assigned",
                          f"Your complaint {complaint.complaint_code} has been assigned to {team}.")
        if assignee_id:
            notify(db, [assignee_id], "ticket_assigned", f"{ticket.ticket_code} assigned to you",
                   f"{COMPLAINT_CATEGORIES[complaint.category]['en']} at {complaint.station.display_name}", f"/app/tickets/{ticket.id}")
    elif action == "start_work":
        if ticket.status in ("RECEIVED", "INVESTIGATING", "REOPENED") or not ticket.assignee_id:
            # Record the (self-)assignment explicitly before work starts
            ticket.assignee_id = ticket.assignee_id or actor.id
            ticket.assigned_team = ticket.assigned_team or actor.team or CATEGORY_TEAM.get(complaint.category)
            if ticket.status != "ASSIGNED" and "ASSIGNED" in TRANSITIONS.get(ticket.status, set()):
                transition(db, ticket, "ASSIGNED", actor, "Engineer took ownership", "ASSIGNED",
                           team=ticket.assigned_team, assignee_id=ticket.assignee_id)
            else:
                add_event(db, ticket, actor, "ASSIGNED", "Engineer took ownership", assignee_id=ticket.assignee_id)
        transition(db, ticket, "IN_PROGRESS", actor, note, "WORK_STARTED")
        _notify_passenger(db, ticket, "investigation_update", f"{ticket.ticket_code}: work in progress",
                          "An engineer has started work on your complaint.")
    elif action == "request_verification":
        transition(db, ticket, target, actor, note, "VERIFICATION_REQUESTED")
        _notify_passenger(db, ticket, "verification_requested", f"Please verify {ticket.ticket_code}",
                          f"Work on complaint {complaint.complaint_code} is reported complete. Is the issue resolved?")
    elif action == "close":
        ticket.closure_type = ticket.closure_type or "STAFF_CLOSED"
        transition(db, ticket, target, actor, note, "CLOSED")
        _notify_passenger(db, ticket, "ticket_closed", f"{ticket.ticket_code} closed", f"Complaint {complaint.complaint_code} has been closed.")
    elif action == "reopen":
        transition(db, ticket, target, actor, note or "Reopened", "REOPENED")
        _record_counterexample(db, ticket, actor, note or "Reopened")
        _notify_team(db, ticket, "ticket_reopened", f"{ticket.ticket_code} reopened", note or "Issue reported as unresolved.")
        _notify_passenger(db, ticket, "ticket_reopened", f"{ticket.ticket_code} reopened", "Your complaint has been reopened for further investigation.")
    else:
        transition(db, ticket, target, actor, note)
        _notify_passenger(db, ticket, "investigation_update", f"{ticket.ticket_code}: investigation started",
                          "Investigation has started on your complaint.")
    return ticket


def submit_work(db: Session, ticket: Ticket, actor: User, solution: str, action_taken: str, notes: str | None,
                asset_id: int | None, expected_version: int | None = None) -> WorkSubmission:
    if not has_perm(actor, "ticket:submit_work"):
        raise HTTPException(403, "Only engineers can submit completed work")
    if ticket.status != "IN_PROGRESS":
        raise HTTPException(409, f"Work can only be submitted while the ticket is IN_PROGRESS (currently {ticket.status})")
    if ticket.assignee_id and ticket.assignee_id != actor.id and actor.role != "admin":
        raise HTTPException(403, "Only the assigned engineer can submit work for this ticket")
    if len((solution or "").strip()) < 10 or len((action_taken or "").strip()) < 10:
        raise HTTPException(422, "Describe both the solution and the action actually taken (at least 10 characters each)")
    if asset_id:
        a = db.get(Asset, asset_id)
        if not a or a.station_id != ticket.complaint.station_id:
            raise HTTPException(422, "Asset must belong to the ticket's station")
    claim_version(db, ticket, expected_version)
    ws = WorkSubmission(ticket_id=ticket.id, engineer_id=actor.id, solution=solution.strip(), action_taken=action_taken.strip(),
                        notes=(notes or "").strip() or None, asset_id=asset_id, status="SUBMITTED")
    db.add(ws)
    db.flush()
    if settings.require_supervisor_review:
        transition(db, ticket, "PENDING_REVIEW", actor, f"Work submitted for supervisor review: {action_taken.strip()[:200]}",
                   "WORK_SUBMITTED", submission_id=ws.id)
        notify(db, staff_ids(db, ("supervisor", "admin")), "review_requested", f"{ticket.ticket_code} awaiting review",
               f"{actor.full_name} submitted completed work for review.", f"/app/tickets/{ticket.id}")
        _notify_passenger(db, ticket, "investigation_update", f"{ticket.ticket_code}: work completed",
                          "Work has been completed and is being reviewed by a supervisor.")
    else:
        ws.status = "APPROVED"
        transition(db, ticket, "AWAITING_VERIFICATION", actor, "Work completed (supervisor review disabled by policy)",
                   "WORK_SUBMITTED", submission_id=ws.id)
        _notify_passenger(db, ticket, "verification_requested", f"Please verify {ticket.ticket_code}",
                          "Work is reported complete. Is the issue resolved?")
    audit(db, actor, "ticket.work_submitted", "ticket", ticket.ticket_code, submission_id=ws.id)
    return ws


def review_work(db: Session, ticket: Ticket, actor: User, decision: str, reason: str | None, review_type: str | None = None,
                expected_version: int | None = None) -> WorkSubmission:
    if not has_perm(actor, "ticket:review"):
        raise HTTPException(403, "Only a supervisor can review completed work")
    if decision not in ("APPROVED", "REJECTED"):
        raise HTTPException(422, "Decision must be APPROVED or REJECTED")
    if ticket.status != "PENDING_REVIEW":
        raise HTTPException(409, f"Ticket is {ticket.status}; only PENDING_REVIEW work can be reviewed")
    ws = db.scalar(select(WorkSubmission).where(WorkSubmission.ticket_id == ticket.id, WorkSubmission.status == "SUBMITTED")
                   .order_by(WorkSubmission.id.desc()))
    if not ws:
        raise HTTPException(409, "No submitted work found for this ticket")
    if ws.engineer_id == actor.id and not settings.allow_self_approval:
        raise HTTPException(403, "You cannot review your own work (self-approval is disabled by policy)")
    if decision == "REJECTED" and len((reason or "").strip()) < 5:
        raise HTTPException(422, "A reason is required when rejecting work")
    claim_version(db, ticket, expected_version)
    ws.status, ws.reviewer_id, ws.review_reason, ws.reviewed_at = decision, actor.id, (reason or "").strip() or None, utcnow()
    ws.review_type = (review_type if review_type in ("REWORK", "MORE_EVIDENCE") else "REWORK") if decision == "REJECTED" else None
    if decision == "APPROVED":
        transition(db, ticket, "AWAITING_VERIFICATION", actor, reason or "Work approved by supervisor", "WORK_APPROVED", submission_id=ws.id)
        _notify_passenger(db, ticket, "verification_requested", f"Please verify {ticket.ticket_code}",
                          f"Work on complaint {ticket.complaint.complaint_code} has been completed and approved. Is the issue resolved?")
        notify(db, [ws.engineer_id], "work_reviewed", f"Work approved on {ticket.ticket_code}", "Awaiting passenger verification.",
               f"/app/tickets/{ticket.id}")
        from .graph import sync_action
        sync_action(db, ticket, ws)
    else:
        label = "More evidence requested" if ws.review_type == "MORE_EVIDENCE" else "Rework requested"
        transition(db, ticket, "IN_PROGRESS", actor, f"{label}: {ws.review_reason}", "WORK_REJECTED",
                   submission_id=ws.id, review_type=ws.review_type)
        notify(db, [ws.engineer_id], "work_reviewed", f"{label} on {ticket.ticket_code}", ws.review_reason, f"/app/tickets/{ticket.id}")
    audit(db, actor, f"ticket.work_{decision.lower()}", "ticket", ticket.ticket_code, submission_id=ws.id, reason=reason)
    return ws


def admin_close(db: Session, ticket: Ticket, actor: User, reason: str, expected_version: int | None = None) -> Ticket:
    """Explicit, audited administrative closure (e.g. duplicate or invalid report). Never recorded as passenger-verified."""
    if actor.role != "admin":
        raise HTTPException(403, "Administrative closure requires an administrator")
    if ticket.status == "CLOSED":
        raise HTTPException(409, "Ticket is already closed")
    if len((reason or "").strip()) < 10:
        raise HTTPException(422, "Administrative closure requires a reason (at least 10 characters)")
    claim_version(db, ticket, expected_version)
    current = ticket.status
    ticket.status, ticket.closed_at, ticket.closure_type = "CLOSED", utcnow(), "ADMIN_CLOSED"
    add_event(db, ticket, actor, "ADMIN_CLOSED", reason.strip(), current, "CLOSED")
    audit(db, actor, "ticket.admin_closed", "ticket", ticket.ticket_code, from_status=current, reason=reason)
    from .graph import update_ticket_entity
    update_ticket_entity(db, ticket)
    _notify_passenger(db, ticket, "ticket_closed", f"{ticket.ticket_code} closed by administrator", f"Reason: {reason.strip()}")
    _notify_team(db, ticket, "ticket_closed", f"{ticket.ticket_code} administratively closed", reason.strip())
    return ticket


def passenger_verify(db: Session, ticket: Ticket, actor: User, outcome: str, comment: str | None,
                     expected_version: int | None = None) -> Ticket:
    if outcome not in ("RESOLVED", "STILL_EXISTS"):
        raise HTTPException(400, "Outcome must be RESOLVED or STILL_EXISTS")
    is_owner = ticket.complaint.user_id == actor.id
    if not is_owner and not has_perm(actor, "ticket:close"):
        raise HTTPException(403, "Only the passenger who raised the complaint (or a supervisor) can verify")
    if ticket.status != "AWAITING_VERIFICATION":
        raise HTTPException(409, f"Ticket is {ticket.status}; verification is only possible in AWAITING_VERIFICATION")
    claim_version(db, ticket, expected_version)
    vtype = "PASSENGER" if is_owner else "STAFF"
    db.add(VerificationRecord(ticket_id=ticket.id, verifier_id=actor.id, verifier_type=vtype, outcome=outcome, comment=comment))
    if outcome == "RESOLVED":
        transition(db, ticket, "RESOLVED", actor, comment or "Verified as resolved", "VERIFIED_RESOLVED", verifier=vtype)
        _record_resolution(db, ticket, actor)
        _notify_team(db, ticket, "ticket_resolved", f"{ticket.ticket_code} verified resolved", f"{vtype.title()} confirmed the issue is resolved.")
        if settings.auto_close_on_passenger_confirmation:
            ticket.closure_type = "PASSENGER_VERIFIED" if is_owner else "STAFF_RECORDED_VERIFICATION"
            transition(db, ticket, "CLOSED", None, "Closed automatically after resolution was confirmed (workflow policy)", "AUTO_CLOSED")
        _notify_passenger(db, ticket, "ticket_resolved", f"{ticket.ticket_code} resolved",
                          "Thank you for confirming. The ticket is now resolved" + (" and closed." if settings.auto_close_on_passenger_confirmation else "."))
    else:
        transition(db, ticket, "REOPENED", actor, comment or "Passenger reports issue still exists", "VERIFIED_STILL_EXISTS")
        _record_counterexample(db, ticket, actor, comment or "Passenger reports issue still exists")
        _notify_team(db, ticket, "ticket_reopened", f"{ticket.ticket_code} reopened", "Passenger reports the issue still exists.")
        _notify_passenger(db, ticket, "ticket_reopened", f"{ticket.ticket_code} reopened", "Your ticket has been reopened for further work.")
    return ticket


def _approved_solution(db: Session, ticket: Ticket) -> SolutionProposal | None:
    return db.scalar(select(SolutionProposal).where(SolutionProposal.ticket_id == ticket.id,
                                                    SolutionProposal.status.in_(["APPROVED", "IMPLEMENTED"]))
                     .order_by(SolutionProposal.id.desc()))


def _approved_work(db: Session, ticket: Ticket) -> WorkSubmission | None:
    return db.scalar(select(WorkSubmission).where(WorkSubmission.ticket_id == ticket.id, WorkSubmission.status == "APPROVED")
                     .order_by(WorkSubmission.id.desc()))


def _memory_payload(db: Session, ticket: Ticket):
    findings = [f"{f.finding}" + (f" ({'verified' if f.cause_verified else 'hypothesised'} cause: {f.root_cause})" if f.root_cause else "")
                for f in db.scalars(select(EngineerFinding).where(EngineerFinding.ticket_id == ticket.id))]
    sol = _approved_solution(db, ticket)
    work = _approved_work(db, ticket)
    reviewer = work.reviewer_id if work and work.reviewer_id else (
        db.scalar(select(Approval.reviewer_id).where(Approval.solution_id == sol.id, Approval.decision == "APPROVED")) if sol else None)
    if work:
        findings = findings + [f"Engineer action: {work.action_taken}"]
    return findings, sol, reviewer, work


def _record_resolution(db: Session, ticket: Ticket, actor: User):
    findings, sol, reviewer, work = _memory_payload(db, ticket)
    c = ticket.complaint
    mem = ResolutionMemory(ticket_id=ticket.id, complaint_id=c.id, station_id=c.station_id, category=c.category,
                           problem_summary=c.description[:1000], findings=findings,
                           approved_action=work.solution if work else (sol.title if sol else None),
                           solution_id=sol.id if sol else None, reviewer_id=reviewer, outcome="VERIFIED_RESOLVED",
                           evidence=(sol.evidence if sol else [])[:8], provenance="VERIFIED")
    db.add(mem)
    if sol:
        sol.status = "IMPLEMENTED"
    db.flush()
    from .graph import sync_records
    sync_records(db, resolution=mem)


def _record_counterexample(db: Session, ticket: Ticket, actor: User, reason: str):
    findings, sol, reviewer, work = _memory_payload(db, ticket)
    if not sol and not findings and not work:
        return  # nothing was attempted; no counterexample to learn from
    c = ticket.complaint
    mem = ResolutionMemory(ticket_id=ticket.id, complaint_id=c.id, station_id=c.station_id, category=c.category,
                           problem_summary=c.description[:1000], findings=findings + [f"Reopened: {reason}"],
                           approved_action=work.solution if work else (sol.title if sol else None),
                           solution_id=sol.id if sol else None, reviewer_id=reviewer, outcome="FAILED_REOPENED",
                           evidence=(sol.evidence if sol else [])[:8], provenance="VERIFIED")
    db.add(mem)
    if sol and sol.status == "IMPLEMENTED":
        sol.status = "APPROVED"
    if work:
        work.status = "APPROVED_FAILED"  # keep the record; it is no longer the action that resolved the ticket
    db.flush()


def add_finding(db: Session, ticket: Ticket, actor: User, finding: str, root_cause: str | None,
                confirmed_incident: bool, asset_id: int | None, cause_verified: bool = False) -> EngineerFinding:
    if not has_perm(actor, "ticket:finding"):
        raise HTTPException(403, "Only engineers can record findings")
    if ticket.status in ("CLOSED",):
        raise HTTPException(409, "Ticket is closed; reopen it to add findings")
    if asset_id:
        a = db.get(Asset, asset_id)
        if not a or a.station_id != ticket.complaint.station_id:
            raise HTTPException(422, "Asset must belong to the ticket's station")
    claim_version(db, ticket)
    f = EngineerFinding(ticket_id=ticket.id, author_id=actor.id, finding=finding, root_cause=root_cause,
                        cause_verified=bool(cause_verified and root_cause), confirmed_incident=confirmed_incident, asset_id=asset_id)
    db.add(f)
    db.flush()
    add_event(db, ticket, actor, "FINDING_ADDED", finding[:300], finding_id=f.id, confirmed_incident=confirmed_incident,
              cause_status="VERIFIED" if f.cause_verified else ("HYPOTHESIS" if root_cause else None))
    if confirmed_incident:
        c = ticket.complaint
        inc = Incident(code=new_code(db, Incident, "code", "INC", 6), ticket_id=ticket.id, finding_id=f.id,
                       station_id=c.station_id, asset_id=asset_id, title=f"{COMPLAINT_CATEGORIES[c.category]['en']} at {c.station.display_name}",
                       description=finding, severity=ticket.priority, recorded_by=actor.id, provenance="VERIFIED")
        db.add(inc)
        add_event(db, ticket, actor, "INCIDENT_RECORDED", f"Incident confirmed by engineer: {inc.code}", incident_code=inc.code)
    if asset_id:
        from .graph import sync_ticket_asset
        sync_ticket_asset(db, ticket, db.get(Asset, asset_id), "VERIFIED" if f.cause_verified or confirmed_incident else "DOCUMENTED",
                          f"engineer finding #{f.id}")
    _notify_passenger(db, ticket, "investigation_update", f"{ticket.ticket_code}: investigation update",
                      "An engineer has recorded a finding on your complaint.")
    audit(db, actor, "ticket.finding", "ticket", ticket.ticket_code)
    return f


def record_maintenance(db: Session, ticket: Ticket, actor: User, work_type: str, description: str, status: str, asset_id: int | None):
    if not has_perm(actor, "maintenance:record"):
        raise HTTPException(403, "Only engineers can record maintenance work")
    claim_version(db, ticket)
    m = MaintenanceRecord(ticket_id=ticket.id, station_id=ticket.complaint.station_id, asset_id=asset_id, work_type=work_type,
                          description=description, status=status, performed_by=actor.id, provenance="DOCUMENTED")
    db.add(m)
    db.flush()
    add_event(db, ticket, actor, "MAINTENANCE_RECORDED", f"{work_type}: {description[:200]}", maintenance_id=m.id, status=status)
    return m


def review_solution(db: Session, sol: SolutionProposal, actor: User, decision: str, comment: str | None) -> SolutionProposal:
    if not has_perm(actor, "solution:approve"):
        raise HTTPException(403, "Solution approval requires a supervisor — human approval gate")
    if decision not in ("APPROVED", "REJECTED"):
        raise HTTPException(400, "Decision must be APPROVED or REJECTED")
    if sol.status != "PROPOSED":
        raise HTTPException(409, f"Solution is already {sol.status}")
    sol.status = decision
    db.add(Approval(solution_id=sol.id, reviewer_id=actor.id, decision=decision, comment=comment))
    if sol.ticket_id:
        t = db.get(Ticket, sol.ticket_id)
        add_event(db, t, actor, f"SOLUTION_{decision}", f"{sol.title}" + (f" — {comment}" if comment else ""), solution_id=sol.id)
        _notify_team(db, t, "solution_review", f"Solution {decision.lower()} on {t.ticket_code}", sol.title)
    audit(db, actor, f"solution.{decision.lower()}", "solution", sol.id, comment=comment)
    return sol
