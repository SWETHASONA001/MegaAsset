"""Agentic investigation workflow (LangGraph StateGraph).

Stages (each a node with explicit inputs/outputs recorded in the trace):
  understand -> classify -> identify_entities -> find_similar_complaints -> retrieve_documents -> retrieve_graph -> analyze_operations
  -> assess_risk -> evaluate_evidence -> [recommend_solutions | insufficient_evidence] -> human_approval_gate

Nothing here performs physical actions or closes tickets. Proposed solutions wait for a supervisor's approval.
Classification and risk scoring are transparent rules (labelled AI_HYPOTHESIS / POTENTIAL), not trained models.
"""
from __future__ import annotations

import re
import time
import traceback
from datetime import timedelta
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (Asset, Complaint, EngineerFinding, Evidence, Investigation, MaintenanceRecord, ResolutionMemory,
                      RiskAssessment, SolutionProposal, Station, StationRidership, Ticket, utcnow)
from ..provenance import (AI_HYPOTHESIS, COMPLAINT_CATEGORIES, DOCUMENTED, INSUFFICIENT_MSG, POTENTIAL, PROCESSED,
                          REPORTED, VERIFIED)
from ..services.answer import RISK_CUES, best_sentences
from ..services.graph import identify_entities, neighbourhood
from ..services.retrieval import content_terms, hybrid_search

CATEGORY_KEYWORDS = {
    "lifts_escalators": ["lift", "elevator", "escalator", "stuck", "மின்தூக்கி", "லிஃப்ட்", "நகரும் படிக்கட்டு", "எஸ்கலேட்டர்"],
    "cleanliness": ["dirty", "garbage", "trash", "smell", "stink", "unclean", "litter", "spill", "toilet", "washroom", "clean",
                    "குப்பை", "அழுக்கு", "சுத்தம்", "கழிப்பறை", "நாற்றம்"],
    "accessibility": ["wheelchair", "ramp", "disabled", "elderly", "blind", "tactile", "differently abled", "divyang",
                      "சக்கர நாற்காலி", "மாற்றுத்திறனாளி"],
    "ticketing": ["ticket", "qr", "card", "recharge", "fare", "gate", "refund", "token", "ncmc", "tvm", "டிக்கெட்", "பயணச்சீட்டு", "கட்டணம்"],
    "station_facilities": ["water", "fan", "air condition", " ac ", "light", "seating", "signage", "drinking", "wifi", "display",
                           "தண்ணீர்", "விளக்கு", "மின்விசிறி"],
    "safety": ["unsafe", "fire", "smoke", "harass", "crowd", "fight", "injur", "slip", "fell", "danger", "security", "accident", "theft",
               "பாதுகாப்பு", "தீ", "ஆபத்து", "விபத்து"],
    "parking": ["parking", "vehicle", "bike", "two-wheeler", "two wheeler", "car park", "வாகன நிறுத்தம்", "பார்க்கிங்"],
}
TOPIC_QUERY = {
    "lifts_escalators": "lift escalator maintenance breakdown availability",
    "cleanliness": "housekeeping cleaning station cleanliness",
    "accessibility": "accessibility lift ramp differently abled passengers",
    "ticketing": "ticketing automatic fare collection QR card gates",
    "station_facilities": "station facilities passenger amenities",
    "safety": "safety audit hazard passenger safety",
    "parking": "parking tariff vehicle parking",
    "other": "passenger services",
}
ASSET_TYPES_FOR = {"lifts_escalators": ["lift", "escalator"], "accessibility": ["lift", "accessibility_ramp"]}


class InvState(TypedDict, total=False):
    investigation_id: int
    ticket_id: int | None
    question: str
    language: str
    keywords: list[str]
    selected_category: str | None
    classification: dict
    station: dict | None
    entities: list[dict]
    assets: list[dict]
    reported_asset: dict | None
    complaint_id: int | None
    similar: list[dict]
    documents: list[dict]
    graph: dict
    operations: dict
    risk: dict
    sufficiency: dict
    solutions: list[dict]
    evidence_refs: list[dict]
    errors: list[dict]
    trace: list[dict]
    status: str


def _db(config) -> Session:
    return config["configurable"]["db"]


def stage(name: str):
    """Wraps a node: records timing, outputs summary and errors; a failing stage does not crash the workflow."""
    def deco(fn):
        def run(state: InvState, config):
            t0 = time.time()
            entry = {"stage": name, "started_at": utcnow().isoformat()}
            try:
                out = fn(state, config) or {}
                entry.update(status="ok", summary=out.pop("_summary", ""), outputs=out.pop("_outputs", {}))
            except Exception as exc:
                out = {}
                entry.update(status="error", summary=f"{type(exc).__name__}: {exc}", outputs={})
                out["errors"] = (state.get("errors") or []) + [{"stage": name, "error": str(exc), "trace": traceback.format_exc()[-1500:]}]
            entry["duration_ms"] = int((time.time() - t0) * 1000)
            out["trace"] = (state.get("trace") or []) + [entry]
            return out
        run.__name__ = name
        return run
    return deco


@stage("understand")
def understand(state: InvState, config):
    q = state["question"].strip()
    if not q:
        raise ValueError("Empty complaint/question text")
    tamil = bool(re.search(r"[஀-௿]", q))
    kws = content_terms(q)[:15]
    return {"language": "ta" if tamil else state.get("language", "en"), "keywords": kws,
            "_summary": f"{'Tamil' if tamil else 'English'} text, {len(q)} chars; keywords: {', '.join(kws[:8]) or '—'}",
            "_outputs": {"keywords": kws, "language": "ta" if tamil else "en"}}


@stage("classify")
def classify(state: InvState, config):
    text = f" {state['question'].lower()} "
    scores = {}
    for cat, kws in CATEGORY_KEYWORDS.items():
        matched = [k.strip() for k in kws if k in text]
        if matched:
            scores[cat] = matched
    ranked = sorted(scores.items(), key=lambda x: -len(x[1]))
    predicted = ranked[0][0] if ranked else "other"
    selected = state.get("selected_category")
    agrees = selected is None or selected == predicted or (not ranked)
    conf = "LOW" if not ranked else ("MEDIUM" if len(ranked[0][1]) == 1 else "HIGH")
    cls = {"predicted": predicted, "selected": selected, "matched_terms": dict(ranked), "confidence": conf,
           "agrees_with_selection": agrees, "provenance": AI_HYPOTHESIS,
           "method": "keyword rules (English + Tamil); transparent, not a trained model",
           "note": "The passenger-selected category is a report, not proof that an incident occurred."}
    effective = selected or predicted
    cls["effective"] = effective
    return {"classification": cls,
            "_summary": f"Predicted '{predicted}' ({conf} confidence); passenger selected '{selected or '—'}'" + ("" if agrees else " — mismatch flagged for review"),
            "_outputs": cls}


@stage("identify_entities")
def identify(state: InvState, config):
    db = _db(config)
    ents = identify_entities(db, state["question"])
    station = state.get("station")
    if station:
        key = f"station:{station['code']}"
        if not any(e.key == key for e in ents):
            from ..models import GraphEntity
            e = db.scalar(select(GraphEntity).where(GraphEntity.key == key))
            if e:
                ents.insert(0, e)
    elif any(e.type == "station" for e in ents):
        s = db.get(Station, next(e for e in ents if e.type == "station").ref_id)
        station = {"id": s.id, "code": s.code, "name": s.display_name, "source": "mentioned in text"}
    cat = state["classification"].get("effective")
    assets = []
    rep_asset = state.get("reported_asset")
    if rep_asset:
        assets.append({**rep_asset, "provenance": "REPORTED", "basis": "selected by the passenger (reported, not verified)"})
    if station and cat in ASSET_TYPES_FOR:
        for a in db.scalars(select(Asset).where(Asset.station_id == station["id"], Asset.asset_type.in_(ASSET_TYPES_FOR[cat]))):
            if not any(x["id"] == a.id for x in assets):
                assets.append({"id": a.id, "code": a.asset_code, "name": a.name, "type": a.asset_type, "source": a.source, "provenance": a.provenance})
    entities = [{"key": e.key, "type": e.type, "label": e.label, "provenance": e.provenance} for e in ents]
    return {"entities": entities, "station": station, "assets": assets,
            "_summary": f"{len(entities)} graph entities linked; station: {station['name'] if station else 'not identified'}; {len(assets)} documented candidate assets at station",
            "_outputs": {"entities": entities, "candidate_assets": len(assets),
                         "asset_note": "Candidate assets are access features documented in GTFS at the station; the specific unit involved is not identified from the complaint text." if assets else None}}


@stage("find_similar_complaints")
def find_similar(state: InvState, config):
    """Complaint similarity search: links repeated/similar reports (never merges them)."""
    db = _db(config)
    from ..models import Complaint
    from ..services.similarity import similar_complaints
    cid = state.get("complaint_id")
    if cid:
        c = db.get(Complaint, cid)
    else:  # free-form question: compare against stored complaints using a transient record
        c = Complaint(id=-1, description=state["question"], category=state["classification"].get("effective", "other"),
                      station_id=(state.get("station") or {}).get("id"))
    sims = similar_complaints(db, c, limit=8) if c else []
    if not cid:
        db.expunge(c) if c in db else None
    same = [x for x in sims if x["same_station"] and x["same_category"]]
    return {"similar": sims,
            "_summary": f"{len(sims)} similar complaints (cosine ≥ threshold); {len(same)} at the same station and category",
            "_outputs": {"similar": [{k: x[k] for k in ("complaint_code", "similarity", "relation", "status")} for x in sims],
                         "note": "Linked for context only; each complaint remains a separate record."}}


@stage("retrieve_documents")
def retrieve_documents(state: InvState, config):
    db = _db(config)
    cat = state["classification"].get("effective", "other")
    q = f"{state['question']} {TOPIC_QUERY.get(cat, '')}"
    if state.get("station"):
        q += f" {state['station']['name']}"
    hits = hybrid_search(db, q, k=8, per_doc_cap=2)
    terms = content_terms(q)
    docs = []
    for h in hits:
        sents = best_sentences(h, terms, n=1)
        if not sents:
            continue
        docs.append({"document_id": h.document_id, "chunk_id": h.chunk_id, "filename": h.filename, "title": h.title,
                     "page": h.page, "doc_kind": h.doc_kind, "category": h.category, "excerpt": sents[0],
                     "score": h.vector_score, "provenance": DOCUMENTED,
                     "relevance": "STRONG" if (h.vector_score or 0) >= 0.7 else "MODERATE" if (h.vector_score or 0) >= 0.62 else "WEAK"})
    return {"documents": docs,
            "_summary": f"{len(docs)} passages from {len({d['document_id'] for d in docs})} documents (hybrid BM25 + vector)",
            "_outputs": {"query": q, "passages": len(docs)}}


@stage("retrieve_graph")
def retrieve_graph(state: InvState, config):
    db = _db(config)
    keys = [e["key"] for e in state.get("entities", [])]
    if not keys:
        return {"graph": {"nodes": [], "edges": []}, "_summary": "No entities to expand"}
    g = neighbourhood(db, keys, depth=1, limit=60)
    docs = [n for n in g["nodes"] if n["type"] == "document"]
    comps = [n for n in g["nodes"] if n["type"] == "complaint"]
    return {"graph": g, "_summary": f"Expanded {len(keys)} entities → {len(g['nodes'])} nodes ({len(docs)} documents, {len(comps)} complaints), {len(g['edges'])} relationships",
            "_outputs": {"nodes": len(g["nodes"]), "edges": len(g["edges"])}}


@stage("analyze_operations")
def analyze_operations(state: InvState, config):
    db = _db(config)
    station = state.get("station")
    cat = state["classification"].get("effective")
    out: dict[str, Any] = {}
    now = utcnow()
    if station:
        q = select(func.count(Complaint.id)).where(Complaint.station_id == station["id"])
        out["station_complaints_30d"] = db.scalar(q.where(Complaint.created_at >= now - timedelta(days=30))) or 0
        out["same_category_30d"] = db.scalar(q.where(Complaint.category == cat, Complaint.created_at >= now - timedelta(days=30))) or 0
        out["same_category_90d"] = db.scalar(q.where(Complaint.category == cat, Complaint.created_at >= now - timedelta(days=90))) or 0
        rid = db.scalar(select(StationRidership).where(StationRidership.station_id == station["id"], StationRidership.is_partial.is_(False))
                        .order_by(StationRidership.service_date.desc()))
        if rid:
            out["ridership"] = {"date": rid.service_date, "passengers": rid.passengers, "provenance": DOCUMENTED,
                                "source": f"chennai_metro_phase1_ridership.xlsx, sheet 'Station simple', row {rid.source_row}"}
        mr = list(db.scalars(select(MaintenanceRecord).where(MaintenanceRecord.station_id == station["id"]).order_by(MaintenanceRecord.id.desc()).limit(5)))
        out["maintenance_records"] = [{"id": m.id, "work_type": m.work_type, "status": m.status, "description": m.description[:200]} for m in mr]
    findings_q = select(EngineerFinding).join(Ticket).join(Complaint).where(Complaint.category == cat)
    if station:
        findings_q = findings_q.where(Complaint.station_id == station["id"])
    out["related_findings"] = [{"ticket_id": f.ticket_id, "finding": f.finding[:240], "root_cause": f.root_cause}
                               for f in db.scalars(findings_q.order_by(EngineerFinding.id.desc()).limit(5))]
    mem_q = select(ResolutionMemory).where(ResolutionMemory.category == cat)
    mems = list(db.scalars(mem_q.order_by(ResolutionMemory.id.desc()).limit(10)))
    out["verified_resolutions"] = [{"id": m.id, "ticket_id": m.ticket_id, "action": m.approved_action, "station_match": bool(station and m.station_id == station["id"])}
                                   for m in mems if m.outcome == "VERIFIED_RESOLVED"]
    out["similar_complaints"] = len(state.get("similar", []))
    out["similar_same_station"] = sum(1 for x in state.get("similar", []) if x["same_station"])
    out["counterexamples"] = [{"id": m.id, "ticket_id": m.ticket_id, "action": m.approved_action, "station_match": bool(station and m.station_id == station["id"])}
                              for m in mems if m.outcome != "VERIFIED_RESOLVED"]
    procurement = [d for d in state.get("documents", []) if d["doc_kind"] in ("TENDER", "TENDER_AMENDMENT")]
    out["procurement_context"] = [{"filename": d["filename"], "page": d["page"]} for d in procurement]
    out["notes"] = ["Tender documents indicate procurement scope only; no completed-maintenance records are present in source documents."] if procurement else []
    out["telemetry"] = "No sensor/SCADA data source is connected; equipment condition cannot be observed directly."
    return {"operations": out,
            "_summary": f"{out.get('same_category_30d', 0)} same-category complaints at station (30d); {len(out['related_findings'])} related findings; "
                        f"{len(out['verified_resolutions'])} verified resolutions, {len(out['counterexamples'])} counterexamples in memory",
            "_outputs": {k: v for k, v in out.items() if k not in ("maintenance_records",)}}


@stage("assess_risk")
def assess_risk(state: InvState, config):
    ops = state.get("operations", {})
    cat = state["classification"].get("effective")
    factors, score = [], 0.0

    def add(name, weight, detail, prov):
        nonlocal score
        score += weight
        factors.append({"factor": name, "weight": round(weight, 2), "detail": detail, "provenance": prov})

    if cat == "safety":
        add("Safety-related report", 0.35, "Passenger reported a safety concern", REPORTED)
    if cat in ("lifts_escalators", "accessibility"):
        add("Accessibility impact", 0.15, "Lifts, escalators and ramps affect step-free access", PROCESSED)
    sim_same = ops.get("similar_same_station", 0)
    if sim_same >= 1:
        add("Similar reports at this station", min(0.2, 0.07 * sim_same), f"{sim_same} complaint(s) at this station read alike (similarity search)", PROCESSED)
    rep = ops.get("same_category_30d", 0)
    if rep >= 2:
        add("Repeated complaints", min(0.3, 0.08 * rep), f"{rep} complaints in this category at this station in 30 days", PROCESSED)
    rid = ops.get("ridership")
    if rid and rid["passengers"] >= 15000:
        add("High passenger exposure", 0.1, f"{rid['passengers']:,} passengers on {rid['date']} ({rid['source']})", DOCUMENTED)
    if ops.get("counterexamples"):
        add("Previous unsuccessful resolution", 0.15, f"{len(ops['counterexamples'])} reopened case(s) in this category", VERIFIED)
    risk_docs = [d for d in state.get("documents", []) if any(c in d["excerpt"].lower() for c in RISK_CUES)]
    if risk_docs:
        add("Documented risk context", 0.05, f"{len(risk_docs)} retrieved passages discuss related risks", DOCUMENTED)
    if state.get("ticket_id"):
        pass
    score = min(1.0, score)
    level = "HIGH" if score >= 0.5 else "MEDIUM" if score >= 0.25 else "LOW"
    gaps = []
    if not state.get("station"):
        gaps.append("Station not identified")
    if not state.get("assets") and cat in ASSET_TYPES_FOR:
        gaps.append("Specific asset not identified")
    gaps.append("No equipment telemetry or maintenance logs available")
    if not ops.get("related_findings"):
        gaps.append("No engineer findings recorded for related cases")
    if len(factors) == 0:
        level = "REQUIRES_REVIEW"
    rationale = (f"Potential {level.lower().replace('_', ' ')} investigative priority from {len(factors)} factor(s). "
                 "This is a transparent rules-based indication to guide investigation — not a prediction of failure "
                 "and not a measured probability. Repeated complaints raise priority but do not prove an asset fault.")
    return {"risk": {"level": level, "score": round(score, 2), "factors": factors, "gaps": gaps, "rationale": rationale, "provenance": POTENTIAL},
            "_summary": f"{level} (score {score:.2f}) from {len(factors)} factors", "_outputs": {"level": level, "score": round(score, 2)}}


@stage("evaluate_evidence")
def evaluate_evidence(state: InvState, config):
    docs = state.get("documents", [])
    strong = [d for d in docs if d["relevance"] in ("STRONG", "MODERATE")]
    checks = {
        "station_identified": bool(state.get("station")),
        "category_consistent": state["classification"].get("agrees_with_selection", True),
        "documentary_context": len(strong) > 0,
        "asset_candidates": bool(state.get("assets")) or state["classification"].get("effective") not in ASSET_TYPES_FOR,
        "engineer_findings": bool(state.get("operations", {}).get("related_findings")),
        "verified_precedent": bool(state.get("operations", {}).get("verified_resolutions")),
    }
    passed = sum(checks.values())
    if not checks["station_identified"] and not checks["documentary_context"]:
        level = "INSUFFICIENT_EVIDENCE"
    elif passed >= 5:
        level = "SUFFICIENT_FOR_RECOMMENDATION"
    elif passed >= 3:
        level = "PARTIAL"
    else:
        level = "INSUFFICIENT_EVIDENCE"
    root_cause = "No root cause can be confirmed: confirmation requires an engineer's field finding." if not checks["engineer_findings"] else \
        "Related engineer findings exist; they may inform but do not confirm the cause of this report."
    refs = [{"document_id": d["document_id"], "chunk_id": d["chunk_id"], "page": d["page"], "excerpt": d["excerpt"], "filename": d["filename"]} for d in strong]
    return {"sufficiency": {"level": level, "checks": checks, "root_cause": root_cause,
                            "message": INSUFFICIENT_MSG if level == "INSUFFICIENT_EVIDENCE" else None},
            "evidence_refs": refs,
            "_summary": f"{level.replace('_', ' ').title()} ({passed}/{len(checks)} checks)", "_outputs": {"checks": checks}}


def _solution(title, problem, rationale, evidence, benefits, risks, deps, missing, approval, verify):
    return {"title": title, "problem": problem, "rationale": rationale, "evidence": evidence, "benefits": benefits,
            "risks": risks, "dependencies": deps, "missing_info": missing, "approval_requirements": approval,
            "verification_criteria": verify}


@stage("recommend_solutions")
def recommend_solutions(state: InvState, config):
    cat = state["classification"].get("effective", "other")
    st = state.get("station") or {}
    sname = st.get("name", "the reported station")
    docs = state.get("documents", [])
    doc_ev = [{"type": "document", "provenance": DOCUMENTED, "document_id": d["document_id"], "chunk_id": d["chunk_id"],
               "filename": d["filename"], "page": d["page"], "excerpt": d["excerpt"], "doc_kind": d["doc_kind"]} for d in docs[:3]
              if d["relevance"] != "WEAK"]
    complaint_ev = [{"type": "complaint", "provenance": REPORTED, "excerpt": state["question"][:300]}]
    asset_ev = [{"type": "asset", "provenance": DOCUMENTED, "excerpt": a["name"], "source": a["source"]} for a in state.get("assets", [])[:6]]
    mem = state.get("operations", {}).get("verified_resolutions", [])
    mem_ev = [{"type": "resolution_memory", "provenance": VERIFIED, "excerpt": f"Ticket #{m['ticket_id']}: {m['action']}", "id": m["id"]} for m in mem[:3] if m.get("action")]
    std_approval = ["Supervisor approval in MegaAsset-Agentic before work is scheduled", "Responsible department sign-off"]
    std_missing = ["Exact location / unit within the station", "Maintenance log for the affected equipment"]
    sols = []
    if cat in ("lifts_escalators", "accessibility"):
        sols.append(_solution(
            f"Inspect the reported {'lift/escalator' if cat == 'lifts_escalators' else 'accessibility feature'} at {sname} and review its maintenance log",
            "Passenger report of an access-equipment problem; condition of the unit is unconfirmed.",
            "Field inspection is required to establish the actual condition before any repair decision.",
            complaint_ev + asset_ev + doc_ev, ["Establishes the actual condition and cause", "Produces an engineer finding for the record"],
            ["Unit may need to be taken out of service during inspection"],
            ["E&M / maintenance contractor availability", "Access to the unit's maintenance log"],
            std_missing + ["Fault codes or error history of the unit"], std_approval + ["E&M (lifts & escalators) section approval"],
            ["Engineer records inspection finding", "Unit observed operating normally after any repair", "Passenger confirms 'Issue Resolved'"]))
        if asset_ev:
            sols.append(_solution(
                f"Direct passengers to alternative documented step-free access at {sname} while the issue is investigated",
                "Possible loss of step-free access at the reported location.",
                f"GTFS records {len(state.get('assets', []))} lift/ramp/escalator access references at this station that may serve as alternatives (availability not verified).",
                asset_ev + complaint_ev, ["Reduces impact on passengers needing step-free access"],
                ["Alternative access may itself be unavailable — must be checked on site"], ["Station staff to confirm alternatives on site"],
                ["Current availability of alternative lifts/ramps"], std_approval[:1] + ["Station controller approval"],
                ["Station staff confirm alternative access is operational", "Signage/announcement in place"]))
    elif cat == "cleanliness":
        sols.append(_solution(f"Dispatch housekeeping to the reported location at {sname}", "Reported cleanliness issue.",
                              "Direct inspection and cleaning addresses the report; repeated reports may indicate a schedule gap.",
                              complaint_ev + doc_ev, ["Addresses the reported condition"], ["None significant identified"],
                              ["Housekeeping staff availability"], ["Exact location within station"], std_approval[:1] + ["Station manager approval"],
                              ["Station staff confirm area cleaned", "Passenger confirms 'Issue Resolved'"]))
    elif cat == "ticketing":
        sols.append(_solution(f"Check AFC gate / ticket-vending / QR transaction records for the reported time at {sname}",
                              "Reported ticketing problem.", "Transaction logs are needed to confirm what happened and whether a refund is due.",
                              complaint_ev + doc_ev, ["Confirms facts before any refund or repair"], ["Logs may be held by an external vendor"],
                              ["AFC team access to transaction logs"], ["Date/time, ticket or card identifier"], std_approval[:1] + ["Ticketing & AFC approval"],
                              ["Transaction confirmed and outcome communicated to passenger"]))
    elif cat == "safety":
        sols.append(_solution(f"Immediate safety assessment by the station controller at {sname}",
                              "Reported safety concern (unverified).",
                              "Safety reports require prompt human assessment. This system does not take autonomous safety action.",
                              complaint_ev + doc_ev, ["Rapid human assessment of a possible hazard"], ["Report may lack precise location"],
                              ["Station controller and security staff"], ["Precise location, time and nature of hazard"],
                              ["Station controller decision", "Safety & Security department sign-off"] + std_approval[:1],
                              ["Controller records assessment outcome", "Any hazard made safe and recorded as an incident if confirmed"]))
    elif cat == "parking":
        sols.append(_solution(f"Verify the parking issue at {sname} against the published parking tariff and operator records",
                              "Reported parking issue.", "Published tariff documents can confirm the applicable charges and rules.",
                              complaint_ev + doc_ev, ["Objective check against published rules"], ["Operator records may be external"],
                              ["Parking operator cooperation"], ["Vehicle type, time, receipt"], std_approval[:1] + ["Parking management approval"],
                              ["Outcome communicated to passenger"]))
    else:
        sols.append(_solution(f"Station inspection of the reported facility issue at {sname}", "Reported station facility / other issue.",
                              "A site check is needed to understand the report.", complaint_ev + doc_ev, ["Clarifies the issue"], ["None significant identified"],
                              ["Station operations staff"], std_missing[:1], std_approval, ["Site check recorded", "Passenger confirms 'Issue Resolved'"]))
    if mem_ev:
        sols.append(_solution("Apply the action from a similar verified resolution (subject to engineering review)",
                              "Similar past cases were verified as resolved.",
                              "Resolution memory contains verified cases in the same category; similarity does not guarantee the same cause.",
                              mem_ev + complaint_ev, ["Reuses an approach that previously worked"], ["Root cause may differ from the past case"],
                              ["Engineering review of the past case"], ["Confirmation that the cause matches"], std_approval,
                              ["Same verification criteria as the original case", "Passenger confirms 'Issue Resolved'"]))
    for s in sols:
        s["provenance"] = AI_HYPOTHESIS
        s["note"] = "Costs, timelines and feasibility are not established by the evidence and are not estimated."
    return {"solutions": sols, "_summary": f"{len(sols)} candidate solutions proposed (pending human approval)",
            "_outputs": {"titles": [s["title"] for s in sols]}}


@stage("insufficient_evidence")
def insufficient(state: InvState, config):
    sols = [_solution("Gather missing information before deciding on an action",
                      "Evidence is insufficient to recommend a corrective action.", INSUFFICIENT_MSG,
                      [{"type": "complaint", "provenance": REPORTED, "excerpt": state["question"][:300]}],
                      ["Avoids acting on an unsupported conclusion"], ["Delays action until information is gathered"],
                      ["Passenger or station staff to supply details"],
                      state.get("risk", {}).get("gaps", []), ["Operator review"], ["Missing information obtained and investigation re-run"])]
    sols[0]["provenance"] = AI_HYPOTHESIS
    return {"solutions": sols, "_summary": "Evidence insufficient — only an information-gathering step proposed"}


@stage("human_approval_gate")
def approval_gate(state: InvState, config):
    return {"status": "AWAITING_APPROVAL" if state.get("solutions") else "COMPLETED",
            "_summary": "Workflow paused: proposals require supervisor approval before any action. No ticket is closed automatically."}


def _route_after_eval(state: InvState) -> str:
    return "insufficient_evidence" if state.get("sufficiency", {}).get("level") == "INSUFFICIENT_EVIDENCE" else "recommend_solutions"


def build_workflow():
    g = StateGraph(InvState)
    for name, fn in [("understand", understand), ("classify", classify), ("identify_entities", identify),
                     ("find_similar_complaints", find_similar),
                     ("retrieve_documents", retrieve_documents), ("retrieve_graph", retrieve_graph),
                     ("analyze_operations", analyze_operations), ("assess_risk", assess_risk),
                     ("evaluate_evidence", evaluate_evidence), ("recommend_solutions", recommend_solutions),
                     ("insufficient_evidence", insufficient), ("human_approval_gate", approval_gate)]:
        g.add_node(name, fn)
    g.set_entry_point("understand")
    g.add_conditional_edges("understand", lambda s: END if s.get("errors") and not s.get("keywords") else "classify")
    seq = ["classify", "identify_entities", "find_similar_complaints", "retrieve_documents", "retrieve_graph", "analyze_operations", "assess_risk", "evaluate_evidence"]
    for a, b_ in zip(seq, seq[1:]):
        g.add_edge(a, b_)
    g.add_conditional_edges("evaluate_evidence", _route_after_eval, {"insufficient_evidence": "insufficient_evidence", "recommend_solutions": "recommend_solutions"})
    g.add_edge("recommend_solutions", "human_approval_gate")
    g.add_edge("insufficient_evidence", "human_approval_gate")
    g.add_edge("human_approval_gate", END)
    return g.compile()


WORKFLOW = build_workflow()
STAGES = ["understand", "classify", "identify_entities", "find_similar_complaints", "retrieve_documents", "retrieve_graph", "analyze_operations",
          "assess_risk", "evaluate_evidence", "recommend_solutions", "human_approval_gate"]


def run_investigation(db: Session, inv: Investigation) -> Investigation:
    initial: InvState = {"investigation_id": inv.id, "ticket_id": inv.ticket_id, "question": inv.question,
                         "errors": [], "trace": [], "selected_category": None, "station": None}
    if inv.ticket_id:
        t = db.get(Ticket, inv.ticket_id)
        c = t.complaint
        initial.update(complaint_id=c.id, reported_asset={"id": c.asset.id, "code": c.asset.asset_code, "name": c.asset.name,
                                                          "type": c.asset.asset_type, "source": c.asset.source} if c.asset else None)
        initial.update(selected_category=c.category, language=c.language,
                       station={"id": c.station.id, "code": c.station.code, "name": c.station.display_name, "source": "selected by passenger"})
    final = WORKFLOW.invoke(initial, config={"configurable": {"db": db}})
    inv.trace = final.get("trace", [])
    inv.sufficiency = final.get("sufficiency", {}).get("level")
    inv.status = "FAILED" if final.get("errors") and not final.get("solutions") else final.get("status", "COMPLETED")
    inv.completed_at = utcnow()
    keep = {k: final.get(k) for k in ("classification", "station", "entities", "assets", "similar", "documents", "operations", "risk",
                                       "sufficiency", "evidence_refs", "errors", "language", "keywords")}
    keep["graph_summary"] = {"nodes": len(final.get("graph", {}).get("nodes", [])), "edges": len(final.get("graph", {}).get("edges", []))}
    keep["graph"] = final.get("graph", {})
    inv.state = keep
    # Persist evidence, risk assessment and proposals
    for d in final.get("documents", []):
        db.add(Evidence(investigation_id=inv.id, kind="DOCUMENT", provenance=DOCUMENTED, label=f"{d['filename']} p.{d['page']}",
                        excerpt=d["excerpt"], document_id=d["document_id"], chunk_id=d["chunk_id"], page=d["page"], score=d["score"],
                        supports="CONTEXT", ref={"relevance": d["relevance"], "doc_kind": d["doc_kind"]}))
    for a in final.get("assets", []):
        db.add(Evidence(investigation_id=inv.id, kind="DATASET", provenance=DOCUMENTED, label=a["name"], excerpt=a["source"], ref=a))
    risk = final.get("risk")
    if risk:
        db.add(RiskAssessment(investigation_id=inv.id, ticket_id=inv.ticket_id, station_id=(final.get("station") or {}).get("id"),
                              category=final.get("classification", {}).get("effective"), level=risk["level"], score=risk["score"],
                              factors=risk["factors"], rationale=risk["rationale"], gaps=risk["gaps"], provenance=POTENTIAL))
    for s in final.get("solutions", []):
        db.add(SolutionProposal(investigation_id=inv.id, ticket_id=inv.ticket_id, title=s["title"][:255], problem=s["problem"],
                                rationale=s["rationale"], evidence=s["evidence"], benefits=s["benefits"], risks=s["risks"],
                                dependencies=s["dependencies"], missing_info=s["missing_info"],
                                approval_requirements=s["approval_requirements"], verification_criteria=s["verification_criteria"],
                                status="PROPOSED", provenance=AI_HYPOTHESIS))
    ok = sum(1 for t in inv.trace if t["status"] == "ok")
    inv.summary = (f"{ok}/{len(inv.trace)} stages completed. Classification: {final.get('classification', {}).get('effective', '—')}. "
                   f"Evidence: {(inv.sufficiency or '—').replace('_', ' ').lower()}. Risk: {(risk or {}).get('level', '—')}. "
                   f"{len(final.get('solutions', []))} proposal(s) awaiting human approval.")
    db.flush()
    return inv
