"""Knowledge graph, Graph-RAG, agentic investigations, risk intelligence and resolution memory."""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..agents.workflow import STAGES, run_investigation
from ..db import get_db
from ..models import (Complaint, Evidence, GraphEntity, GraphRelationship, Investigation, ResolutionMemory, RiskAssessment,
                      SolutionProposal, Station, Ticket, User, utcnow)
from ..provenance import COMPLAINT_CATEGORIES, INSUFFICIENT_MSG
from ..security import get_current_user, require_admin, require_perm, require_staff
from ..serializers import iso, station_brief
from ..services.answer import RISK_CUES, answer_question, best_sentences, evidence_strength
from ..services.common import audit, new_code, user_brief
from ..services.graph import TOPICS, entity_dict, identify_entities, neighbourhood, rel_dict, sync_records
from ..services.jobs import enqueue
from ..services.retrieval import content_terms, hybrid_search
from ..services.tickets import add_event

router = APIRouter(prefix="/api", tags=["intelligence"])


# ---------------- Knowledge graph ----------------
@router.get("/graph")
def graph_overview(types: list[str] = Query(default=["station", "line", "topic", "document", "project", "complaint", "ticket", "investigation", "resolution", "incident", "solution"]),
                   min_weight: float = 1, limit: int = 450, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    ents = list(db.scalars(select(GraphEntity).where(GraphEntity.type.in_(types)).limit(limit)))
    ids = {e.id for e in ents}
    rels = [r for r in db.scalars(select(GraphRelationship).where(GraphRelationship.source_id.in_(ids), GraphRelationship.target_id.in_(ids)))
            if r.weight >= min_weight or r.type not in ("MENTIONS", "DISCUSSES")]
    degree = defaultdict(int)
    for r in rels:
        degree[r.source_id] += 1
        degree[r.target_id] += 1
    counts = dict(db.execute(select(GraphEntity.type, func.count()).group_by(GraphEntity.type)).all())
    rel_counts = dict(db.execute(select(GraphRelationship.type, func.count()).group_by(GraphRelationship.type)).all())
    prov_counts = dict(db.execute(select(GraphRelationship.provenance, func.count()).group_by(GraphRelationship.provenance)).all())
    return {"nodes": [entity_dict(e, degree[e.id]) for e in ents], "edges": [rel_dict(r) for r in rels],
            "counts": counts, "relationship_counts": rel_counts, "provenance_counts": prov_counts}


@router.get("/graph/search")
def graph_search(q: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.scalars(select(GraphEntity).where(or_(GraphEntity.label.ilike(f"%{q}%"), GraphEntity.key.ilike(f"%{q}%"))).limit(25))
    return [entity_dict(e) for e in rows]


@router.get("/graph/entity/{entity_id}")
def graph_entity(entity_id: int, depth: int = 1, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    e = db.get(GraphEntity, entity_id)
    if not e:
        raise HTTPException(404, "Entity not found")
    g = neighbourhood(db, [e.key], depth=min(depth, 2), limit=120)
    return {"entity": entity_dict(e), **g}


@router.get("/graph/relationship/{rel_id}")
def graph_rel(rel_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    r = db.get(GraphRelationship, rel_id)
    if not r:
        raise HTTPException(404, "Relationship not found")
    return {**rel_dict(r), "source_entity": entity_dict(db.get(GraphEntity, r.source_id)), "target_entity": entity_dict(db.get(GraphEntity, r.target_id))}


@router.post("/graph/rebuild")
def rebuild(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    job = enqueue(db, "BUILD_GRAPH", {}, user.id)
    return {"job_id": job.id}


class GraphRagIn(BaseModel):
    question: str = Field(min_length=3, max_length=1000)


@router.post("/graph/query")
def graph_rag(body: GraphRagIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Query Understanding → Entity Identification → Vector+Keyword Retrieval + Graph Retrieval → Evidence Fusion
    → Evidence Evaluation → Grounded Answer. Each stage's output is returned for transparency."""
    stages = []
    t0 = time.time()
    terms = content_terms(body.question)
    from ..services.answer import detect_intent
    intent = detect_intent(body.question)
    stages.append({"stage": "Query understanding", "output": {"intent": intent, "terms": terms}, "ms": int((time.time() - t0) * 1000)})
    t = time.time()
    ents = identify_entities(db, body.question)
    stages.append({"stage": "Entity identification", "output": {"entities": [entity_dict(e) for e in ents]}, "ms": int((time.time() - t) * 1000)})
    t = time.time()
    dense = hybrid_search(db, body.question, k=12)
    stages.append({"stage": "Vector + keyword retrieval", "output": {"passages": len(dense)}, "ms": int((time.time() - t) * 1000)})
    t = time.time()
    g = neighbourhood(db, [e.key for e in ents], depth=1, limit=80) if ents else {"nodes": [], "edges": []}
    graph_docs = {n["ref_id"] for n in g["nodes"] if n["type"] == "document" and n["ref_id"]}
    graph_hits = hybrid_search(db, body.question, k=8, doc_filter=graph_docs) if graph_docs else []
    stages.append({"stage": "Graph retrieval", "output": {"nodes": len(g["nodes"]), "edges": len(g["edges"]), "graph_documents": len(graph_docs), "passages": len(graph_hits)},
                   "ms": int((time.time() - t) * 1000)})
    t = time.time()
    fused = {}
    for rank, h in enumerate(dense):
        fused[h.chunk_id] = {"hit": h, "score": 1 / (60 + rank), "sources": ["vector+keyword"]}
    for rank, h in enumerate(graph_hits):
        f = fused.setdefault(h.chunk_id, {"hit": h, "score": 0, "sources": []})
        f["score"] += 1 / (60 + rank)
        f["sources"].append("graph")
    for f in fused.values():
        if f["hit"].document_id in graph_docs and "graph" not in f["sources"]:
            f["score"] += 0.004
            f["sources"].append("graph-linked document")
    ranked = sorted(fused.values(), key=lambda f: -f["score"])[:10]
    evidence = []
    for f in ranked:
        h = f["hit"]
        s = best_sentences(h, terms, n=1)
        evidence.append({"chunk_id": h.chunk_id, "document_id": h.document_id, "filename": h.filename, "page": h.page, "sheet": h.sheet,
                         "excerpt": s[0] if s else h.text[:300], "sources": f["sources"], "vector_score": h.vector_score, "doc_kind": h.doc_kind})
    stages.append({"stage": "Evidence fusion", "output": {"fused_passages": len(evidence), "from_graph": sum(1 for f in ranked if any("graph" in s for s in f["sources"]))},
                   "ms": int((time.time() - t) * 1000)})
    strength = evidence_strength([f["hit"] for f in ranked], terms)
    stages.append({"stage": "Evidence evaluation", "output": strength, "ms": 0})
    t = time.time()
    doc_ids = list(dict.fromkeys(e["document_id"] for e in evidence))
    ans = answer_question(db, body.question, {"document_ids": doc_ids} if doc_ids else {}) if doc_ids else None
    stages.append({"stage": "Grounded answer", "output": {"citations": len(ans["citations"]) if ans else 0}, "ms": int((time.time() - t) * 1000)})
    return {"question": body.question, "stages": stages, "entities": [entity_dict(e) for e in ents], "graph": g,
            "evidence": evidence, "strength": strength,
            "answer": ans["answer"] if ans else f"**{INSUFFICIENT_MSG}**", "citations": ans["citations"] if ans else [],
            "limitations": (ans or {}).get("limitations", []) + ["Graph relationships derived from text matching show that a document mentions an entity; they do not prove a physical or causal relationship."],
            "labels": (ans or {}).get("labels", [])}


# ---------------- Investigations ----------------
def _inv_dict(i: Investigation, db, full=False):
    d = {"id": i.id, "code": i.code, "ticket_id": i.ticket_id, "ticket_code": i.ticket.ticket_code if i.ticket else None,
         "question": i.question, "status": i.status, "sufficiency": i.sufficiency, "summary": i.summary,
         "created_by": user_brief(db.get(User, i.created_by)) if i.created_by else None, "created_at": iso(i.created_at),
         "completed_at": iso(i.completed_at), "risk_level": (i.state or {}).get("risk", {}).get("level") if i.state else None}
    if full:
        from .tickets import _solution_dict
        d["trace"] = i.trace
        d["state"] = i.state
        d["stages"] = STAGES
        d["solutions"] = [_solution_dict(s, db) for s in db.scalars(select(SolutionProposal).where(SolutionProposal.investigation_id == i.id))]
        d["evidence"] = [{"id": e.id, "kind": e.kind, "provenance": e.provenance, "label": e.label, "excerpt": e.excerpt, "document_id": e.document_id,
                          "chunk_id": e.chunk_id, "page": e.page, "score": e.score, "ref": e.ref} for e in db.scalars(select(Evidence).where(Evidence.investigation_id == i.id))]
    return d


@router.get("/investigations")
def investigations(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    return [_inv_dict(i, db) for i in db.scalars(select(Investigation).order_by(Investigation.id.desc()).limit(200))]


class InvIn(BaseModel):
    ticket_id: int | None = None
    question: str | None = Field(default=None, max_length=4000)


@router.post("/investigations")
def start_investigation(body: InvIn, user: User = Depends(require_perm("investigation:run")), db: Session = Depends(get_db)):
    if not body.ticket_id and not (body.question and body.question.strip()):
        raise HTTPException(422, "Provide a ticket or a question to investigate")
    ticket = db.get(Ticket, body.ticket_id) if body.ticket_id else None
    if body.ticket_id and not ticket:
        raise HTTPException(404, "Ticket not found")
    question = body.question or ticket.complaint.description
    inv = Investigation(code=new_code(db, Investigation, "code", "INV", 6), ticket_id=ticket.id if ticket else None,
                        question=question, status="RUNNING", created_by=user.id)
    db.add(inv)
    db.flush()
    run_investigation(db, inv)
    if ticket:
        add_event(db, ticket, user, "AI_INVESTIGATION", inv.summary, investigation_id=inv.id, investigation_code=inv.code)
    audit(db, user, "investigation.run", "investigation", inv.code, ticket=ticket.ticket_code if ticket else None)
    db.flush()
    sync_records(db, investigation=inv)
    db.commit()
    return _inv_dict(inv, db, full=True)


@router.get("/investigations/{inv_id}")
def investigation(inv_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    i = db.get(Investigation, inv_id)
    if not i:
        raise HTTPException(404, "Investigation not found")
    return _inv_dict(i, db, full=True)


# ---------------- Risk intelligence ----------------
_risk_cache = {"t": 0, "docs": None}


def _documented_risk_themes(db):
    if _risk_cache["docs"] is not None and time.time() - _risk_cache["t"] < 600:
        return _risk_cache["docs"]
    themes = []
    for key, (label, _) in TOPICS.items():
        hits = hybrid_search(db, f"{label} risk hazard failure safety deficiency", k=4, per_doc_cap=1)
        ev = []
        for h in hits:
            s = best_sentences(h, content_terms(label) + ["risk", "hazard", "safety", "failure"], RISK_CUES, n=1, min_score=0.5)
            if s and (h.vector_score or 0) >= 0.6:
                ev.append({"document_id": h.document_id, "filename": h.filename, "page": h.page, "excerpt": s[0], "doc_kind": h.doc_kind, "chunk_id": h.chunk_id})
        if ev:
            themes.append({"topic": key, "label": label, "evidence": ev[:3], "provenance": "DOCUMENTED"})
    _risk_cache.update(t=time.time(), docs=themes)
    return themes


@router.get("/risk/signals")
def risk_signals(days: int = 90, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    since = utcnow() - timedelta(days=days)
    clusters = defaultdict(list)
    for c in db.scalars(select(Complaint).where(Complaint.created_at >= since)):
        clusters[(c.station_id, c.category)].append(c)
    signals = []
    for (sid, cat), cs in clusters.items():
        st = db.get(Station, sid)
        open_ = [c for c in cs if c.ticket and c.ticket.status not in ("RESOLVED", "CLOSED")]
        reopened = sum(c.ticket.reopen_count for c in cs if c.ticket)
        recent = [c for c in cs if c.created_at >= utcnow() - timedelta(days=30)]
        score = min(1.0, 0.15 * len(recent) + 0.05 * len(cs) + 0.2 * min(reopened, 2) + (0.3 if cat == "safety" else 0) + (0.1 if cat in ("lifts_escalators", "accessibility") else 0))
        if len(cs) < 2 and cat != "safety" and reopened == 0:
            continue
        level = "HIGH" if score >= 0.6 else "MEDIUM" if score >= 0.3 else "LOW"
        gaps = ["No equipment telemetry or maintenance logs connected"]
        if not any(c.ticket and c.ticket.status in ("ASSIGNED", "IN_PROGRESS", "AWAITING_VERIFICATION", "RESOLVED", "CLOSED") for c in cs):
            gaps.append("No ticket in this cluster has progressed beyond triage")
        why = [f"{len(cs)} complaint(s) in {days} days ({len(recent)} in last 30 days)"]
        if reopened:
            why.append(f"{reopened} reopen event(s) — previous action did not resolve the issue")
        if cat == "safety":
            why.append("Safety-related reports warrant prompt human assessment")
        signals.append({"kind": "COMPLAINT_CLUSTER", "station": station_brief(st), "category": cat,
                        "category_label": COMPLAINT_CATEGORIES[cat]["en"], "level": level, "score": round(score, 2),
                        "complaints": len(cs), "recent_30d": len(recent), "open_tickets": len(open_), "reopens": reopened,
                        "why": why, "gaps": gaps, "provenance": "POTENTIAL",
                        "next_steps": ["Run an agentic investigation on the most recent ticket", "Request an engineer field inspection",
                                       "Check whether a verified resolution exists in resolution memory"],
                        "ticket_ids": [c.ticket.id for c in cs if c.ticket][:10],
                        "caveat": "Repeated complaints raise investigative priority; they do not by themselves prove an asset failure."})
    signals.sort(key=lambda s: -s["score"])
    assessments = [{"id": r.id, "investigation_id": r.investigation_id, "ticket_id": r.ticket_id, "level": r.level, "score": r.score,
                    "category": r.category, "station": station_brief(db.get(Station, r.station_id)) if r.station_id else None,
                    "rationale": r.rationale, "factors": r.factors, "gaps": r.gaps, "provenance": r.provenance, "created_at": iso(r.created_at)}
                   for r in db.scalars(select(RiskAssessment).order_by(RiskAssessment.id.desc()).limit(50))]
    return {"window_days": days, "signals": signals, "assessments": assessments, "documented_themes": _documented_risk_themes(db),
            "method": "Transparent rules over real complaint records and retrieved document passages. No predictive model is used; no predictive accuracy is claimed."}


# ---------------- Resolution memory ----------------
@router.get("/resolution-memory")
def resolution_memory(outcome: str | None = None, category: str | None = None, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    q = select(ResolutionMemory)
    if outcome:
        q = q.where(ResolutionMemory.outcome == outcome)
    if category:
        q = q.where(ResolutionMemory.category == category)
    out = []
    for m in db.scalars(q.order_by(ResolutionMemory.id.desc())):
        t = db.get(Ticket, m.ticket_id)
        out.append({"id": m.id, "ticket_id": m.ticket_id, "ticket_code": t.ticket_code if t else None, "category": m.category,
                    "category_label": COMPLAINT_CATEGORIES.get(m.category, {}).get("en"), "station": station_brief(db.get(Station, m.station_id)) if m.station_id else None,
                    "problem_summary": m.problem_summary, "findings": m.findings, "approved_action": m.approved_action,
                    "reviewer": user_brief(db.get(User, m.reviewer_id)) if m.reviewer_id else None, "outcome": m.outcome,
                    "evidence": m.evidence, "provenance": m.provenance, "created_at": iso(m.created_at)})
    counts = dict(db.execute(select(ResolutionMemory.outcome, func.count()).group_by(ResolutionMemory.outcome)).all())
    return {"items": out, "counts": counts}
