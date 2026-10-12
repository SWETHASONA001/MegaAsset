"""Evidence-grounded question answering over the indexed collection.

Pipeline: query understanding (intent + follow-up rewriting + scope) -> hybrid retrieval (expanded for broad
questions) -> evidence evaluation -> synthesis (extractive by default, local LLM if configured) -> citation
validation -> limitations. Every statement in an extractive answer is a quotation from a cited passage.
"""
from __future__ import annotations

import re
from collections import OrderedDict, defaultdict

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (Document, EngineerFinding, Incident, MaintenanceRecord, ResolutionMemory, Station)
from ..provenance import AI_HYPOTHESIS, DOCUMENTED, INSUFFICIENT_MSG, PROCESSED, VERIFIED
from .retrieval import Hit, content_terms, expand_query, hybrid_search, resolve_doc_filter

INTENT_PATTERNS = [
    ("changes", r"\b(what|which)\b.*\b(chang\w*|revis\w*|modif\w*)\b|\b(addend\w*|addenda|corrigend\w*|amendments?)\b|\bcompare\b.*\b(original|addend\w*|corrigend\w*)\b"),
    ("conflict", r"\b(conflict\w*|contradict\w*|inconsisten\w*|disagree\w*|discrepanc\w*)\b"),
    ("compare", r"\b(compare|comparison|difference|differ|versus|vs\.?|contrast)\b"),
    ("gaps", r"\b(missing|gaps?|lacking|before we can confirm|what else do we need|unknown)\b"),
    ("actions", r"\b(suggest|corrective|recommend\w*|remed\w*|mitigat\w*|what should|actions?|fix)\b"),
    ("resolution", r"\b(previous|past|prior|similar)\b.*\b(resolution|resolved|case|complaint)s?\b"),
    ("risk", r"\b(risks?|hazards?|threats?|vulnerab\w*|danger\w*)\b"),
    ("locate", r"\b(which|what)\s+(documents?|files?|pages?|reports?|tenders?)\b|\bwhere\b.*\bmention"),
    ("summary", r"\b(summar\w*|overview|main|key (findings|points)|highlights?|across)\b"),
]
RISK_CUES = {"risk", "risks", "hazard", "safety", "failure", "failures", "delay", "delays", "damage", "accident",
             "fire", "flood", "flooding", "breakdown", "defect", "defects", "non-compliance", "violation", "penalty",
             "shortfall", "loss", "losses", "critical", "emergency", "deterioration", "crack", "cracks", "corrosion",
             "leakage", "incident", "incidents", "unsafe", "vulnerable", "exceed", "exceeded", "obsolete", "outage"}
ACTION_CUES = {"shall", "should", "must", "recommended", "recommend", "inspection", "inspect", "maintenance",
               "replace", "replacement", "repair", "monitor", "monitoring", "rectify", "rectification", "preventive",
               "corrective", "upgrade", "overhaul", "testing", "audit", "comply", "ensure", "measures"}
FOLLOWUP_RE = re.compile(r"^(and|also|what about|how about|those|these|them|it|that|this|their|its|same|more|why|"
                         r"which pages|where|compare them|elaborate|explain|go on)\b", re.I)
ANAPHORA_RE = re.compile(r"\b(these|those|them|it|this|that|they|their|above|previous|same|the two|both)\b", re.I)


def detect_intent(q: str) -> str:
    ql = q.lower()
    for name, pat in INTENT_PATTERNS:
        if re.search(pat, ql):
            return name
    return "qa"


_sent_split = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\"'])|\n+")


def unwrap(text: str) -> str:
    """Re-join PDF line wraps: a newline inside a sentence (next line starts lowercase/digit, or the previous line
    is long and does not end in punctuation) becomes a space."""
    text = re.sub(r"-\n(?=[a-z])", "", text)
    text = re.sub(r"(?<![.!?:;])\n(?=[a-z0-9(,])", " ", text)
    text = re.sub(r"(?m)^(.{55,}[^.!?:;\n])\n(?=[A-Z])", r"\1 ", text)
    return text


def split_sentences(text: str) -> list[str]:
    out = []
    for s in _sent_split.split(unwrap(text)):
        s = re.sub(r"\s+", " ", s).strip(" -•·*")
        if 25 <= len(s) <= 600 and sum(ch.isalpha() for ch in s) > len(s) * 0.45:
            out.append(s)
    return out


def _sentence_score(s: str, terms: list[str], cues: set[str] | None) -> float:
    low = s.lower()
    words = set(re.findall(r"[a-z0-9\-]+", low))
    score = sum(1.0 for t in terms if t in low) / (len(terms) or 1)
    score += sum(0.6 for t in terms if any(ch.isdigit() for ch in t) and t in low)  # specific identifiers / dates
    if cues:
        score += 0.35 * min(3, len(words & cues))
    if re.search(r"\d", s):
        score += 0.05
    return score


def best_sentences(hit: Hit, terms, cues=None, n=2, min_score=0.0) -> list[str]:
    sents = split_sentences(hit.text) or [re.sub(r"\s+", " ", hit.text)[:400]]
    sents = [s if len(s) <= 420 else s[:417].rsplit(" ", 1)[0] + "…" for s in sents]
    if hit.sheet:  # tabular: rows are the unit
        rows = [ln for ln in hit.text.split("\n") if ln.startswith("Row ")]
        sents = rows or sents
    scored = sorted(((_sentence_score(s, terms, cues), i, s) for i, s in enumerate(sents)), key=lambda x: (-x[0], x[1]))
    chosen = [x for x in scored[:n] if x[0] >= min_score]
    return [s for _, _, s in sorted(chosen, key=lambda x: x[1])]


def _loc(h) -> str:
    if h.sheet:
        rows = f"rows {h.row_start}–{h.row_end}" if h.row_start != h.row_end else f"row {h.row_start}"
        return f"sheet '{h.sheet}', {rows}"
    if h.page:
        return f"p. {h.page}"
    return f"section '{h.heading}'" if h.heading else "document"


class CitationSet:
    def __init__(self):
        self.items: "OrderedDict[int, dict]" = OrderedDict()

    def cite(self, h: Hit, excerpt: str) -> int:
        if h.chunk_id in self.items:
            c = self.items[h.chunk_id]
            if excerpt not in c["excerpt"] and len(c["excerpt"]) < 700:
                c["excerpt"] += " … " + excerpt
            return c["n"]
        n = len(self.items) + 1
        self.items[h.chunk_id] = {
            "n": n, "chunk_id": h.chunk_id, "document_id": h.document_id, "title": h.title, "filename": h.filename,
            "category": h.category, "doc_kind": h.doc_kind, "page": h.page, "heading": h.heading, "sheet": h.sheet,
            "row_start": h.row_start, "row_end": h.row_end, "location": _loc(h), "excerpt": excerpt,
            "ocr": h.ocr, "provenance": DOCUMENTED, "score": h.score, "vector_score": h.vector_score,
            "open_url": f"/api/documents/{h.document_id}/file" + (f"#page={h.page}" if h.page and not h.sheet else ""),
        }
        return n

    def validate(self, db: Session) -> list[dict]:
        """Every citation must point to an existing chunk whose text contains the quoted excerpt."""
        from ..models import DocumentChunk
        valid = []
        for c in self.items.values():
            ch = db.get(DocumentChunk, c["chunk_id"])
            if not ch:
                continue
            norm_chunk = re.sub(r"\s+", " ", ch.text)
            parts = [p for p in c["excerpt"].split(" … ") if p]
            c["verified"] = all(re.sub(r"\s+", " ", p)[:80] in norm_chunk for p in parts)
            if c["verified"]:
                valid.append(c)
        return valid


def evidence_strength(hits: list[Hit], terms: list[str]) -> dict:
    if not hits:
        return {"level": "NONE", "max_vector": 0.0, "term_coverage": 0.0, "documents": 0}
    max_vec = max((h.vector_score or 0) for h in hits)
    covered = {t for h in hits[:8] for t in h.matched_terms}
    coverage = len(covered) / (len(terms) or 1)
    docs = len({h.document_id for h in hits})
    max_rr = max((h.rerank_score for h in hits if h.rerank_score is not None), default=None)
    if (max_vec >= 0.72 and coverage >= 0.5) or (max_vec >= 0.66 and coverage >= 0.75):
        level = "STRONG"
    elif (max_vec >= 0.62 and coverage >= 0.34) or coverage >= 0.67:
        level = "MODERATE"
    elif max_vec >= 0.58 or coverage >= 0.34:
        level = "WEAK"
    else:
        level = "NONE"
    if max_rr is not None:
        if max_rr >= 4 and level == "WEAK" and coverage >= 0.34:
            level = "MODERATE"
        elif max_rr < -6 and level in ("MODERATE", "WEAK"):
            level = "WEAK" if level == "MODERATE" else "NONE"
    return {"level": level, "max_vector": round(max_vec, 3), "term_coverage": round(coverage, 2), "documents": docs,
            "max_rerank": max_rr}


def rewrite_followup(question: str, history: list[dict]) -> tuple[str, list[int], bool]:
    """Returns (standalone query, documents cited in the previous answer, is_followup)."""
    prev_user = next((m for m in reversed(history) if m["role"] == "user"), None)
    prev_asst = next((m for m in reversed(history) if m["role"] == "assistant"), None)
    if not prev_user:
        return question, [], False
    is_follow = bool(FOLLOWUP_RE.search(question.strip())) or (bool(ANAPHORA_RE.search(question)) and len(content_terms(question)) <= 4) \
        or len(content_terms(question)) <= 2
    if not is_follow:
        return question, [], False
    prev_terms = (prev_user.get("meta") or {}).get("standalone_query") or prev_user["content"]
    carry = [t for t in content_terms(prev_terms) if t not in content_terms(question)][:6]
    prev_docs = []
    if prev_asst:
        prev_docs = list(OrderedDict.fromkeys(c["document_id"] for c in (prev_asst.get("citations") or [])))
    return f"{question} {' '.join(carry)}".strip(), prev_docs, True


def _scope_description(db: Session, doc_filter: set[int] | None, total_indexed: int) -> str:
    if doc_filter is None:
        return f"Full indexed collection ({total_indexed} documents)"
    if len(doc_filter) == 1:
        d = db.get(Document, next(iter(doc_filter)))
        return f"Single document: {d.filename}" if d else "Single document"
    return f"Selected collection ({len(doc_filter)} documents)"


def _find_conflicts(hits: list[Hit], terms: list[str]) -> list[dict]:
    """Numeric statements about the same subject that differ across documents. Flags, never adjudicates."""
    num_re = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(%|km|kms|stations?|crores?|lakhs?|trains?|lifts?|escalators?|passengers?|nos?\.?|years?|months?|days?)\b", re.I)
    groups = defaultdict(list)
    for h in hits:
        for s in split_sentences(h.text):
            low = s.lower()
            subj = tuple(sorted(t for t in terms if t in low))
            if len(subj) < 1:
                continue
            for m in num_re.finditer(s):
                unit = m.group(2).lower().rstrip("s").rstrip(".")
                groups[(subj, unit)].append((m.group(1).replace(",", ""), h, s))
    conflicts = []
    for (subj, unit), vals in groups.items():
        by_doc = defaultdict(set)
        for v, h, s in vals:
            by_doc[h.document_id].add(v)
        if len(by_doc) < 2:
            continue
        distinct = {v for v, _, _ in vals}
        if len(distinct) < 2:
            continue
        # pick one statement per document
        seen, items = set(), []
        for v, h, s in vals:
            if h.document_id in seen:
                continue
            seen.add(h.document_id)
            items.append((v, h, s))
        if len({v for v, _, _ in items}) >= 2:
            conflicts.append({"subject": " ".join(subj), "unit": unit, "items": items[:4]})
    conflicts.sort(key=lambda c: -len(c["subject"]))
    return conflicts[:3]


def _caveats(hits: list[Hit]) -> list[str]:
    out = []
    kinds = {h.doc_kind for h in hits}
    if kinds & {"TENDER", "TENDER_AMENDMENT"}:
        out.append("Some evidence comes from tender/procurement documents. These describe intended scope of work and requirements — they are not records of completed maintenance or of asset condition.")
    if any(h.ocr for h in hits):
        out.append("Some passages were extracted by OCR from scanned pages and may contain recognition errors; check the original page.")
    if any(h.sheet for h in hits):
        out.append("Tabular evidence is quoted row by row from the source spreadsheet; totals are not recalculated unless stated.")
    return out


def _suggest(intent: str, terms: list[str], cites: list[dict]) -> list[str]:
    topic = " ".join(terms[:3]) or "this topic"
    first = cites[0]["filename"] if cites else None
    s = []
    if intent != "locate":
        s.append(f"Which pages mention {topic}?")
    if intent != "conflict":
        s.append(f"Are there conflicting statements about {topic}?")
    if intent != "gaps":
        s.append("What information is missing before we can confirm the root cause?")
    if first and intent != "summary":
        s.append(f"Summarise the relevant findings in {first}")
    if intent != "actions":
        s.append(f"Suggest corrective actions for {topic} and explain the evidence")
    return s[:4]


def _resolution_cases(db: Session, query: str, limit=5) -> list[dict]:
    from .embeddings import get_embedder
    cases = list(db.scalars(select(ResolutionMemory)))
    if not cases:
        return []
    emb = get_embedder()
    qv = emb.embed_query(query)
    texts = [f"{c.category} {c.problem_summary} {c.approved_action or ''}" for c in cases]
    mv = emb.embed(texts)
    sims = mv @ qv / ((np.linalg.norm(mv, axis=1) * (np.linalg.norm(qv) or 1)) + 1e-9)
    ranked = sorted(zip(sims, cases), key=lambda x: -x[0])[:limit]
    out = []
    for s, c in ranked:
        st = db.get(Station, c.station_id) if c.station_id else None
        out.append({"id": c.id, "ticket_id": c.ticket_id, "category": c.category, "station": st.display_name if st else None,
                    "problem": c.problem_summary, "action": c.approved_action, "outcome": c.outcome,
                    "similarity": round(float(s), 3)})
    return out


SYNONYMS = {"lift": "elevator", "lifts": "elevators", "elevator": "lift", "amc": "annual maintenance contract",
            "mttr": "mean time to repair", "ridership": "passengers patronage", "escalator": "escalators moving stairs",
            "deadline": "due date last date", "tender": "bid nit", "ups": "uninterruptible power supply battery"}
CHANGE_CUES = {"amended", "amendment", "revised", "modified", "replaced", "substituted", "corrigendum", "addendum", "extended",
               "read as", "instead", "deleted", "added", "changed", "clarified", "clarification", "postponed"}
DATE_RE = re.compile(r"\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,\s]+\d{4})\b", re.I)


def _ticket_context(db: Session, question: str, user) -> dict | None:
    """If the question references a ticket/complaint the user may view, return its context (REPORTED + recorded work)."""
    from ..models import Complaint, Ticket
    from ..security import has_perm
    m = re.search(r"\b(TKT|CMP)-[A-Z0-9]{8}\b", question.upper())
    if not m or user is None:
        return None
    code = m.group(0)
    t = db.scalar(select(Ticket).where(Ticket.ticket_code == code)) if code.startswith("TKT") else None
    if not t:
        c = db.scalar(select(Complaint).where(Complaint.complaint_code == code))
        t = c.ticket if c else None
    if not t:
        return {"code": code, "missing": True}
    staff = has_perm(user, "ticket:read_all")
    if not staff and t.complaint.user_id != user.id:
        return {"code": code, "forbidden": True}
    c = t.complaint
    findings = [f.finding + (f" (cause {'verified' if f.cause_verified else 'hypothesis'}: {f.root_cause})" if f.root_cause else "")
                for f in db.scalars(select(EngineerFinding).where(EngineerFinding.ticket_id == t.id))] if staff else []
    return {"code": code, "ticket_code": t.ticket_code, "complaint_code": c.complaint_code, "status": t.status,
            "station": c.station.display_name, "category": c.category, "description": c.description, "findings": findings,
            "asset": c.asset.name if c.asset else None}


def _complaint_context(db: Session, terms: list[str], staff: bool) -> list[dict]:
    """Aggregate counts of real complaint records matching the question (REPORTED; counts only)."""
    from ..models import Complaint, Ticket
    if not staff:
        return []
    rows = []
    for c in db.scalars(select(Complaint).order_by(Complaint.id.desc()).limit(2000)):
        text_ = f"{c.category.replace('_', ' ')} {c.description}".lower()
        if not terms or any(t in text_ for t in terms):
            rows.append(c)
    agg: dict[tuple, dict] = {}
    for c in rows:
        key = (c.station.display_name if c.station else "—", c.category)
        a = agg.setdefault(key, {"station": key[0], "category": key[1], "total": 0, "active": 0})
        a["total"] += 1
        if c.ticket and c.ticket.status not in ("RESOLVED", "CLOSED"):
            a["active"] += 1
    return sorted(agg.values(), key=lambda x: -x["total"])[:8]


def _latest_annual_report(db: Session) -> Document | None:
    best = None
    for d in db.scalars(select(Document).where(Document.category == "Annual Report", Document.status.in_(["INDEXED", "PARTIAL"]))):
        p = (d.meta or {}).get("detected_period")
        if p and (best is None or p > (best.meta or {}).get("detected_period")):
            best = d
    return best


def answer_question(db: Session, question: str, scope: dict | None = None, history: list[dict] | None = None, user=None) -> dict:
    from ..security import has_perm
    scope = scope or {}
    history = history or []
    staff = bool(user and has_perm(user, "ticket:read_all"))
    total_indexed = db.scalar(select(func.count(Document.id)).where(Document.status.in_(["INDEXED", "PARTIAL"]))) or 0
    standalone, prev_docs, is_follow = rewrite_followup(question, history)
    intent = detect_intent(question)
    doc_filter = resolve_doc_filter(db, scope.get("document_ids"), scope.get("categories"), scope.get("doc_kinds"))
    refers_prev = bool(re.search(r"\b(these|those|the two|both|them|above)\b.*\b(documents?|tenders?|reports?|files?)\b|\bthem\b", question, re.I))
    if doc_filter is None and is_follow and refers_prev and prev_docs:
        doc_filter = set(prev_docs)
    pre_lines: list[str] = []
    pre_limits: list[str] = []
    retrieval_notes: list[str] = []
    # "latest annual report": scope to the report with the most recent content-detected reporting period
    if doc_filter is None and re.search(r"\b(latest|most recent|newest|current|recent)\b", question, re.I) and re.search(r"annual report", question, re.I):
        latest = _latest_annual_report(db)
        if latest:
            doc_filter = {latest.id}
            retrieval_notes.append(f"Scoped to the latest available annual report by content-detected period: {latest.title} ({latest.filename})")
    # Ticket-aware questions
    tctx = _ticket_context(db, question, user)
    if tctx and tctx.get("missing"):
        pre_lines.append(f"No ticket or complaint with reference {tctx['code']} exists.")
    elif tctx and tctx.get("forbidden"):
        pre_lines.append(f"You do not have access to {tctx['code']}.")
    elif tctx:
        standalone = f"{standalone} {tctx['description']} {tctx['category'].replace('_', ' ')} {tctx['station']}"
        pre_lines.append(f"**Ticket context** — {tctx['ticket_code']} / {tctx['complaint_code']} · {tctx['status'].replace('_', ' ').title()} · {tctx['station']}")
        pre_lines.append(f"- Passenger report (REPORTED, unverified): “{tctx['description'][:300]}”" + (f" — reported asset: {tctx['asset']}" if tctx['asset'] else ""))
        for f in tctx["findings"][:4]:
            pre_lines.append(f"- Engineer finding (recorded): {f[:240]}")
        pre_lines.append("")
        pre_limits.append("Ticket details are platform records; document passages below are related context, not proof of the reported fault.")
    terms = content_terms(expand_query(standalone))
    broad = intent in ("summary", "risk", "compare", "conflict", "locate", "changes")
    k = 28 if broad else 10
    rq = standalone + (" risk hazard safety failure" if intent == "risk" else "")
    hits = hybrid_search(db, rq, k=k, doc_filter=doc_filter, per_doc_cap=3 if broad else None,
                         pool=120 if broad else 60, use_rerank=not broad)
    strength = evidence_strength(hits, terms)
    retrieval_notes.append("Pass 1: hybrid BM25 + vector retrieval" + (" with cross-encoder reranking" if any(h.rerank_score is not None for h in hits) else ""))
    if strength["level"] in ("NONE", "WEAK") and total_indexed:
        # Iterative retrieval: reformulate with synonyms / expansions and retrieve again
        extra = [SYNONYMS[t] for t in content_terms(standalone) if t in SYNONYMS]
        if extra:
            hits2 = hybrid_search(db, f"{rq} {' '.join(extra)}", k=k, doc_filter=doc_filter, per_doc_cap=3 if broad else None,
                                  pool=120, use_rerank=not broad)
            s2 = evidence_strength(hits2, terms)
            order = ["NONE", "WEAK", "MODERATE", "STRONG"]
            retrieval_notes.append(f"Pass 2 (reformulated with: {', '.join(extra)}): evidence {s2['level'].lower()}")
            if order.index(s2["level"]) > order.index(strength["level"]):
                hits, strength = hits2, s2
    cs = CitationSet()
    _RETRIEVAL_NOTES[id(cs)] = retrieval_notes
    lines: list[str] = list(pre_lines)
    labels = [DOCUMENTED] + (["REPORTED"] if tctx and not tctx.get("missing") and not tctx.get("forbidden") else [])
    limitations: list[str] = list(pre_limits)
    conflicts_out, gaps_out, cases_out = [], [], []
    scope_desc = _scope_description(db, doc_filter, total_indexed)
    if re.search(r"\bcomplaints?\b", question, re.I) and intent != "resolution":
        cc = _complaint_context(db, [t for t in terms if t not in ("complaint", "complaints", "reported", "passenger", "passengers")], staff)
        if cc:
            labels.append("REPORTED")
            lines.append("**Passenger complaint records** (REPORTED — counts from the platform database, not verified incidents):")
            for a in cc:
                lines.append(f"- {a['station']} · {a['category'].replace('_', ' ')}: {a['total']} complaint(s), {a['active']} active")
            lines.append("")
        elif staff:
            lines.append("**Passenger complaint records:** no matching complaints in the platform database.\n")

    if total_indexed == 0:
        return _final(db, question, standalone, intent, scope_desc, [], cs, [
            "No documents are indexed yet. Open **Documents** to check ingestion status or start indexing."],
            ["The document index is empty."], strength, [], [], [], is_follow)

    if intent == "resolution":
        cases_out = _resolution_cases(db, standalone)
        good = [c for c in cases_out if c["outcome"] == "VERIFIED_RESOLVED" and c["similarity"] >= 0.6]
        bad = [c for c in cases_out if c["outcome"] != "VERIFIED_RESOLVED" and c["similarity"] >= 0.6]
        if not good and not bad:
            lines.append("No sufficiently similar verified resolution exists in resolution memory. " + INSUFFICIENT_MSG)
        else:
            labels.append(VERIFIED)
            for c in good:
                lines.append(f"- **Verified resolution** (ticket #{c['ticket_id']}, {c['category']}, {c['station'] or 'station n/a'}): {c['problem']} → approved action: {c['action']} (similarity {c['similarity']})")
            for c in bad:
                lines.append(f"- **Counterexample — reopened/failed** (ticket #{c['ticket_id']}): {c['problem']} → action tried: {c['action']}")
            limitations.append("Similarity between cases is computed from text embeddings; it suggests relevance but does not prove the same root cause.")

    if strength["level"] == "NONE" or (strength["level"] == "WEAK" and intent not in ("locate", "gaps")):
        if intent != "resolution":
            lines.insert(0, f"**{INSUFFICIENT_MSG}**")
            if hits:
                lines.append("")
                lines.append("The closest passages found are shown below for manual review, but they do not directly answer the question:")
                for h in hits[:3]:
                    sents = best_sentences(h, terms, n=1)
                    if sents:
                        n = cs.cite(h, sents[0])
                        lines.append(f"- {sents[0]} [{n}]")
            limitations.append(f"Retrieval strength was {strength['level'].lower()} (best semantic match {strength['max_vector']}, query-term coverage {int(strength['term_coverage'] * 100)}%).")
        return _final(db, question, standalone, intent, scope_desc, hits, cs, lines, limitations, strength,
                      labels, conflicts_out, gaps_out, is_follow, cases_out)

    by_doc: "OrderedDict[int, list[Hit]]" = OrderedDict()
    for h in hits:
        by_doc.setdefault(h.document_id, []).append(h)

    if intent in ("summary", "risk", "actions"):
        cues = RISK_CUES if intent == "risk" else ACTION_CUES if intent == "actions" else None
        heading = {"summary": "Relevant findings across documents", "risk": "Potential risks identified in the documents",
                   "actions": "Documented requirements and measures relevant to corrective action"}[intent]
        lines.append(f"**{heading}** — grouped by source ({len(by_doc)} document{'s' if len(by_doc) != 1 else ''} with relevant passages):")
        for did, dh in list(by_doc.items())[:8]:
            picked = []
            for h in dh[:3]:
                for s in best_sentences(h, terms, cues, n=1, min_score=0.2 if cues else 0.15):
                    picked.append((h, s))
            if not picked:
                continue
            lines.append(f"\n**{dh[0].title}** · _{dh[0].category}_")
            for h, s in picked[:3]:
                lines.append(f"- {s} [{cs.cite(h, s)}]")
        if intent == "risk":
            labels.append("POTENTIAL")
            limitations.append("Statements are quoted as documented. Whether a documented risk is current, mitigated or materialised is not established by these passages.")
        if intent == "actions":
            labels.append(AI_HYPOTHESIS)
            lines.append("\n**Suggested next steps (AI hypothesis — requires engineering review):**")
            lines.append("- Confirm the specific asset and location involved, then compare its maintenance history against the documented requirements cited above.")
            lines.append("- Use the cited requirements as verification criteria for any corrective work, and record the outcome as an engineer finding.")
            lines.append("- Costs, timelines and feasibility are not established by the evidence and must be determined by the responsible team.")

    elif intent == "changes":
        _changes_section(db, standalone, terms, hits, cs, lines, limitations)
        labels.append(PROCESSED)

    elif intent == "compare":
        targets = list(by_doc.items())[:4]
        if len(targets) < 2:
            lines.append(f"Only one relevant document was found, so a comparison is not possible. {INSUFFICIENT_MSG}")
        else:
            lines.append(f"**Comparison across {len(targets)} documents** (statements quoted from each source):")
            term_docs = defaultdict(set)
            for did, dh in targets:
                lines.append(f"\n**{dh[0].title}** · _{dh[0].doc_kind.replace('_', ' ').title()}_")
                for h in dh[:3]:
                    for s in best_sentences(h, terms, ACTION_CUES, n=1, min_score=0.1):
                        lines.append(f"- {s} [{cs.cite(h, s)}]")
                for h in dh:
                    for t in h.matched_terms:
                        term_docs[t].add(did)
            shared = [t for t, ds in term_docs.items() if len(ds) == len(targets)]
            unique = {did: [t for t, ds in term_docs.items() if ds == {did}] for did, _ in targets}
            lines.append("\n**Observations (processed from the quoted passages):**")
            if shared:
                lines.append(f"- Terms present in all compared sources: {', '.join(shared[:8])}.")
            for did, dh in targets:
                if unique.get(did):
                    lines.append(f"- Only in _{dh[0].filename}_: {', '.join(unique[did][:6])}.")
            labels.append(PROCESSED)
            limitations.append("The comparison quotes the most relevant passages from each document; it is not a clause-by-clause legal comparison. Review the full documents for binding requirements.")

    elif intent == "conflict":
        conflicts = _find_conflicts(hits, terms)
        if not conflicts:
            lines.append("No conflicting numeric statements were detected among the retrieved passages. This does not prove the documents are consistent — only that no differing figures on the same subject were found in the top passages.")
            for did, dh in list(by_doc.items())[:3]:
                for s in best_sentences(dh[0], terms, n=1):
                    lines.append(f"- {s} [{cs.cite(dh[0], s)}]")
        else:
            lines.append("**Potential inconsistencies detected** — differing figures on the same subject in different documents:")
            for c in conflicts:
                lines.append(f"\n**Subject: {c['subject']} ({c['unit']})**")
                for v, h, s in c["items"]:
                    lines.append(f"- _{h.filename}_: {s} [{cs.cite(h, s)}]")
                conflicts_out.append({"subject": c["subject"], "unit": c["unit"],
                                      "values": [{"value": v, "document": h.filename, "page": h.page} for v, h, _ in c["items"]]})
            labels.append(PROCESSED)
            limitations.append("Differences may reflect different reporting periods, scopes or definitions rather than true contradictions. Verify against the original pages.")

    elif intent == "locate":
        lines.append(f"**Documents and pages with relevant passages** ({len(by_doc)} documents):")
        for did, dh in by_doc.items():
            locs = sorted({_loc(h) for h in dh}, key=lambda x: (len(x), x))
            refs = []
            for h in dh[:4]:
                s = best_sentences(h, terms, n=1)
                if s:
                    refs.append(f"[{cs.cite(h, s[0])}]")
            lines.append(f"- **{dh[0].filename}** — {', '.join(locs[:8])} {' '.join(refs)}")
        labels.append(PROCESSED)
        limitations.append("Listing is based on the top retrieved passages; pages with weaker matches may not appear. Run a collection-wide analysis job for exhaustive coverage.")

    elif intent == "gaps":
        lines.append("**Evidence available vs. missing** for this question:")
        docs_n = len(by_doc)
        lines.append(f"- Documentary evidence: {docs_n} document(s) with related passages" + (" (see citations)." if docs_n else "."))
        for did, dh in list(by_doc.items())[:3]:
            s = best_sentences(dh[0], terms, n=1)
            if s:
                lines.append(f"  - {s[0]} [{cs.cite(dh[0], s[0])}]")
        counts = {
            "Engineer findings recorded": db.scalar(select(func.count(EngineerFinding.id))) or 0,
            "Maintenance work records": db.scalar(select(func.count(MaintenanceRecord.id))) or 0,
            "Verified incidents": db.scalar(select(func.count(Incident.id))) or 0,
            "Verified resolutions in memory": db.scalar(select(func.count(ResolutionMemory.id)).where(ResolutionMemory.outcome == "VERIFIED_RESOLVED")) or 0,
        }
        for k_, v in counts.items():
            lines.append(f"- {k_}: {v}" + (" — **missing**" if v == 0 else ""))
        missing = ["Asset-level maintenance logs / work orders from the maintainer (not present in the workspace)",
                   "Sensor, SCADA or equipment telemetry (no live data source is connected)",
                   "Field inspection results confirming the asset condition",
                   "Incident reports with timestamps for the specific location"]
        lines.append("\n**Information still required before a root cause can be confirmed:**")
        lines.extend(f"- {m}" for m in missing)
        gaps_out = missing
        labels.append(PROCESSED)

    else:  # qa
        lines.append("**Answer from the indexed documents:**")
        picks = []
        for h in hits[:8]:
            for s_ in best_sentences(h, terms, n=1, min_score=0.15):
                picks.append((_sentence_score(s_, terms, None) + (h.vector_score or 0), h, s_))
        picks.sort(key=lambda x: -x[0])
        merged: "OrderedDict[str, list]" = OrderedDict()
        for _, h, s_ in picks:
            merged.setdefault(re.sub(r"\W+", " ", s_.lower()).strip(), [s_, []])[1].append(h)
        for key_, (s_, hs) in list(merged.items())[:6]:
            refs = "".join(f"[{cs.cite(h, s_)}]" for h in hs[:4])
            same = f" _(stated identically in {len({h.document_id for h in hs})} documents)_" if len({h.document_id for h in hs}) > 1 else ""
            lines.append(f"- {s_} {refs}{same}")
        if not picks:
            lines = [f"**{INSUFFICIENT_MSG}**"]

    return _final(db, question, standalone, intent, scope_desc, hits, cs, lines, limitations, strength, labels,
                  conflicts_out, gaps_out, is_follow, cases_out)


_RETRIEVAL_NOTES: dict[int, list[str]] = {}


def _changes_section(db, standalone, terms, hits, cs, lines, limitations):
    """Original tender vs its addenda/corrigenda/pre-bid replies: changed requirements and dates, quoted per document."""
    tender_hits = [h for h in hits if h.doc_kind in ("TENDER", "TENDER_AMENDMENT")]
    if not tender_hits:
        tender_hits = hybrid_search(db, standalone + " tender", k=12, doc_filter=resolve_doc_filter(db, doc_kinds=["TENDER", "TENDER_AMENDMENT"]))
    if not tender_hits:
        lines.append(f"No tender documents matched this question. {INSUFFICIENT_MSG}")
        return
    top = db.get(Document, tender_hits[0].document_id)
    folder = (top.meta or {}).get("folder")
    family = [d for d in db.scalars(select(Document).where(Document.status.in_(["INDEXED", "PARTIAL"]),
                                                           Document.doc_kind.in_(["TENDER", "TENDER_AMENDMENT"])))
              if (d.meta or {}).get("folder") == folder] if folder else [top]
    originals = [d for d in family if d.doc_kind == "TENDER"]
    amendments = [d for d in family if d.doc_kind == "TENDER_AMENDMENT"]
    lines.append(f"**Tender family:** {len(originals)} original notice(s) and {len(amendments)} amendment document(s) in the same procurement folder.")
    for d in originals + amendments:
        role = "Original notice" if d.doc_kind == "TENDER" else ("Corrigendum" if "corrigendum" in d.filename.lower()
                                                               else "Addendum" if "addendum" in d.filename.lower()
                                                               else "Pre-bid clarifications" if "prebid" in d.filename.lower().replace("-", "").replace("_", "") else "Amendment")
        q = standalone + (" amended revised read as instead extended date deadline clause" if d.doc_kind != "TENDER" else " scope requirement shall date")
        dh = hybrid_search(db, q, k=4, doc_filter={d.id}, pool=40)
        picked = []
        for h in dh:
            for s in best_sentences(h, terms + list(CHANGE_CUES), CHANGE_CUES if d.doc_kind != "TENDER" else None, n=2, min_score=0.1):
                if s not in [p[1] for p in picked]:
                    picked.append((h, s))
        lines.append(f"\n**{role}: {d.filename}**")
        if not picked:
            lines.append("- No passage relevant to this question was found in this document.")
        for h, s in picked[:4]:
            lines.append(f"- {s} [{cs.cite(h, s)}]")
        dates = []
        for h in dh:
            for m in DATE_RE.finditer(h.text):
                if m.group(0) not in [x[1] for x in dates]:
                    dates.append((h, m.group(0)))
        if dates:
            sent = []
            for h, dt in dates[:4]:
                ctx = next((s for s in split_sentences(h.text) if dt in s), None)
                if ctx:
                    sent.append(f"{dt} [{cs.cite(h, ctx)}]")
            if sent:
                lines.append(f"- Dates stated: {', '.join(sent)}")
    limitations.append("Each document is quoted separately. Which clause supersedes which is only stated where the amendment says so; "
                       "read the cited pages before relying on a changed requirement or date.")


def _final(db, question, standalone, intent, scope_desc, hits, cs, lines, limitations, strength, labels,
           conflicts, gaps, is_follow, cases=None) -> dict:
    citations = cs.validate(db)
    valid_ns = {c["n"] for c in citations}
    # Strip any citation marker that failed validation
    text = "\n".join(lines)
    text = re.sub(r"\[(\d+)\]", lambda m: m.group(0) if int(m.group(1)) in valid_ns else "", text)
    limitations = list(limitations) + _caveats(hits)
    terms = content_terms(expand_query(standalone))
    return {
        "answer": text.strip(),
        "citations": citations,
        "intent": intent,
        "standalone_query": standalone,
        "is_followup": is_follow,
        "scope": scope_desc,
        "coverage": {"passages_retrieved": len(hits), "documents_with_evidence": len({h.document_id for h in hits}),
                     "cited_documents": len({c["document_id"] for c in citations})},
        "evidence_strength": strength,
        "labels": sorted(set(labels)),
        "limitations": limitations,
        "conflicts": conflicts,
        "gaps": gaps,
        "resolution_cases": cases or [],
        "follow_ups": _suggest(intent, terms, citations),
        "consulted_documents": sorted({h.filename for h in hits}),
        "retrieval": _RETRIEVAL_NOTES.pop(id(cs), []),
        "mode": "extractive",
    }


def llm_passages(hits_or_citations: list[dict]) -> list[dict]:
    return [{"n": c["n"], "filename": c["filename"], "loc": c["location"], "text": c["excerpt"]} for c in hits_or_citations]
