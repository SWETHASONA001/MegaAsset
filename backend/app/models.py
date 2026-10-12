"""Database models. Every domain record carries a provenance label (see provenance.py)."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text,
                        UniqueConstraint, Index)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Role(Base):
    __tablename__ = "roles"
    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    description: Mapped[str] = mapped_column(String(255))
    permissions: Mapped[list] = mapped_column(JSON, default=list)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), ForeignKey("roles.name"), default="passenger")
    team: Mapped[str | None] = mapped_column(String(80), nullable=True)
    preferred_language: Mapped[str] = mapped_column(String(8), default="en")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Station(Base):
    __tablename__ = "stations"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)  # GTFS zone_id e.g. SCC
    gtfs_stop_id: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(160))  # GTFS stop_name as published
    display_name: Mapped[str] = mapped_column(String(160))
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    lines: Mapped[list] = mapped_column(JSON, default=list)
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(255))
    provenance: Mapped[str] = mapped_column(String(32), default="DOCUMENTED")


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[int] = mapped_column(primary_key=True)
    asset_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    asset_type: Mapped[str] = mapped_column(String(48), index=True)
    name: Mapped[str] = mapped_column(String(255))
    station_id: Mapped[int | None] = mapped_column(ForeignKey("stations.id"), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(255))
    source_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provenance: Mapped[str] = mapped_column(String(32), default="DOCUMENTED")
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    station: Mapped[Station | None] = relationship()


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    rel_path: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    filename: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(64), index=True)
    collection: Mapped[str] = mapped_column(String(64), default="cmrl")
    file_type: Mapped[str] = mapped_column(String(16))
    size_bytes: Mapped[int] = mapped_column(Integer)
    checksum: Mapped[str] = mapped_column(String(64), index=True)
    duplicate_of_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_used: Mapped[bool] = mapped_column(Boolean, default=False)
    ocr_pages: Mapped[int] = mapped_column(Integer, default=0)
    empty_pages: Mapped[int] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    char_count: Mapped[int] = mapped_column(Integer, default=0)
    origin: Mapped[str] = mapped_column(String(16), default="RAW")  # RAW | UPLOAD
    doc_kind: Mapped[str] = mapped_column(String(48), default="REPORT")  # REPORT, TENDER, ...
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    file_mtime: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class DocumentPage(Base):
    __tablename__ = "document_pages"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    page_number: Mapped[int] = mapped_column(Integer)  # 1-based; for sheets = sheet index
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)  # e.g. sheet name
    text: Mapped[str] = mapped_column(Text)
    char_count: Mapped[int] = mapped_column(Integer, default=0)
    ocr: Mapped[bool] = mapped_column(Boolean, default=False)


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    page_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sheet: Mapped[str | None] = mapped_column(String(128), nullable=True)
    row_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    row_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    heading: Mapped[str | None] = mapped_column(String(512), nullable=True)
    text: Mapped[str] = mapped_column(Text)
    ocr: Mapped[bool] = mapped_column(Boolean, default=False)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    document: Mapped[Document] = relationship()


class Dataset(Base):
    __tablename__ = "datasets"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text)
    scope: Mapped[str] = mapped_column(String(32))  # CMRL_ONLY | CHENNAI_WIDE
    kind: Mapped[str] = mapped_column(String(32))  # CSV | XLSX | GTFS
    rel_path: Mapped[str] = mapped_column(String(512))
    checksum: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="PENDING")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    tables: Mapped[list] = mapped_column(JSON, default=list)  # [{name, columns, rows}]
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    provenance: Mapped[str] = mapped_column(String(32), default="DOCUMENTED")
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RidershipMonthly(Base):
    __tablename__ = "ridership_monthly"
    id: Mapped[int] = mapped_column(primary_key=True)
    month_label: Mapped[str] = mapped_column(String(16))
    month_start: Mapped[str] = mapped_column(String(10))  # YYYY-MM-01
    closed_loop: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ncmc: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_row: Mapped[int] = mapped_column(Integer)


class StationRidership(Base):
    __tablename__ = "station_ridership"
    id: Mapped[int] = mapped_column(primary_key=True)
    service_date: Mapped[str] = mapped_column(String(10))
    day_label: Mapped[str] = mapped_column(String(64))
    is_partial: Mapped[bool] = mapped_column(Boolean, default=False)
    line_name: Mapped[str] = mapped_column(String(64))
    station_seq: Mapped[int] = mapped_column(Integer)
    station_name: Mapped[str] = mapped_column(String(160))
    station_id: Mapped[int | None] = mapped_column(ForeignKey("stations.id"), nullable=True, index=True)
    match_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    passengers: Mapped[int] = mapped_column(Integer)
    source_row: Mapped[int] = mapped_column(Integer)


class HourlyRidership(Base):
    __tablename__ = "hourly_ridership"
    id: Mapped[int] = mapped_column(primary_key=True)
    service_date: Mapped[str] = mapped_column(String(10))
    is_partial: Mapped[bool] = mapped_column(Boolean, default=False)
    hour: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    source_row: Mapped[int] = mapped_column(Integer)


class Complaint(Base):
    __tablename__ = "complaints"
    id: Mapped[int] = mapped_column(primary_key=True)
    complaint_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    description: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(8), default="en")
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    category: Mapped[str] = mapped_column(String(48), index=True)
    provenance: Mapped[str] = mapped_column(String(32), default="REPORTED")
    # Idempotency key sent by the client so retries/double-clicks never create a second complaint
    client_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Asset the passenger *reported* (optional). This is a report, not a verified fault location.
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    station: Mapped[Station] = relationship()
    asset: Mapped["Asset | None"] = relationship()
    user: Mapped[User] = relationship()
    attachments: Mapped[list["Attachment"]] = relationship(back_populates="complaint", cascade="all, delete-orphan")
    ticket: Mapped["Ticket"] = relationship(back_populates="complaint", uselist=False)


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    complaint_id: Mapped[int] = mapped_column(ForeignKey("complaints.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # image | video | document
    original_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(128))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    complaint: Mapped[Complaint] = relationship(back_populates="attachments")


class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    complaint_id: Mapped[int] = mapped_column(ForeignKey("complaints.id"), unique=True)
    status: Mapped[str] = mapped_column(String(32), default="RECEIVED", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="MEDIUM", index=True)
    priority_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_team: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reopen_count: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # optimistic concurrency
    closure_type: Mapped[str | None] = mapped_column(String(32), nullable=True)  # PASSENGER_VERIFIED | ADMIN_CLOSED | STAFF_CLOSED
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    complaint: Mapped[Complaint] = relationship(back_populates="ticket")
    assignee: Mapped[User | None] = relationship()
    events: Mapped[list["TicketEvent"]] = relationship(back_populates="ticket", order_by="TicketEvent.id")


class TicketEvent(Base):
    __tablename__ = "ticket_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(48))
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    ticket: Mapped[Ticket] = relationship(back_populates="events")
    actor: Mapped[User | None] = relationship()


class Investigation(Base):
    __tablename__ = "investigations"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True, index=True)
    question: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="RUNNING")
    sufficiency: Mapped[str | None] = mapped_column(String(32), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    trace: Mapped[list] = mapped_column(JSON, default=list)
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ticket: Mapped[Ticket | None] = relationship()


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[int] = mapped_column(primary_key=True)
    investigation_id: Mapped[int] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24))  # DOCUMENT | GRAPH | COMPLAINT | DATASET | RESOLUTION | FINDING
    provenance: Mapped[str] = mapped_column(String(32))
    label: Mapped[str] = mapped_column(String(255))
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    chunk_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ref: Mapped[dict] = mapped_column(JSON, default=dict)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    supports: Mapped[str | None] = mapped_column(String(32), nullable=True)  # SUPPORTS | CONTEXT | CONTRADICTS


class RiskAssessment(Base):
    __tablename__ = "risk_assessments"
    id: Mapped[int] = mapped_column(primary_key=True)
    investigation_id: Mapped[int | None] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), nullable=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True)
    station_id: Mapped[int | None] = mapped_column(ForeignKey("stations.id"), nullable=True)
    category: Mapped[str | None] = mapped_column(String(48), nullable=True)
    level: Mapped[str] = mapped_column(String(24))
    score: Mapped[float] = mapped_column(Float)
    factors: Mapped[list] = mapped_column(JSON, default=list)
    rationale: Mapped[str] = mapped_column(Text)
    gaps: Mapped[list] = mapped_column(JSON, default=list)
    provenance: Mapped[str] = mapped_column(String(32), default="POTENTIAL")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SolutionProposal(Base):
    __tablename__ = "solution_proposals"
    id: Mapped[int] = mapped_column(primary_key=True)
    investigation_id: Mapped[int | None] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), nullable=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    problem: Mapped[str] = mapped_column(Text)
    rationale: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    benefits: Mapped[list] = mapped_column(JSON, default=list)
    risks: Mapped[list] = mapped_column(JSON, default=list)
    dependencies: Mapped[list] = mapped_column(JSON, default=list)
    missing_info: Mapped[list] = mapped_column(JSON, default=list)
    approval_requirements: Mapped[list] = mapped_column(JSON, default=list)
    verification_criteria: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="PROPOSED")
    provenance: Mapped[str] = mapped_column(String(32), default="AI_HYPOTHESIS")
    proposed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EngineerFinding(Base):
    __tablename__ = "engineer_findings"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    finding: Mapped[str] = mapped_column(Text)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    cause_verified: Mapped[bool] = mapped_column(Boolean, default=False)  # False = hypothesis, True = verified on site
    confirmed_incident: Mapped[bool] = mapped_column(Boolean, default=False)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    provenance: Mapped[str] = mapped_column(String(32), default="DOCUMENTED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    author: Mapped[User] = relationship()


class WorkSubmission(Base):
    """Engineer's record of completed work, reviewed by a supervisor before passenger verification."""
    __tablename__ = "work_submissions"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    engineer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    solution: Mapped[str] = mapped_column(Text)
    action_taken: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="SUBMITTED", index=True)  # SUBMITTED | APPROVED | REJECTED
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_type: Mapped[str | None] = mapped_column(String(32), nullable=True)  # REWORK | MORE_EVIDENCE
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    engineer: Mapped[User] = relationship(foreign_keys=[engineer_id])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewer_id])
    attachments: Mapped[list["WorkAttachment"]] = relationship(cascade="all, delete-orphan")


class WorkAttachment(Base):
    __tablename__ = "work_attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("work_submissions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    original_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(128))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    solution_id: Mapped[int] = mapped_column(ForeignKey("solution_proposals.id", ondelete="CASCADE"), index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(16))
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    reviewer: Mapped[User] = relationship()


class VerificationRecord(Base):
    __tablename__ = "verification_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    verifier_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    verifier_type: Mapped[str] = mapped_column(String(16))  # PASSENGER | STAFF
    outcome: Mapped[str] = mapped_column(String(24))  # RESOLVED | STILL_EXISTS
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    verifier: Mapped[User] = relationship()


class ResolutionMemory(Base):
    __tablename__ = "resolution_memory"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"), index=True)
    complaint_id: Mapped[int] = mapped_column(ForeignKey("complaints.id"))
    station_id: Mapped[int | None] = mapped_column(ForeignKey("stations.id"), nullable=True)
    category: Mapped[str] = mapped_column(String(48), index=True)
    problem_summary: Mapped[str] = mapped_column(Text)
    findings: Mapped[list] = mapped_column(JSON, default=list)
    approved_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    solution_id: Mapped[int | None] = mapped_column(ForeignKey("solution_proposals.id"), nullable=True)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    outcome: Mapped[str] = mapped_column(String(32))  # VERIFIED_RESOLVED | FAILED_REOPENED
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    provenance: Mapped[str] = mapped_column(String(32), default="VERIFIED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Incident(Base):
    __tablename__ = "incidents"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True)
    finding_id: Mapped[int | None] = mapped_column(ForeignKey("engineer_findings.id"), nullable=True)
    station_id: Mapped[int | None] = mapped_column(ForeignKey("stations.id"), nullable=True)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(16), default="MEDIUM")
    status: Mapped[str] = mapped_column(String(24), default="OPEN")
    recorded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    provenance: Mapped[str] = mapped_column(String(32), default="VERIFIED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class MaintenanceRecord(Base):
    __tablename__ = "maintenance_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True)
    station_id: Mapped[int | None] = mapped_column(ForeignKey("stations.id"), nullable=True)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    work_type: Mapped[str] = mapped_column(String(48))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="PLANNED")
    performed_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    provenance: Mapped[str] = mapped_column(String(32), default="DOCUMENTED")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class GraphEntity(Base):
    __tablename__ = "graph_entities"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    type: Mapped[str] = mapped_column(String(32), index=True)
    label: Mapped[str] = mapped_column(String(255))
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    properties: Mapped[dict] = mapped_column(JSON, default=dict)
    provenance: Mapped[str] = mapped_column(String(32))


class GraphRelationship(Base):
    __tablename__ = "graph_relationships"
    __table_args__ = (UniqueConstraint("source_id", "target_id", "type"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("graph_entities.id", ondelete="CASCADE"), index=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("graph_entities.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(48))
    provenance: Mapped[str] = mapped_column(String(32))
    method: Mapped[str] = mapped_column(String(64))  # how the edge was derived
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    evidence: Mapped[list] = mapped_column(JSON, default=list)  # traceable origins
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(48), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    actor: Mapped[User | None] = relationship()


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(48), index=True)
    status: Mapped[str] = mapped_column(String(24), default="QUEUED", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="New conversation")
    scope: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    citations: Mapped[list] = mapped_column(JSON, default=list)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


Index("ix_chunks_doc_idx", DocumentChunk.document_id, DocumentChunk.chunk_index)
