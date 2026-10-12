"""Knowledge graph construction and retrieval.

Every relationship records `method` (how it was derived) and `evidence` (traceable origins: dataset rows,
document chunks with page + excerpt, or database records). Text-derived edges are labelled PROCESSED — they show
that a document mentions an entity, not that a physical relationship exists.
"""
from __future__ import annotations

import re
from collections import defaultdict

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from ..models import (Asset, Complaint, Document, DocumentChunk, GraphEntity, GraphRelationship, Incident,
                      Investigation, ResolutionMemory, SolutionProposal, Station, Ticket)
from ..provenance import COMPLAINT_CATEGORIES
from .datasets import AMBIGUOUS, norm_name

TOPICS = {
    "lifts": ("Lifts / elevators", [r"\blifts?\b", r"\belevators?\b"]),
    "escalators": ("Escalators", [r"\bescalators?\b"]),
    "ups_battery": ("UPS & batteries", [r"\bups\b", r"\bbatter(y|ies)\b"]),
    "rolling_stock": ("Rolling stock", [r"\brolling stock\b", r"\btrain ?sets?\b"]),
    "signalling": ("Signalling & train control", [r"\bsignall?ing\b", r"\bcbtc\b"]),
    "power_traction": ("Traction & power supply", [r"\btraction\b", r"\bsub-?stations?\b", r"\bpower supply\b"]),
    "fire_safety": ("Fire safety", [r"\bfire (safety|alarm|detection|fighting|protection)\b"]),
    "structures": ("Civil structures & NDT", [r"\bstructural\b", r"\bnon[- ]destructive\b", r"\bndt\b", r"\bviaducts?\b"]),
    "parking": ("Parking", [r"\bparking\b"]),
    "environment": ("Environment & CRZ", [r"\bcrz\b", r"\bcoastal regulation\b", r"\benvironment(al)? (clearance|monitoring|statement)\b", r"\bair quality\b", r"\bnoise level"]),
    "accessibility": ("Accessibility", [r"\baccessib(le|ility)\b", r"\bdifferently[- ]abled\b", r"\bwheel ?chairs?\b", r"\bdivyang"]),
    "ticketing": ("Ticketing & AFC", [r"\bautomatic fare\b", r"\bafc\b", r"\bqr tickets?\b", r"\bsmart cards?\b", r"\bncmc\b"]),
    "safety_audit": ("Safety audit", [r"\bsafety audit\b", r"\bindependent safety\b"]),
    "cleanliness": ("Housekeeping & cleanliness", [r"\bhousekeeping\b", r"\bcleanliness\b", r"\bcleaning\b"]),
}
CATEGORY_TOPIC = {"cleanliness": "cleanliness", "lifts_escalators": "lifts", "accessibility": "accessibility",
                  "ticketing": "ticketing", "station_facilities": None, "safety": "safety_audit", "parking": "parking",
                  "other": None}
ASSET_TOPIC = {"lift": "lifts", "escalator": "escalators", "accessibility_ramp": "accessibility"}


class _Builder:
    def __init__(self, db: Session):
        self.db = db
        self.ent: dict[str, GraphEntity] = {e.key: e for e in db.scalars(select(GraphEntity))}
        self._edges: dict[tuple, GraphRelationship] = {}

    def entity(self, key, type_, label, provenance, ref_id=None, **props) -> GraphEntity:
        e = self.ent.get(key)
        if not e:
            e = GraphEntity(key=key, type=type_, label=label[:255], provenance=provenance, ref_id=ref_id, properties=props)
            self.db.add(e)
            self.db.flush()
            self.ent[key] = e
        else:
            e.label, e.provenance, e.ref_id, e.properties = label[:255], provenance, ref_id, props
        return e

    def edge(self, src: GraphEntity, dst: GraphEntity, type_, provenance, method, evidence, weight=1.0):
        key = (src.id, dst.id, type_)
        rel = self._edges.get(key) or self.db.scalar(select(GraphRelationship).where(
            GraphRelationship.source_id == src.id, GraphRelationship.target_id == dst.id, GraphRelationship.type == type_))
        if rel and key in self._edges:  # same edge seen again in this build: merge its evidence
            merged = list(rel.evidence or [])
            for ev in evidence:
                if ev not in merged:
                    merged.append(ev)
            rel.evidence, rel.weight = merged[:10], max(rel.weight or 1, len(merged), weight)
        elif rel:
            rel.provenance, rel.method, rel.evidence, rel.weight = provenance, method, evidence, weight
        else:
            rel = GraphRelationship(source_id=src.id, target_id=dst.id, type=type_, provenance=provenance,
                                    method=method, evidence=evidence, weight=weight)
            self.db.add(rel)
        self._edges[key] = rel


def _station_patterns(stations: list[Station]):
    pats = []
    for s in stations:
        for alias in s.aliases or []:
            if len(alias) < 3:
                continue
            esc = re.escape(alias).replace(r"\ ", r"[\s.]+")
            if alias in AMBIGUOUS or len(alias) <= 4:
                rx = re.compile(rf"\b{esc}\s+(metro|station)\b|\b(metro|station)\s+(at\s+)?{esc}\b", re.I)
            else:
                rx = re.compile(rf"\b{esc}\b", re.I)
            pats.append((s, rx))
    return pats


def _excerpt(text: str, m: re.Match, width=160) -> str:
    a = max(0, m.start() - width)
    b = min(len(text), m.end() + width)
    return ("…" if a else "") + re.sub(r"\s+", " ", text[a:b]).strip() + ("…" if b < len(text) else "")


def entity_for_complaint(b: _Builder, c: Complaint):
    st = b.ent.get(f"station:{c.station.code}") if c.station else None
    ce = b.entity(f"complaint:{c.complaint_code}", "complaint", f"{c.complaint_code} · {COMPLAINT_CATEGORIES.get(c.category, {}).get('en', c.category)}",
                  "REPORTED", c.id, category=c.category, created_at=c.created_at.isoformat())
    if st:
        b.edge(ce, st, "REPORTED_AT", "REPORTED", "complaint form: station selected by passenger",
               [{"kind": "record", "table": "complaints", "id": c.id, "code": c.complaint_code}])
    topic = CATEGORY_TOPIC.get(c.category)
    if topic and f"topic:{topic}" in b.ent:
        b.edge(ce, b.ent[f"topic:{topic}"], "CONCERNS", "REPORTED", "complaint category chosen by passenger (not proof of an incident)",
               [{"kind": "record", "table": "complaints", "id": c.id, "code": c.complaint_code}])
    if c.ticket:
        te = _ticket_entity(b, c.ticket)
        b.edge(te, ce, "TRACKS", "PROCESSED", "ticket created for complaint",
               [{"kind": "record", "table": "tickets", "id": c.ticket.id, "code": c.ticket.ticket_code}])
    if c.asset_id:
        ae = _asset_entity(b, c.asset)
        if ae:
            b.edge(ce, ae, "CONCERNS_ASSET", "REPORTED", "asset selected by the passenger in the complaint form (reported, not verified)",
                   [{"kind": "record", "table": "complaints", "id": c.id, "code": c.complaint_code, "asset": c.asset.asset_code}])
    # Similar earlier complaints: linked, never merged
    from .similarity import similar_complaints
    for sim in similar_complaints(b.db, c, limit=5, only_earlier=True):
        other = b.ent.get(f"complaint:{sim['complaint_code']}")
        if other:
            b.edge(ce, other, "RESEMBLES", "PROCESSED",
                   f"complaint text embedding cosine similarity {sim['similarity']:.2f} (threshold {sim['threshold']:.2f}); linked, not merged",
                   [{"kind": "similarity", "score": sim["similarity"], "same_station": sim["same_station"], "same_category": sim["same_category"],
                     "complaints": [c.complaint_code, sim["complaint_code"]]}], weight=round(sim["similarity"], 3))
    return ce


def _ticket_entity(b: _Builder, t: Ticket) -> GraphEntity:
    return b.entity(f"ticket:{t.ticket_code}", "ticket", f"{t.ticket_code} · {t.status.replace('_', ' ').title()}", "PROCESSED", t.id,
                    status=t.status, priority=t.priority, active=t.status not in ("RESOLVED", "CLOSED"),
                    created_at=t.created_at.isoformat() if t.created_at else None, station_id=t.complaint.station_id if t.complaint else None)


def _asset_entity(b: _Builder, a: Asset | None) -> GraphEntity | None:
    if not a:
        return None
    ae = b.ent.get(f"asset:{a.asset_code}")
    if not ae:
        ae = b.entity(f"asset:{a.asset_code}", "asset", a.name, a.provenance, a.id, asset_type=a.asset_type)
        if a.station and f"station:{a.station.code}" in b.ent:
            b.edge(ae, b.ent[f"station:{a.station.code}"], "LOCATED_AT", "DOCUMENTED", "GTFS entrance record (parent_station)",
                   [{"kind": "dataset", "dataset": "cmrl-gtfs", "source": a.source}])
    return ae


def _action_entity(b: _Builder, ws) -> GraphEntity:
    return b.entity(f"action:{ws.id}", "action", f"Approved action · {ws.action_taken[:60]}", "DOCUMENTED", ws.id,
                    status=ws.status, ticket_id=ws.ticket_id, solution=ws.solution[:300],
                    note="Engineer-recorded action approved by a supervisor; becomes a verified resolution only after confirmation.")


def build_graph(db: Session, progress=None) -> dict:
    # Full rebuild keeps the graph consistent with current sources.
    db.execute(delete(GraphRelationship))
    db.execute(delete(GraphEntity))
    db.commit()
    b = _Builder(db)
    stations = list(db.scalars(select(Station)))
    for key, (label, _) in TOPICS.items():
        b.entity(f"topic:{key}", "topic", label, "PROCESSED", None, description="Subject area used to connect documents, complaints and assets")
    lines = {}
    for s in stations:
        se = b.entity(f"station:{s.code}", "station", s.display_name, "DOCUMENTED", s.id, code=s.code, lat=s.lat, lon=s.lon)
        for ln in s.lines or []:
            le = lines.get(ln) or b.entity(f"line:{ln}", "line", ln, "DOCUMENTED", None, source="CMRL GTFS route colours")
            lines[ln] = le
            b.edge(se, le, "SERVED_BY", "DOCUMENTED", "GTFS stop_times → trips → routes (route_color)",
                   [{"kind": "dataset", "dataset": "cmrl-gtfs", "file": "stops.txt/stop_times.txt/routes.txt", "station_stop_id": s.gtfs_stop_id}])
    if progress:
        progress(1, 5, "Stations and lines")
    for a in db.scalars(select(Asset).where(Asset.asset_type.in_(["lift", "escalator", "accessibility_ramp"]))):
        st = b.ent.get(f"station:{a.station.code}") if a.station else None
        ae = b.entity(f"asset:{a.asset_code}", "asset", a.name, "DOCUMENTED", a.id, asset_type=a.asset_type)
        if st:
            b.edge(ae, st, "LOCATED_AT", "DOCUMENTED", "GTFS entrance record (parent_station)", [{"kind": "dataset", "dataset": "cmrl-gtfs", "source": a.source}])
        t = ASSET_TOPIC.get(a.asset_type)
        if t:
            b.edge(ae, b.ent[f"topic:{t}"], "INSTANCE_OF", "DOCUMENTED", "asset type", [{"kind": "record", "table": "assets", "id": a.id}])
    db.commit()
    if progress:
        progress(2, 5, "Assets")

    # Documents: mentions of stations, topics, corridors
    docs = list(db.scalars(select(Document).where(Document.status.in_(["INDEXED", "PARTIAL", "DUPLICATE"]))))
    spats = _station_patterns(stations)
    tpats = {k: [re.compile(p, re.I) for p in pats] for k, (_, pats) in TOPICS.items()}
    corr_rx = re.compile(r"\bcorridor[\s-]*(?:no\.?\s*)?([1-5]|I{1,3}|IV|V)\b", re.I)
    roman = {"I": "1", "II": "2", "III": "3", "IV": "4", "V": "5"}
    n_mentions = 0
    for d in docs:
        de = b.entity(f"document:{d.id}", "document", d.title, "DOCUMENTED", d.id, filename=d.filename, category=d.category,
                      doc_kind=d.doc_kind, status=d.status)
        if d.status == "DUPLICATE":
            continue
        st_hits, tp_hits, co_hits = defaultdict(list), defaultdict(list), defaultdict(list)
        for ch in db.scalars(select(DocumentChunk).where(DocumentChunk.document_id == d.id).order_by(DocumentChunk.chunk_index)):
            txt = ch.text
            for s, rx in spats:
                m = rx.search(txt)
                if m:
                    st_hits[s.code].append((ch, m))
            for k, rxs in tpats.items():
                for rx in rxs:
                    m = rx.search(txt)
                    if m:
                        tp_hits[k].append((ch, m))
                        break
            for m in corr_rx.finditer(txt):
                num = roman.get(m.group(1).upper(), m.group(1))
                co_hits[num].append((ch, m))
        small = d.chunk_count <= 6
        for code, hs in st_hits.items():
            ev = [{"kind": "chunk", "document_id": d.id, "chunk_id": ch.id, "page": ch.page_start, "excerpt": _excerpt(ch.text, m)} for ch, m in hs[:5]]
            b.edge(de, b.ent[f"station:{code}"], "MENTIONS", "PROCESSED", "station-name text match in document", ev, weight=len(hs))
            n_mentions += 1
        for k, hs in tp_hits.items():
            if len(hs) >= 2 or small:
                ev = [{"kind": "chunk", "document_id": d.id, "chunk_id": ch.id, "page": ch.page_start, "excerpt": _excerpt(ch.text, m)} for ch, m in hs[:5]]
                b.edge(de, b.ent[f"topic:{k}"], "DISCUSSES", "PROCESSED", "subject keyword match in document", ev, weight=len(hs))
                n_mentions += 1
        for num, hs in co_hits.items():
            ce = b.entity(f"corridor:{num}", "project", f"Corridor {num}", "DOCUMENTED", None,
                          description="Corridor referenced in CMRL documents")
            ev = [{"kind": "chunk", "document_id": d.id, "chunk_id": ch.id, "page": ch.page_start, "excerpt": _excerpt(ch.text, m)} for ch, m in hs[:5]]
            b.edge(de, ce, "REFERENCES", "PROCESSED", "corridor reference text match", ev, weight=len(hs))
    for d in docs:
        if d.duplicate_of_id and f"document:{d.duplicate_of_id}" in b.ent:
            b.edge(b.ent[f"document:{d.id}"], b.ent[f"document:{d.duplicate_of_id}"], "DUPLICATE_OF", "PROCESSED", "identical SHA-256 checksum",
                   [{"kind": "record", "table": "documents", "id": d.id, "checksum": d.checksum}])
    # Tender families: amendments in the same procurement folder
    fam = defaultdict(list)
    for d in docs:
        folder = (d.meta or {}).get("folder")
        if d.doc_kind in ("TENDER", "TENDER_AMENDMENT") and folder in ("lift_escalator", "ups_battery"):
            fam[folder].append(d)
    for folder, ds in fam.items():
        base = next((x for x in ds if x.doc_kind == "TENDER"), None)
        for x in ds:
            if base and x.id != base.id and x.doc_kind == "TENDER_AMENDMENT":
                b.edge(b.ent[f"document:{x.id}"], b.ent[f"document:{base.id}"], "AMENDS", "PROCESSED",
                       "same procurement folder; filename marks addendum/corrigendum/pre-bid",
                       [{"kind": "file", "path": x.rel_path}, {"kind": "file", "path": base.rel_path}])
    db.commit()
    if progress:
        progress(3, 5, f"Documents ({n_mentions} mention edges)")

    # Operational records
    for c in db.scalars(select(Complaint)):
        entity_for_complaint(b, c)
    for inv in db.scalars(select(Investigation)):
        link_investigation(b, inv)
    from ..models import EngineerFinding, WorkSubmission
    for ws in db.scalars(select(WorkSubmission).where(WorkSubmission.status.in_(["APPROVED", "APPROVED_FAILED"]))):
        t = db.get(Ticket, ws.ticket_id)
        if t and f"ticket:{t.ticket_code}" in b.ent:
            link_action(b, t, ws)
    for f in db.scalars(select(EngineerFinding).where(EngineerFinding.asset_id.isnot(None))):
        t = db.get(Ticket, f.ticket_id)
        if t and f"ticket:{t.ticket_code}" in b.ent:
            ae = _asset_entity(b, db.get(Asset, f.asset_id))
            if ae:
                b.edge(b.ent[f"ticket:{t.ticket_code}"], ae, "CONCERNS_ASSET", "VERIFIED" if f.cause_verified or f.confirmed_incident else "DOCUMENTED",
                       f"engineer finding #{f.id}", [{"kind": "record", "table": "engineer_findings", "id": f.id}])
    for r in db.scalars(select(ResolutionMemory)):
        link_resolution(b, r)
    for i in db.scalars(select(Incident)):
        ie = b.entity(f"incident:{i.code}", "incident", f"{i.code} · {i.title}", i.provenance, i.id, severity=i.severity)
        st = db.get(Station, i.station_id) if i.station_id else None
        if st:
            b.edge(ie, b.ent[f"station:{st.code}"], "OCCURRED_AT", i.provenance, "engineer-confirmed incident record", [{"kind": "record", "table": "incidents", "id": i.id}])
    db.commit()
    if progress:
        progress(5, 5, "Graph built")
    ents = db.query(GraphEntity).count()
    rels = db.query(GraphRelationship).count()
    return {"entities": ents, "relationships": rels}


def link_investigation(b: _Builder, inv: Investigation):
    ie = b.entity(f"investigation:{inv.code}", "investigation", f"{inv.code}", "AI_HYPOTHESIS", inv.id, status=inv.status)
    if inv.ticket and f"ticket:{inv.ticket.ticket_code}" in b.ent:
        b.edge(ie, b.ent[f"ticket:{inv.ticket.ticket_code}"], "INVESTIGATES", "PROCESSED", "investigation started for ticket",
               [{"kind": "record", "table": "investigations", "id": inv.id}])
    for ev in (inv.state or {}).get("evidence_refs", [])[:12]:
        key = f"document:{ev['document_id']}"
        if key in b.ent:
            b.edge(ie, b.ent[key], "CITES", "PROCESSED", "evidence retrieved by investigation",
                   [{"kind": "chunk", "document_id": ev["document_id"], "chunk_id": ev.get("chunk_id"), "page": ev.get("page"), "excerpt": ev.get("excerpt", "")[:300]}])
    for sp in b.db.scalars(select(SolutionProposal).where(SolutionProposal.investigation_id == inv.id)):
        se = b.entity(f"solution:{sp.id}", "solution", sp.title, sp.provenance if sp.status != "APPROVED" else "VERIFIED", sp.id, status=sp.status)
        b.edge(se, ie, "PROPOSED_BY", sp.provenance, "solution engine output", [{"kind": "record", "table": "solution_proposals", "id": sp.id}])


def link_resolution(b: _Builder, r: ResolutionMemory):
    re_ = b.entity(f"resolution:{r.id}", "resolution", f"Resolution #{r.id} · {r.outcome.replace('_', ' ').title()}", r.provenance, r.id, outcome=r.outcome)
    t = b.db.get(Ticket, r.ticket_id)
    if t and f"ticket:{t.ticket_code}" in b.ent:
        b.edge(re_, b.ent[f"ticket:{t.ticket_code}"], "RESOLVES" if r.outcome == "VERIFIED_RESOLVED" else "FAILED_FOR",
               r.provenance, "passenger/staff verification record", [{"kind": "record", "table": "resolution_memory", "id": r.id}])
    if r.solution_id and f"solution:{r.solution_id}" in b.ent:
        b.edge(re_, b.ent[f"solution:{r.solution_id}"], "APPLIED", r.provenance, "approved solution applied", [{"kind": "record", "table": "resolution_memory", "id": r.id}])
    from ..models import WorkSubmission
    ws = b.db.scalar(select(WorkSubmission).where(WorkSubmission.ticket_id == r.ticket_id, WorkSubmission.status.in_(["APPROVED", "APPROVED_FAILED"]))
                     .order_by(WorkSubmission.id.desc()))
    if ws:
        b.edge(re_, _action_entity(b, ws), "FOLLOWS", r.provenance, "resolution follows the supervisor-approved engineer action",
               [{"kind": "record", "table": "work_submissions", "id": ws.id}, {"kind": "record", "table": "resolution_memory", "id": r.id}])


def link_action(b: _Builder, t: Ticket, ws):
    ae = _action_entity(b, ws)
    b.edge(_ticket_entity(b, t), ae, "RECORDS_ACTION", "DOCUMENTED", "engineer work submission approved by supervisor",
           [{"kind": "record", "table": "work_submissions", "id": ws.id, "reviewer_id": ws.reviewer_id}])
    if ws.asset_id:
        asset_e = _asset_entity(b, b.db.get(Asset, ws.asset_id))
        if asset_e:
            b.edge(ae, asset_e, "PERFORMED_ON", "DOCUMENTED", "asset recorded by engineer in work submission",
                   [{"kind": "record", "table": "work_submissions", "id": ws.id}])


def sync_records(db: Session, complaint: Complaint | None = None, investigation: Investigation | None = None,
                 resolution: ResolutionMemory | None = None):
    """Incremental update after operational events (no full rebuild)."""
    b = _Builder(db)
    if not b.ent:
        return
    if complaint:
        entity_for_complaint(b, complaint)
    if investigation:
        link_investigation(b, investigation)
    if resolution:
        link_resolution(b, resolution)
    db.flush()


def update_ticket_entity(db: Session, ticket: Ticket):
    """Keep the ticket node's status/priority in step with the ticket after each transition."""
    e = db.scalar(select(GraphEntity).where(GraphEntity.key == f"ticket:{ticket.ticket_code}"))
    if e:
        e.label = f"{ticket.ticket_code} · {ticket.status.replace('_', ' ').title()}"
        e.properties = {**(e.properties or {}), "status": ticket.status, "priority": ticket.priority,
                        "active": ticket.status not in ("RESOLVED", "CLOSED")}


def sync_action(db: Session, ticket: Ticket, ws):
    b = _Builder(db)
    if b.ent and f"ticket:{ticket.ticket_code}" in b.ent:
        link_action(b, ticket, ws)
        db.flush()


def sync_ticket_asset(db: Session, ticket: Ticket, asset: Asset, provenance: str, method: str):
    b = _Builder(db)
    if b.ent and f"ticket:{ticket.ticket_code}" in b.ent:
        ae = _asset_entity(b, asset)
        if ae:
            b.edge(b.ent[f"ticket:{ticket.ticket_code}"], ae, "CONCERNS_ASSET", provenance, method,
                   [{"kind": "record", "table": "tickets", "id": ticket.id, "asset": asset.asset_code}])
            db.flush()


# ---------- retrieval ----------
def entity_dict(e: GraphEntity, degree: int | None = None) -> dict:
    return {"id": e.id, "key": e.key, "type": e.type, "label": e.label, "provenance": e.provenance,
            "ref_id": e.ref_id, "properties": e.properties, "degree": degree}


def rel_dict(r: GraphRelationship) -> dict:
    return {"id": r.id, "source": r.source_id, "target": r.target_id, "type": r.type, "provenance": r.provenance,
            "method": r.method, "weight": r.weight, "evidence": r.evidence}


def neighbourhood(db: Session, keys: list[str], depth: int = 1, limit: int = 200, types: list[str] | None = None) -> dict:
    seeds = list(db.scalars(select(GraphEntity).where(GraphEntity.key.in_(keys))))
    nodes = {e.id: e for e in seeds}
    rels = {}
    frontier = set(nodes)
    for _ in range(depth):
        if not frontier or len(nodes) >= limit:
            break
        q = select(GraphRelationship).where(or_(GraphRelationship.source_id.in_(frontier), GraphRelationship.target_id.in_(frontier)))
        new = set()
        for r in db.scalars(q.order_by(GraphRelationship.weight.desc())):
            other = r.target_id if r.source_id in frontier else r.source_id
            if other not in nodes:
                if len(nodes) >= limit:
                    continue
                e = db.get(GraphEntity, other)
                if types and e.type not in types:
                    continue
                nodes[other] = e
                new.add(other)
            rels[r.id] = r
        frontier = new
    rels = {k: r for k, r in rels.items() if r.source_id in nodes and r.target_id in nodes}
    return {"nodes": [entity_dict(e) for e in nodes.values()], "edges": [rel_dict(r) for r in rels.values()]}


def identify_entities(db: Session, text: str) -> list[GraphEntity]:
    """Entity linking for Graph-RAG: station names/aliases and subject topics found in free text."""
    found = []
    stations = list(db.scalars(select(Station)))
    up = norm_name(text)
    for s in stations:
        for a in s.aliases or []:
            if len(a) >= 3 and re.search(rf"\b{re.escape(a)}\b", up):
                e = db.scalar(select(GraphEntity).where(GraphEntity.key == f"station:{s.code}"))
                if e and e not in found:
                    found.append(e)
                break
    for k, (_, pats) in TOPICS.items():
        if any(re.search(p, text, re.I) for p in pats):
            e = db.scalar(select(GraphEntity).where(GraphEntity.key == f"topic:{k}"))
            if e and e not in found:
                found.append(e)
    return found
