"""Collection-wide (map-reduce) analysis. MAP: search each indexed document independently for the question and
keep its strongest passages. REDUCE: rank documents, group findings, report coverage and failures honestly.
Intermediate results always retain links to the original passages."""
from __future__ import annotations

from sqlalchemy import select

from ..models import Document
from ..provenance import INSUFFICIENT_MSG
from .answer import RISK_CUES, best_sentences, detect_intent
from .retrieval import content_terms, hybrid_search


def run_collection_analysis(db, params: dict, progress, cancelled) -> dict:
    question = params["question"]
    terms = content_terms(question)
    intent = detect_intent(question)
    cues = RISK_CUES if intent == "risk" else None
    q = select(Document).where(Document.status != "MISSING")
    if params.get("document_ids"):
        q = q.where(Document.id.in_(params["document_ids"]))
    if params.get("categories"):
        q = q.where(Document.category.in_(params["categories"]))
    docs = list(db.scalars(q.order_by(Document.id)))
    findings, skipped, no_evidence = [], [], []
    total = len(docs)
    for i, d in enumerate(docs, start=1):
        if cancelled():
            break
        progress(i - 1, total, f"Analysing {d.filename}")
        if d.status not in ("INDEXED", "PARTIAL"):
            skipped.append({"document_id": d.id, "filename": d.filename, "status": d.status, "reason": d.error or "Not indexed"})
            continue
        hits = hybrid_search(db, question, k=3, doc_filter={d.id}, pool=30)
        strong = [h for h in hits if (h.vector_score or 0) >= 0.6 or len(h.matched_terms) >= max(1, len(terms) // 2)]
        if not strong:
            no_evidence.append({"document_id": d.id, "filename": d.filename})
            continue
        passages = []
        for h in strong[:3]:
            for s in best_sentences(h, terms, cues, n=1, min_score=0.1):
                passages.append({"chunk_id": h.chunk_id, "page": h.page, "sheet": h.sheet, "row_start": h.row_start,
                                 "row_end": h.row_end, "excerpt": s, "vector_score": h.vector_score,
                                 "matched_terms": h.matched_terms})
        if passages:
            best = max((p["vector_score"] or 0) for p in passages)
            findings.append({"document_id": d.id, "filename": d.filename, "title": d.title, "category": d.category,
                             "doc_kind": d.doc_kind, "relevance": round(best, 3), "passages": passages})
        else:
            no_evidence.append({"document_id": d.id, "filename": d.filename})
    processed = len(findings) + len(no_evidence)
    findings.sort(key=lambda f: -f["relevance"])
    by_category = {}
    for f in findings:
        by_category.setdefault(f["category"], []).append(f["filename"])
    progress(total if not cancelled() else processed + len(skipped), total, "Analysis complete" if not cancelled() else "Cancelled")
    return {
        "question": question,
        "intent": intent,
        "coverage": {"documents_in_scope": total, "documents_analysed": processed, "documents_with_evidence": len(findings),
                     "documents_without_evidence": len(no_evidence), "documents_skipped": len(skipped),
                     "complete": processed + len(skipped) == total},
        "findings": findings,
        "by_category": by_category,
        "no_evidence": no_evidence,
        "skipped": skipped,
        "conclusion": None if findings else INSUFFICIENT_MSG,
        "note": "Each finding quotes the strongest passages of one document. Documents that were skipped (failed, "
                "duplicate or unindexed) were not analysed and are listed separately.",
    }
