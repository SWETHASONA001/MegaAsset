"""Persistent background job queue (single worker thread). Jobs survive restarts: RUNNING jobs found at startup
are re-queued. Cancellation is cooperative (checked between documents)."""
from __future__ import annotations

import logging
import threading
import time
import traceback

from sqlalchemy import select

from ..config import settings
from ..db import SessionLocal
from ..models import Document, Job, utcnow

log = logging.getLogger("megaasset.jobs")

JOB_TYPES = {"OCR_DOCUMENTS", "INGEST_DOCUMENTS", "INGEST_DATASETS", "BUILD_GRAPH", "COLLECTION_ANALYSIS", "REINDEX_DOCUMENT"}


def enqueue(db, type_: str, params: dict | None = None, user_id: int | None = None, dedupe: bool = True) -> Job:
    assert type_ in JOB_TYPES
    if dedupe and type_ != "COLLECTION_ANALYSIS":
        existing = db.scalar(select(Job).where(Job.type == type_, Job.status.in_(["QUEUED", "RUNNING"])))
        if existing and existing.params == (params or {}):
            return existing
    job = Job(type=type_, params=params or {}, created_by=user_id, status="QUEUED", message="Queued")
    db.add(job)
    db.commit()
    _wake.set()
    return job


_wake = threading.Event()
_stop = threading.Event()
_thread: threading.Thread | None = None


def _run_job(job_id: int):
    from .analysis import run_collection_analysis
    from .datasets import load_all_datasets
    from .graph import build_graph
    from .ingestion.pipeline import discover_files, process_documents, register_files

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        job.status, job.started_at, job.message = "RUNNING", utcnow(), "Starting"
        db.commit()

        def progress(done, total, msg):
            j = db.get(Job, job_id)
            j.progress, j.total, j.message = done, total, msg
            db.commit()

        def cancelled():
            db.expire_all()
            return bool(db.get(Job, job_id).cancel_requested)

        result = {}
        if job.type == "INGEST_DOCUMENTS":
            files = discover_files()
            progress(0, len(files), f"Discovered {len(files)} files; checking checksums")
            reg = register_files(db, files)
            pending = list(db.scalars(select(Document.id).where(Document.status.in_(["PENDING", "PROCESSING"]))))
            progress(0, len(pending), f"{len(pending)} documents to index ({reg['unchanged']} unchanged, {reg['duplicates']} duplicates)")
            res = process_documents(db, pending, progress, cancelled)
            from .ingestion.pipeline import backfill_metadata
            backfill_metadata(db)
            result = {"discovered": len(files), **{k: v for k, v in reg.items() if k != "to_process"},
                      "indexed": res["indexed"], "partial": res["partial"], "failed": res["failed"]}
            if not cancelled():
                enqueue(db, "BUILD_GRAPH", {})
                if settings.enable_ocr and any((d.meta or {}).get("ocr_pending_pages") for d in db.scalars(select(Document))):
                    enqueue(db, "OCR_DOCUMENTS", {})
        elif job.type == "OCR_DOCUMENTS":
            from .ingestion.pipeline import ocr_pending_documents
            result = ocr_pending_documents(db, progress, cancelled)
            if result["pages_with_text"]:
                enqueue(db, "BUILD_GRAPH", {})
        elif job.type == "REINDEX_DOCUMENT":
            doc = db.get(Document, job.params["document_id"])
            doc.status, doc.file_mtime = "PENDING", 0
            db.commit()
            res = process_documents(db, [doc.id], progress, cancelled, workers=1)
            result = res
            enqueue(db, "BUILD_GRAPH", {})
            if settings.enable_ocr and (db.get(Document, doc.id).meta or {}).get("ocr_pending_pages"):
                enqueue(db, "OCR_DOCUMENTS", {})
        elif job.type == "INGEST_DATASETS":
            progress(0, 4, "Processing structured datasets")
            result = load_all_datasets(db)
            progress(4, 4, "Datasets processed")
        elif job.type == "BUILD_GRAPH":
            result = build_graph(db, progress)
        elif job.type == "COLLECTION_ANALYSIS":
            result = run_collection_analysis(db, job.params, progress, cancelled)

        job = db.get(Job, job_id)
        db.refresh(job)
        job.result = result
        job.finished_at = utcnow()
        if job.cancel_requested:
            job.status, job.message = "CANCELLED", "Cancelled by user; partial results retained"
        else:
            job.status, job.message = "COMPLETED", job.message or "Completed"
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.get(Job, job_id)
        job.status, job.error, job.finished_at = "FAILED", f"{type(exc).__name__}: {exc}", utcnow()
        job.message = "Failed"
        job.result = {"traceback": traceback.format_exc()[-3000:]}
        db.commit()
        log.exception("Job %s failed", job_id)
    finally:
        db.close()


def _loop():
    while not _stop.is_set():
        db = SessionLocal()
        try:
            job = db.scalar(select(Job).where(Job.status == "QUEUED").order_by(Job.id))
            jid = job.id if job else None
        finally:
            db.close()
        if jid:
            _run_job(jid)
            continue
        _wake.wait(timeout=3)
        _wake.clear()


def recover_interrupted():
    db = SessionLocal()
    try:
        for j in db.scalars(select(Job).where(Job.status == "RUNNING")):
            j.status, j.message = "QUEUED", "Recovered after restart; re-queued"
        for d in db.scalars(select(Document).where(Document.status == "PROCESSING")):
            d.status = "PENDING"
        db.commit()
    finally:
        db.close()


def start_worker():
    global _thread
    if _thread and _thread.is_alive():
        return
    recover_interrupted()
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="megaasset-jobs", daemon=True)
    _thread.start()


def stop_worker():
    _stop.set()
    _wake.set()


def run_pending_sync(timeout: float = 600):
    """Testing helper: process the queue in the calling thread until empty."""
    end = time.time() + timeout
    while time.time() < end:
        db = SessionLocal()
        job = db.scalar(select(Job).where(Job.status == "QUEUED").order_by(Job.id))
        jid = job.id if job else None
        db.close()
        if not jid:
            return
        _run_job(jid)
