"""Complaint similarity: links repeated or similar reports without merging them.

Each complaint's text is embedded with the local embedding model (stored on the complaint). Similarity is cosine
between embeddings. A match above the threshold means "the reports read alike" — it does not prove they describe
the same fault, and complaints are never merged.
"""
from __future__ import annotations

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Complaint
from .embeddings import get_embedder, to_blob


def _text(c: Complaint) -> str:
    return f"{c.category.replace('_', ' ')}: {c.description}"


def ensure_embedding(db: Session, c: Complaint) -> np.ndarray:
    emb = get_embedder()
    if c.embedding:
        v = np.frombuffer(c.embedding, dtype=np.float32)
        if v.shape[0] == emb.dim:
            return v
    v = emb.embed([_text(c)])[0].astype(np.float32)
    c.embedding = to_blob(v)
    return v


def similar_complaints(db: Session, c: Complaint, limit: int = 8, only_earlier: bool = False,
                       threshold: float | None = None) -> list[dict]:
    thr = settings.complaint_similarity_threshold if threshold is None else threshold
    qv = ensure_embedding(db, c)
    q = select(Complaint).where(Complaint.id != c.id).order_by(Complaint.id.desc()).limit(3000)
    if only_earlier:
        q = q.where(Complaint.id < c.id)
    others = list(db.scalars(q))
    if not others:
        return []
    mat = np.stack([ensure_embedding(db, o) for o in others])
    sims = mat @ qv / ((np.linalg.norm(mat, axis=1) * (np.linalg.norm(qv) or 1)) + 1e-9)
    out = []
    for score, o in sorted(zip(sims, others), key=lambda x: -x[0]):
        if score < thr:
            break
        same_station, same_cat = o.station_id == c.station_id, o.category == c.category
        relation = ("Possible repeat report (same station and category)" if same_station and same_cat
                    else "Similar issue at the same station" if same_station
                    else "Similar issue at another station")
        out.append({"id": o.id, "complaint_code": o.complaint_code, "similarity": round(float(score), 3), "threshold": thr,
                    "same_station": same_station, "same_category": same_cat,
                    "same_asset": bool(o.asset_id and o.asset_id == c.asset_id), "relation": relation,
                    "station": o.station.display_name if o.station else None, "category": o.category,
                    "summary": o.description[:160], "created_at": o.created_at.isoformat() + "Z",
                    "ticket_id": o.ticket.id if o.ticket else None, "ticket_code": o.ticket.ticket_code if o.ticket else None,
                    "status": o.ticket.status if o.ticket else None,
                    "why": f"Complaint texts have cosine similarity {score:.2f} (≥ {thr:.2f})" +
                           ("; same station" if same_station else "") + ("; same category" if same_cat else "")})
        if len(out) >= limit:
            break
    return out


def station_groups(db: Session, station_id: int, active_only: bool = True) -> list[dict]:
    """Groups of mutually similar complaints at one station (connected components over the similarity graph)."""
    from .tickets import ACTIVE_STATES
    cs = list(db.scalars(select(Complaint).where(Complaint.station_id == station_id).order_by(Complaint.id)))
    if active_only:
        cs = [c for c in cs if c.ticket and c.ticket.status in ACTIVE_STATES]
    if len(cs) < 2:
        return []
    vecs = np.stack([ensure_embedding(db, c) for c in cs])
    vecs = vecs / (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9)
    sims = vecs @ vecs.T
    thr = settings.complaint_similarity_threshold
    parent = list(range(len(cs)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(len(cs)):
        for j in range(i + 1, len(cs)):
            if sims[i, j] >= thr:
                parent[find(i)] = find(j)
    comps: dict[int, list[int]] = {}
    for i in range(len(cs)):
        comps.setdefault(find(i), []).append(i)
    groups = []
    for idx in comps.values():
        if len(idx) < 2:
            continue
        members = [cs[i] for i in idx]
        pair_scores = [float(sims[a, b]) for k, a in enumerate(idx) for b in idx[k + 1:]]
        groups.append({"size": len(members), "categories": sorted({m.category for m in members}),
                       "min_similarity": round(min(pair_scores), 3) if pair_scores else None,
                       "complaints": [{"id": m.id, "complaint_code": m.complaint_code, "summary": m.description[:120],
                                       "ticket_id": m.ticket.id if m.ticket else None, "status": m.ticket.status if m.ticket else None,
                                       "created_at": m.created_at.isoformat() + "Z"} for m in members],
                       "note": "Grouped because their texts are similar. Each complaint remains a separate record; a group is not a confirmed single fault."})
    return sorted(groups, key=lambda g: -g["size"])
