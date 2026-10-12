"""Document library: listing, status, page text, original-file viewing, uploads and (re)indexing."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import PROJECT_DIR, settings
from ..db import get_db
from ..models import Document, DocumentChunk, DocumentPage, GraphEntity, GraphRelationship, Job, User
from ..security import get_current_user, require_admin, require_perm, require_staff
from ..serializers import document_dict, iso
from ..services.common import audit
from ..services.embeddings import embedder_status, vector_index
from ..services.ingestion.extractors import SUPPORTED
from ..services.ingestion.pipeline import abs_path
from ..services.jobs import enqueue

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("")
def list_documents(q: str | None = None, category: str | None = None, status: str | None = None, doc_kind: str | None = None,
                   page: int = 1, page_size: int = 50, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    query = select(Document)
    if q:
        query = query.where(or_(Document.filename.ilike(f"%{q}%"), Document.title.ilike(f"%{q}%")))
    if category:
        query = query.where(Document.category == category)
    if status:
        query = query.where(Document.status == status)
    if doc_kind:
        query = query.where(Document.doc_kind == doc_kind)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(Document.category, Document.filename).offset((page - 1) * page_size).limit(min(page_size, 500)))
    return {"total": total, "items": [document_dict(d) for d in rows]}


@router.get("/stats")
def stats(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    by_status = dict(db.execute(select(Document.status, func.count()).group_by(Document.status)).all())
    by_cat = [{"category": c, "count": n, "chunks": ch or 0, "pages": p or 0} for c, n, ch, p in db.execute(
        select(Document.category, func.count(), func.sum(Document.chunk_count), func.sum(Document.page_count)).group_by(Document.category)).all()]
    by_kind = dict(db.execute(select(Document.doc_kind, func.count()).where(Document.status.in_(["INDEXED", "PARTIAL"])).group_by(Document.doc_kind)).all())
    chunks = db.scalar(select(func.count(DocumentChunk.id))) or 0
    embedded = db.scalar(select(func.count(DocumentChunk.id)).where(DocumentChunk.embedding.isnot(None))) or 0
    pages = db.scalar(select(func.sum(Document.page_count)).where(Document.status.in_(["INDEXED", "PARTIAL"]))) or 0
    ocr_pages = db.scalar(select(func.sum(Document.ocr_pages))) or 0
    active = db.scalar(select(Job).where(Job.type.in_(["INGEST_DOCUMENTS", "REINDEX_DOCUMENT", "BUILD_GRAPH"]), Job.status.in_(["QUEUED", "RUNNING"])).order_by(Job.id.desc()))
    return {"by_status": by_status, "by_category": by_cat, "by_kind": by_kind, "total": sum(by_status.values()),
            "indexed": by_status.get("INDEXED", 0) + by_status.get("PARTIAL", 0), "chunks": chunks, "embedded_chunks": embedded,
            "indexed_pages": pages, "ocr_pages": ocr_pages, "vector_index_size": vector_index.size, "embedder": embedder_status(),
            "active_job": {"id": active.id, "type": active.type, "status": active.status, "progress": active.progress,
                           "total": active.total, "message": active.message} if active else None}


@router.get("/{doc_id}")
def get_document(doc_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    d = db.get(Document, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    pages = [{"page_number": p.page_number, "label": p.label, "char_count": p.char_count, "ocr": p.ocr}
             for p in db.scalars(select(DocumentPage).where(DocumentPage.document_id == d.id).order_by(DocumentPage.page_number))]
    ent = db.scalar(select(GraphEntity).where(GraphEntity.key == f"document:{d.id}"))
    links = []
    if ent:
        for r in db.scalars(select(GraphRelationship).where(GraphRelationship.source_id == ent.id).order_by(GraphRelationship.weight.desc()).limit(40)):
            tgt = db.get(GraphEntity, r.target_id)
            links.append({"type": r.type, "target": {"key": tgt.key, "type": tgt.type, "label": tgt.label}, "weight": r.weight,
                          "provenance": r.provenance, "method": r.method, "evidence": r.evidence[:3]})
    return {**document_dict(d), "pages": pages, "graph_links": links,
            "duplicate_of": document_dict(db.get(Document, d.duplicate_of_id)) if d.duplicate_of_id else None}


@router.get("/{doc_id}/pages/{page_number}")
def page_text(doc_id: int, page_number: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    p = db.scalar(select(DocumentPage).where(DocumentPage.document_id == doc_id, DocumentPage.page_number == page_number))
    if not p:
        raise HTTPException(404, "Page text not available")
    return {"page_number": p.page_number, "label": p.label, "text": p.text, "ocr": p.ocr}


@router.get("/{doc_id}/chunks/{chunk_id}")
def chunk(doc_id: int, chunk_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    c = db.get(DocumentChunk, chunk_id)
    if not c or c.document_id != doc_id:
        raise HTTPException(404, "Passage not found")
    return {"id": c.id, "page": c.page_start, "heading": c.heading, "sheet": c.sheet, "row_start": c.row_start,
            "row_end": c.row_end, "text": c.text, "ocr": c.ocr}


@router.get("/{doc_id}/file")
def original_file(doc_id: int, token: str | None = None, db: Session = Depends(get_db)):
    """Serves the preserved original. Accepts ?token= so PDFs can open in a browser tab/iframe."""
    from ..security import STAFF_ROLES, get_current_user as _gcu
    if _gcu(token, db).role not in STAFF_ROLES:
        raise HTTPException(403, "Staff access required")
    d = db.get(Document, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    path = abs_path(d.rel_path).resolve()
    allowed = [settings.raw_data_dir.resolve(), settings.uploads_dir.resolve()]
    if not any(a in path.parents for a in allowed) or not path.exists():
        raise HTTPException(404, "Original file not available")
    media = {"pdf": "application/pdf", "txt": "text/plain; charset=utf-8", "md": "text/plain; charset=utf-8",
             "csv": "text/csv; charset=utf-8"}.get(d.file_type, "application/octet-stream")
    return FileResponse(path, media_type=media, filename=d.filename,
                        content_disposition_type="inline" if d.file_type in ("pdf", "txt", "md", "csv") else "attachment")


@router.post("/upload")
async def upload(files: list[UploadFile] = File(...), user: User = Depends(require_perm("document:upload")), db: Session = Depends(get_db)):
    saved = []
    dest = settings.uploads_dir / "documents"
    for f in files:
        ext = Path(f.filename or "").suffix.lower()
        if ext not in SUPPORTED:
            raise HTTPException(422, f"{f.filename}: unsupported type {ext}")
        data = await f.read()
        if not data:
            raise HTTPException(422, f"{f.filename}: empty file")
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(413, f"{f.filename}: exceeds {settings.max_upload_mb} MB")
        if ext == ".pdf" and not data.startswith(b"%PDF"):
            raise HTTPException(422, f"{f.filename}: not a valid PDF")
        if ext in (".docx", ".xlsx") and not data.startswith(b"PK"):
            raise HTTPException(422, f"{f.filename}: not a valid Office file")
        stem = re.sub(r"[^A-Za-z0-9_\- .]", "_", Path(f.filename).stem)[:120].strip(" .") or "document"
        target = dest / f"{stem}{ext}"
        if target.exists():
            target = dest / f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
        target.write_bytes(data)
        saved.append(target.name)
    job = enqueue(db, "INGEST_DOCUMENTS", {}, user.id)
    audit(db, user, "document.upload", "document", None, files=saved)
    db.commit()
    return {"saved": saved, "job_id": job.id}


@router.post("/ingest")
def ingest(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    job = enqueue(db, "INGEST_DOCUMENTS", {}, user.id)
    audit(db, user, "document.ingest", "job", job.id)
    db.commit()
    return {"job_id": job.id, "status": job.status}


@router.post("/{doc_id}/reindex")
def reindex(doc_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    d = db.get(Document, doc_id)
    if not d or d.status in ("MISSING", "DUPLICATE"):
        raise HTTPException(409, "Document cannot be re-indexed")
    job = enqueue(db, "REINDEX_DOCUMENT", {"document_id": doc_id}, user.id, dedupe=False)
    audit(db, user, "document.reindex", "document", doc_id)
    db.commit()
    return {"job_id": job.id}
