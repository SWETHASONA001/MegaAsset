"""Hybrid retrieval: SQLite FTS5 BM25 + dense cosine similarity, fused with reciprocal-rank fusion."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..models import Document, DocumentChunk
from .embeddings import get_embedder, vector_index

STOPWORDS = set("""a an the and or of to in on for with by from at as is are was were be been being this that these those
it its into about which what who whom whose when where why how do does did can could should would will shall may might
there their them they we our you your i me my any all each per than then also not no yes if so such more most other
some only very via up down out over under again further once here both few own same too s t just don now please tell
show give list find documents document docs pages page mention mentions mentioned discuss discusses say says report reports
between across among against""".split())

_token_re = re.compile(r"[A-Za-z0-9஀-௿][A-Za-z0-9஀-௿\-']+")


def content_terms(q: str) -> list[str]:
    out = []
    for t in _token_re.findall(q.lower()):
        t = t.strip("-'")
        if len(t) >= 2 and t not in STOPWORDS and t not in out:
            out.append(t)
    return out


MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], start=1)}


def expand_query(q: str) -> str:
    """Adds spreadsheet-style month tokens ("March 2024" -> "Mar-24") so tabular rows are matched."""
    extra = []
    for m in re.finditer(r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d\d)\b", q, re.I):
        extra.append(f"{m.group(1)[:3].title()}-{m.group(2)[2:]}")
    return f"{q} {' '.join(extra)}" if extra else q


def fts_query(q: str) -> str | None:
    terms = content_terms(q)
    if not terms:
        return None
    return " OR ".join(f'"{t}"' for t in terms[:24])


@dataclass
class Hit:
    chunk_id: int
    document_id: int
    title: str
    filename: str
    category: str
    doc_kind: str
    page: int | None
    heading: str | None
    sheet: str | None
    row_start: int | None
    row_end: int | None
    text: str
    ocr: bool
    score: float
    vector_score: float | None = None
    keyword_rank: int | None = None
    matched_terms: list[str] = field(default_factory=list)
    rerank_score: float | None = None

    def to_dict(self):
        return asdict(self)


def resolve_doc_filter(db: Session, doc_ids=None, categories=None, doc_kinds=None, collection=None) -> set[int] | None:
    if not any([doc_ids, categories, doc_kinds, collection]):
        return None
    q = select(Document.id).where(Document.status.in_(["INDEXED", "PARTIAL"]))
    if doc_ids:
        q = q.where(Document.id.in_(list(doc_ids)))
    if categories:
        q = q.where(Document.category.in_(list(categories)))
    if doc_kinds:
        q = q.where(Document.doc_kind.in_(list(doc_kinds)))
    if collection:
        q = q.where(Document.collection == collection)
    return set(db.scalars(q))


def keyword_search(db: Session, query: str, k: int = 60, doc_filter: set[int] | None = None) -> list[tuple[int, float]]:
    mq = fts_query(query)
    if not mq:
        return []
    sql = ("SELECT f.rowid, bm25(chunks_fts, 1.0, 0.6, 0.4) AS s FROM chunks_fts f "
           "JOIN document_chunks c ON c.id = f.rowid JOIN documents d ON d.id = c.document_id "
           "WHERE chunks_fts MATCH :q AND d.status IN ('INDEXED','PARTIAL')")
    params = {"q": mq, "k": k}
    if doc_filter is not None:
        if not doc_filter:
            return []
        sql += f" AND c.document_id IN ({','.join(str(int(i)) for i in doc_filter)})"
    sql += " ORDER BY s LIMIT :k"
    try:
        return [(int(r[0]), float(r[1])) for r in db.execute(text(sql), params)]
    except Exception:
        return []


_reranker = None
_reranker_error: str | None = None


def get_reranker():
    """Local cross-encoder (fastembed ONNX). Returns None if disabled or unavailable; status is reported on the Models page."""
    global _reranker, _reranker_error
    from ..config import settings
    if not settings.enable_reranker:
        return None
    if _reranker is None and _reranker_error is None:
        try:
            from fastembed.rerank.cross_encoder import TextCrossEncoder
            _reranker = TextCrossEncoder(settings.reranker_model, cache_dir=str(settings.models_dir))
        except Exception as exc:
            _reranker_error = f"{type(exc).__name__}: {exc}"
    return _reranker


def reranker_status() -> dict:
    from ..config import settings
    return {"enabled": settings.enable_reranker, "model": settings.reranker_model, "loaded": _reranker is not None,
            "error": _reranker_error}


def rerank(query: str, hits: list["Hit"], top_n: int = 30) -> list["Hit"]:
    rr = get_reranker()
    if not rr or not hits:
        return hits
    head, tail = hits[:top_n], hits[top_n:]
    scores = list(rr.rerank(query, [((h.heading + "\n") if h.heading else "") + h.text[:1500] for h in head]))
    for h, sc in zip(head, scores):
        h.rerank_score = round(float(sc), 3)
    head.sort(key=lambda h: -(h.rerank_score or -99))
    return head + tail


def hybrid_search(db: Session, query: str, k: int = 10, doc_filter: set[int] | None = None,
                  per_doc_cap: int | None = None, pool: int = 60, use_rerank: bool = False) -> list[Hit]:
    if doc_filter is not None and not doc_filter:
        return []
    query = expand_query(query)
    kw = keyword_search(db, query, pool, doc_filter)
    qvec = get_embedder().embed_query(query)
    vec = vector_index.search(db.get_bind(), qvec, pool, doc_filter)
    rrf: dict[int, float] = {}
    vscore = dict(vec)
    krank = {}
    for rank, (cid, _) in enumerate(kw):
        rrf[cid] = rrf.get(cid, 0) + 1.0 / (60 + rank)
        krank[cid] = rank + 1
    for rank, (cid, _) in enumerate(vec):
        rrf[cid] = rrf.get(cid, 0) + 1.0 / (60 + rank)
    if not rrf:
        return []
    ordered = sorted(rrf.items(), key=lambda x: -x[1])
    ids = [cid for cid, _ in ordered[: max(pool, k * 4)]]
    rows = {c.id: c for c in db.scalars(select(DocumentChunk).where(DocumentChunk.id.in_(ids)))}
    docs = {d.id: d for d in db.scalars(select(Document).where(Document.id.in_({c.document_id for c in rows.values()})))}
    terms = content_terms(query)
    hits, per_doc = [], {}
    # With reranking, collect a larger candidate set first, then let the cross-encoder order it.
    target = max(k, 30) if use_rerank else k
    for cid, s in ordered:
        c = rows.get(cid)
        if not c:
            continue
        if per_doc_cap and per_doc.get(c.document_id, 0) >= per_doc_cap:
            continue
        d = docs[c.document_id]
        low = c.text.lower()
        missing_vec = cid not in vscore
        hits.append(Hit(chunk_id=c.id, document_id=d.id, title=d.title, filename=d.filename, category=d.category,
                        doc_kind=d.doc_kind, page=c.page_start, heading=c.heading, sheet=c.sheet, row_start=c.row_start,
                        row_end=c.row_end, text=c.text, ocr=c.ocr, score=round(s, 5),
                        vector_score=None if missing_vec else round(vscore[cid], 4), keyword_rank=krank.get(cid),
                        matched_terms=[t for t in terms if t in low]))
        per_doc[c.document_id] = per_doc.get(c.document_id, 0) + 1
        if len(hits) >= target:
            break
    # Fill vector scores for keyword-only hits so evidence strength can be assessed uniformly
    need = [h for h in hits if h.vector_score is None]
    if need:
        import numpy as np
        for h in need:
            c = rows[h.chunk_id]
            if c.embedding:
                v = np.frombuffer(c.embedding, dtype=np.float32)
                if v.shape == qvec.shape:
                    h.vector_score = round(float(v @ qvec / ((np.linalg.norm(v) * np.linalg.norm(qvec)) or 1)), 4)
    if use_rerank:
        hits = rerank(query, hits)
    return hits[:k]
