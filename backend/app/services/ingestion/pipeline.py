"""Document discovery, registration and indexing.

Originals are never modified. Extracted page text, chunks, embeddings and the FTS index live in the database.
"""
from __future__ import annotations

import hashlib
import logging
import re
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from ...config import PROJECT_DIR, settings
from ...models import Document, DocumentChunk, DocumentPage, utcnow
from ..embeddings import get_embedder, to_blob, vector_index, write_meta
from .chunker import chunk_document
from .extractors import SUPPORTED, safe_extract

log = logging.getLogger("megaasset.ingest")

CATEGORY_BY_FOLDER = {
    "annual_reports": "Annual Report",
    "compliance": "Compliance & Environment",
    "contracts": "Contracts & Tenders",
    "maintenance": "Maintenance Procurement",
    "lift_escalator": "Maintenance Procurement",
    "ups_battery": "Maintenance Procurement",
    "projects": "Projects",
    "safety": "Safety",
    "parking": "Parking",
    "ridership": "Ridership Data",
    "passenger_flow": "Passenger Flow Data",
    "documents": "Uploaded Documents",
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _is_gtfs_dir(d: Path) -> bool:
    return (d / "stops.txt").exists() and (d / "routes.txt").exists()


def discover_files(roots: list[Path] | None = None) -> list[Path]:
    """Recursive discovery. GTFS feed folders are datasets, not documents, and are skipped here."""
    roots = roots or [settings.raw_data_dir, settings.uploads_dir / "documents"]
    found = []
    for root in roots:
        if not root.exists():
            continue
        stack = [root]
        while stack:
            d = stack.pop()
            if _is_gtfs_dir(d):
                continue
            for p in sorted(d.iterdir()):
                if p.is_dir():
                    stack.append(p)
                elif p.suffix.lower() in SUPPORTED and not p.name.startswith((".", "~$")):
                    found.append(p)
    return sorted(found)


def rel_path(p: Path) -> str:
    try:
        return p.resolve().relative_to(PROJECT_DIR.resolve()).as_posix()
    except ValueError:
        return p.resolve().as_posix()


def abs_path(rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else (PROJECT_DIR / p)


def _title_from_name(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"[_]+", " ", stem).strip(" .")
    return re.sub(r"\s+", " ", stem)


def _category(p: Path) -> tuple[str, str]:
    parts = [x.lower() for x in p.parts]
    for folder in reversed(parts[:-1]):
        if folder in CATEGORY_BY_FOLDER:
            return CATEGORY_BY_FOLDER[folder], folder
    return "General", parts[-2] if len(parts) > 1 else ""


def _doc_kind(filename: str, category: str, first_text: str) -> str:
    n = filename.lower()
    t = (first_text or "")[:3000].lower()
    if any(k in n for k in ("corrigendum", "addendum", "prebid", "pre_bid")):
        return "TENDER_AMENDMENT"
    if "nit" in re.split(r"[_\s.]", n) or "notice inviting tender" in t or "tender" in n:
        return "TENDER"
    if category == "Annual Report":
        return "ANNUAL_REPORT"
    if category in ("Ridership Data", "Passenger Flow Data"):
        return "DATA_TABLE"
    if "monitoring report" in n or "environment statement" in n:
        return "COMPLIANCE_REPORT"
    if "tariff" in n:
        return "TARIFF_NOTICE"
    if "tender" in t or "bid" in t[:800]:
        return "TENDER"
    return "REPORT"


def register_files(db: Session, files: list[Path], uploaded_by: int | None = None) -> dict:
    """Create/refresh document records. Returns ids that need (re)processing."""
    to_process, unchanged, duplicates = [], 0, 0
    seen = set()
    for p in files:
        rp = rel_path(p)
        seen.add(rp)
        stat = p.stat()
        doc = db.scalar(select(Document).where(Document.rel_path == rp))
        if doc and doc.file_mtime == stat.st_mtime and doc.size_bytes == stat.st_size and \
                doc.status in ("INDEXED", "PARTIAL", "DUPLICATE", "OCR_PENDING"):
            unchanged += 1
            continue
        checksum = sha256_file(p)
        if doc and doc.checksum == checksum and doc.status in ("INDEXED", "PARTIAL", "DUPLICATE", "OCR_PENDING"):
            doc.file_mtime = stat.st_mtime
            unchanged += 1
            continue
        category, folder = _category(p)
        origin = "UPLOAD" if "uploads" in p.parts else "RAW"
        if not doc:
            doc = Document(rel_path=rp, filename=p.name, title=_title_from_name(p.name), category=category,
                           collection=folder or "cmrl", file_type=p.suffix.lower().lstrip("."), size_bytes=stat.st_size,
                           checksum=checksum, origin=origin, uploaded_by=uploaded_by, file_mtime=stat.st_mtime,
                           meta={"folder": folder})
            db.add(doc)
            db.flush()
        else:
            doc.checksum, doc.size_bytes, doc.file_mtime = checksum, stat.st_size, stat.st_mtime
        # Duplicate detection by content hash
        original = db.scalar(select(Document).where(Document.checksum == checksum, Document.id != doc.id,
                                                    Document.duplicate_of_id.is_(None),
                                                    Document.status.in_(["INDEXED", "PARTIAL", "PENDING", "PROCESSING"]))
                             .order_by(Document.id))
        if original:
            _clear_index(db, doc.id)
            doc.status, doc.duplicate_of_id, doc.chunk_count = "DUPLICATE", original.id, 0
            doc.error = f"Identical content to '{original.filename}' (sha256 match); not re-indexed."
            duplicates += 1
            continue
        doc.duplicate_of_id = None
        doc.status, doc.error = "PENDING", None
        to_process.append(doc.id)
    # Files that disappeared from disk
    missing = 0
    for doc in db.scalars(select(Document).where(Document.status != "MISSING")):
        if doc.rel_path not in seen and not abs_path(doc.rel_path).exists():
            _clear_index(db, doc.id)
            doc.status, doc.error, doc.chunk_count = "MISSING", "Source file no longer present on disk", 0
            missing += 1
    db.commit()
    return {"to_process": to_process, "unchanged": unchanged, "duplicates": duplicates, "missing": missing}


def _clear_index(db: Session, doc_id: int) -> None:
    ids = list(db.scalars(select(DocumentChunk.id).where(DocumentChunk.document_id == doc_id)))
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        db.execute(text(f"DELETE FROM chunks_fts WHERE rowid IN ({','.join(map(str, part))})"))
    db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_id))
    db.execute(delete(DocumentPage).where(DocumentPage.document_id == doc_id))


_AR_RE = re.compile(r"(\d{1,2})\s*(?:st|nd|rd|th)?\s*ANNUAL\s+REPORT\s*(20\d\d)\s*[-\u2013]\s*(\d{2,4})", re.I)


def apply_detected_metadata(doc: Document, page_texts: list[str]) -> None:
    """Detect the reporting period from the document's own cover pages. Filenames are never trusted over content;
    a mismatch is recorded as a warning and shown in the UI."""
    meta = dict(doc.meta or {})
    meta["period_checked"] = True
    if doc.category != "Annual Report":
        doc.meta = meta
        return
    for i, t in enumerate(page_texts[:14]):
        m = _AR_RE.search(t or "")
        if m:
            start, end = m.group(2), m.group(3)
            period = f"{start}-{end[-2:]}"
            meta.update(detected_period=period, detected_edition=int(m.group(1)), period_source_page=i + 1,
                        period_method="cover/heading text: 'Nth ANNUAL REPORT YYYY-YY'")
            doc.title = f"CMRL {m.group(1)}th Annual Report {period}"
            fn = re.search(r"(20\d\d)[_-](\d{2})", doc.filename)
            if fn and f"{fn.group(1)}-{fn.group(2)}" != period:
                w = (f"Filename suggests {fn.group(1)}-{fn.group(2)} but the document states '{m.group(0).strip()}' "
                     f"on page {i + 1}. The content-detected period is used; the original file is unchanged.")
                meta["filename_mismatch"] = w
            else:
                meta.pop("filename_mismatch", None)
            break
    doc.meta = meta


def backfill_metadata(db: Session) -> int:
    n = 0
    for d in db.scalars(select(Document).where(Document.status.in_(["INDEXED", "PARTIAL"]))):
        if (d.meta or {}).get("period_checked"):
            continue
        texts = [p.text for p in db.scalars(select(DocumentPage).where(DocumentPage.document_id == d.id)
                                            .order_by(DocumentPage.page_number).limit(14))]
        apply_detected_metadata(d, texts)
        n += 1
    db.commit()
    return n


def store_extraction(db: Session, doc: Document, result: dict) -> list[DocumentChunk]:
    _clear_index(db, doc.id)
    if "error" in result:
        doc.status, doc.error = "FAILED", result["error"]
        return []
    units = result["units"]
    for u in units:
        if u.get("text"):
            db.add(DocumentPage(document_id=doc.id, page_number=u.get("page") or 1, label=u.get("label"),
                                text=u["text"], char_count=len(u["text"]), ocr=u.get("ocr", False)))
    chunks = chunk_document(units)
    first_text = next((u["text"] for u in units if u.get("text")), "")
    doc.page_count = result.get("page_count", 0)
    doc.ocr_pages = result.get("ocr_pages", 0)
    doc.ocr_used = doc.ocr_pages > 0
    doc.empty_pages = result.get("empty_pages", 0)
    doc.char_count = sum(len(u.get("text") or "") for u in units)
    doc.doc_kind = _doc_kind(doc.filename, doc.category, first_text)
    warnings = result.get("warnings", [])
    pending = result.get("needs_ocr", []) if settings.enable_ocr else []
    doc.meta = {**(doc.meta or {}), "warnings": warnings[:20], "ocr_pending_pages": pending,
                "no_text_pages": result.get("needs_ocr", [])}
    apply_detected_metadata(doc, [u.get("text") or "" for u in units])
    rows = []
    for c in chunks:
        ch = DocumentChunk(document_id=doc.id, chunk_index=c["chunk_index"], page_start=c.get("page_start"),
                           page_end=c.get("page_end"), sheet=c.get("sheet"), row_start=c.get("row_start"),
                           row_end=c.get("row_end"), heading=(c.get("heading") or "")[:500] or None,
                           text=c["text"], ocr=c.get("ocr", False))
        db.add(ch)
        rows.append(ch)
    db.flush()
    for ch in rows:
        db.execute(text("INSERT INTO chunks_fts(rowid, content, heading, doc_title) VALUES (:id, :c, :h, :t)"),
                   {"id": ch.id, "c": ch.text, "h": ch.heading or "", "t": doc.title})
    doc.chunk_count = len(rows)
    return rows


def embed_chunks(db: Session, chunks: list[DocumentChunk]) -> None:
    emb = get_embedder()
    bs = max(8, settings.embedding_batch_size)
    for i in range(0, len(chunks), bs):
        batch = chunks[i:i + bs]
        texts = [(f"{c.heading}\n" if c.heading else "") + c.text for c in batch]
        vecs = emb.embed(texts)
        for c, v in zip(batch, vecs):
            c.embedding = to_blob(v)
    write_meta(embedding_model=emb.name, embedding_dim=emb.dim)


def finalize_status(doc: Document) -> None:
    if doc.status == "FAILED":
        return
    pending = (doc.meta or {}).get("ocr_pending_pages") or []
    if doc.chunk_count == 0 and pending:
        doc.status = "OCR_PENDING"
        doc.error = f"No text layer on {len(pending)} page(s); queued for OCR."
        return
    if doc.chunk_count == 0:
        doc.status = "FAILED"
        doc.error = doc.error or ("No extractable text. " + ("OCR produced no text." if settings.enable_ocr
                                                               else "Enable OCR for scanned documents."))
    elif doc.empty_pages and doc.page_count and doc.empty_pages > doc.page_count * 0.5:
        doc.status = "PARTIAL"
        doc.error = f"{doc.empty_pages} of {doc.page_count} pages had no extractable text."
    else:
        doc.status = "INDEXED"
        doc.error = f"OCR pending for {len(pending)} image-only page(s)." if pending else None
    doc.indexed_at = utcnow()


def ocr_pending_documents(db: Session, progress=None, should_cancel=None) -> dict:
    """OCR pages that had no text layer and append their chunks (existing chunks are not re-embedded).

    Each page is atomic: OCR -> chunk -> embed -> FTS -> remove from pending -> commit. An interruption therefore
    never leaves un-embedded passages behind, and a restart resumes at the next pending page.
    """
    from .chunker import chunk_text_unit
    from .extractors import ocr_pdf_pages

    docs = [d for d in db.scalars(select(Document).where(Document.status.in_(["OCR_PENDING", "INDEXED", "PARTIAL"])))
            if (d.meta or {}).get("ocr_pending_pages")]
    docs.sort(key=lambda d: (d.status != "OCR_PENDING", d.id))  # scanned documents first
    total_pages = sum(len(d.meta["ocr_pending_pages"]) for d in docs)
    done_pages, out = 0, {"documents": [], "pages_ocred": 0, "pages_with_text": 0}
    for d in docs:
        pending = list(d.meta["ocr_pending_pages"])
        processed = with_text = 0
        for page in pending:
            if should_cancel and should_cancel():
                break
            try:
                text_ = ocr_pdf_pages(str(abs_path(d.rel_path)), [page]).get(page, "")
            except Exception as exc:
                log.warning("OCR failed for %s p.%s: %s", d.filename, page, exc)
                text_ = ""
            new_chunks = []
            if len(text_) >= 30:
                # drop anything previously stored for this page by OCR (idempotent re-run)
                old = list(db.scalars(select(DocumentChunk.id).where(DocumentChunk.document_id == d.id,
                                                                     DocumentChunk.page_start == page, DocumentChunk.ocr.is_(True))))
                if old:
                    db.execute(text(f"DELETE FROM chunks_fts WHERE rowid IN ({','.join(map(str, old))})"))
                    db.execute(delete(DocumentChunk).where(DocumentChunk.id.in_(old)))
                existing = db.scalar(select(DocumentPage).where(DocumentPage.document_id == d.id, DocumentPage.page_number == page))
                if existing:
                    existing.text, existing.char_count, existing.ocr = text_, len(text_), True
                else:
                    db.add(DocumentPage(document_id=d.id, page_number=page, text=text_, char_count=len(text_), ocr=True))
                last = db.scalar(select(DocumentChunk.chunk_index).where(DocumentChunk.document_id == d.id)
                                 .order_by(DocumentChunk.chunk_index.desc()))
                idx = (last if last is not None else -1) + 1
                chunks, _ = chunk_text_unit(text_, page, None, ocr=True)
                for c in chunks:
                    ch = DocumentChunk(document_id=d.id, chunk_index=idx, page_start=page, page_end=page,
                                       heading=(c.get("heading") or "")[:500] or None, text=c["text"], ocr=True)
                    idx += 1
                    db.add(ch)
                    new_chunks.append(ch)
                db.flush()
                embed_chunks(db, new_chunks)
                for ch in new_chunks:
                    db.execute(text("INSERT INTO chunks_fts(rowid, content, heading, doc_title) VALUES (:id, :c, :h, :t)"),
                               {"id": ch.id, "c": ch.text, "h": ch.heading or "", "t": d.title})
                with_text += 1
                d.ocr_pages = (d.ocr_pages or 0) + 1
                d.empty_pages = max(0, (d.empty_pages or 0) - 1)
            d.chunk_count = db.scalar(select(func.count(DocumentChunk.id)).where(DocumentChunk.document_id == d.id)) or 0
            d.char_count = (d.char_count or 0) + sum(len(c.text) for c in new_chunks)
            d.ocr_used = (d.ocr_pages or 0) > 0
            remaining = [x for x in (d.meta or {}).get("ocr_pending_pages", []) if x != page]
            d.meta = {**(d.meta or {}), "ocr_pending_pages": remaining}
            if d.status == "OCR_PENDING" and d.chunk_count:
                d.status = "INDEXED"
            if not remaining:
                d.status, d.error = "INDEXED", None
                finalize_status(d)
            db.commit()
            vector_index.bump()
            processed += 1
            done_pages += 1
            if progress:
                progress(done_pages, total_pages, f"OCR {d.filename} p.{page}")
        out["documents"].append({"filename": d.filename, "pages": processed, "pages_with_text": with_text, "status": d.status})
        out["pages_ocred"] += processed
        out["pages_with_text"] += with_text
        if should_cancel and should_cancel():
            break
    return out


def process_documents(db: Session, doc_ids: list[int], progress=None, should_cancel=None, workers: int | None = None) -> dict:
    """Extract in a bounded process pool (PyMuPDF/OCR are not thread-safe); embed + write in this thread."""
    done = failed = 0
    results = {"indexed": [], "failed": [], "partial": []}
    if not doc_ids:
        return results
    docs = {d.id: d for d in db.scalars(select(Document).where(Document.id.in_(doc_ids)))}
    for d in docs.values():
        d.status = "PROCESSING"
    db.commit()
    n_workers = max(1, min(workers or settings.ingest_workers, len(doc_ids)))

    def handle(doc: Document, result: dict):
        nonlocal done, failed
        try:
            chunks = store_extraction(db, doc, result)
            if chunks:
                embed_chunks(db, chunks)
            finalize_status(doc)
        except Exception as exc:
            db.rollback()
            doc = db.get(Document, doc.id)
            doc.status, doc.error = "FAILED", f"{type(exc).__name__}: {exc}"
            log.exception("Indexing failed for %s", doc.filename)
        db.commit()
        vector_index.bump()
        key = {"INDEXED": "indexed", "PARTIAL": "partial"}.get(doc.status, "failed")
        results[key].append(doc.filename)
        done += 1
        if progress:
            progress(done, len(doc_ids), f"{doc.status.title()}: {doc.filename}")

    if n_workers == 1:
        for did in doc_ids:
            if should_cancel and should_cancel():
                break
            d = docs[did]
            handle(d, safe_extract(str(abs_path(d.rel_path)), settings.enable_ocr))
    else:
        with ProcessPoolExecutor(max_workers=n_workers) as pool:
            futs = {pool.submit(safe_extract, str(abs_path(docs[i].rel_path)), settings.enable_ocr): i for i in doc_ids}
            for fut in as_completed(futs):
                if should_cancel and should_cancel():
                    for f in futs:
                        f.cancel()
                    break
                d = docs[futs[fut]]
                try:
                    res = fut.result()
                except Exception as exc:
                    res = {"error": f"{type(exc).__name__}: {exc}"}
                handle(d, res)
    # Anything left PROCESSING (cancelled) goes back to PENDING
    for d in docs.values():
        db.refresh(d)
        if d.status == "PROCESSING":
            d.status = "PENDING"
    db.commit()
    return results
