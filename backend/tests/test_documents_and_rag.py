import json
import time

from app.db import SessionLocal, make_engine
from app.models import Document
from app.services.jobs import enqueue, run_pending_sync
from app.provenance import INSUFFICIENT_MSG


def docs_by_name(client, h):
    return {d["filename"]: d for d in client.get("/api/documents?page_size=500", headers=h).json()["items"]}


def test_ingestion_statuses_and_duplicates(client, admin):
    d = docs_by_name(client, admin)
    assert d["Test_Escalator_AMC.pdf"]["status"] == "INDEXED" and d["Test_Escalator_AMC.pdf"]["page_count"] == 2
    assert d["Accessibility_Policy.docx"]["status"] == "INDEXED"
    assert d["asset_counts.xlsx"]["status"] == "INDEXED"
    assert d["cmrl_monthly_ridership.csv"]["status"] == "INDEXED"
    dup = [x for x in ("notes.txt", "notes_copy.txt") if d[x]["status"] == "DUPLICATE"]
    assert len(dup) == 1
    # GTFS folders are datasets, not documents
    assert not any(n.endswith("stops.txt") for n in d)


def test_incremental_ingestion_skips_unchanged_and_reindexes_changed(client, admin):
    from conftest import RAW
    r = client.post("/api/documents/ingest", headers=admin).json()
    run_pending_sync()
    job = client.get(f"/api/jobs/{r['job_id']}", headers=admin).json()
    assert job["result"]["indexed"] == [] and job["result"]["unchanged"] >= 5
    p = RAW / "cmrl" / "documents" / "maintenance" / "notes.txt"
    time.sleep(1.1)
    p.write_text("Housekeeping schedule updated\n\nPlatforms are now cleaned every ninety minutes.", encoding="utf-8")
    r = client.post("/api/documents/ingest", headers=admin).json()
    run_pending_sync()
    job = client.get(f"/api/jobs/{r['job_id']}", headers=admin).json()
    assert "notes.txt" in job["result"]["indexed"]


def ask(client, h, question, cid=None):
    if cid is None:
        cid = client.post("/api/chat/conversations", headers=h, json={}).json()["id"]
    with client.stream("POST", f"/api/chat/conversations/{cid}/ask", headers=h, json={"question": question}) as r:
        assert r.status_code == 200
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    done = next(e for e in events if e["type"] == "done")
    assert any(e["type"] == "evidence" for e in events)
    return cid, done["message"]


def test_answer_has_exact_page_citation(client, operator):
    _, m = ask(client, operator, "What is the mean time to repair for lifts at Guindy?")
    cites = [c for c in m["citations"] if c["filename"] == "Test_Escalator_AMC.pdf"]
    assert cites and any(c["page"] == 2 for c in cites)
    assert all(c["verified"] for c in m["citations"])
    assert "45 minutes" in m["content"]


def test_tabular_row_citation(client, operator):
    _, m = ask(client, operator, "What was the total operator flow in March 2024?")
    row = [c for c in m["citations"] if c["sheet"] and c["row_start"] <= 3 <= c["row_end"]]
    assert row and "22,000" in m["content"]


def test_insufficient_evidence(client, operator):
    _, m = ask(client, operator, "What is the population of Paris and the height of the Eiffel tower?")
    assert INSUFFICIENT_MSG in m["content"]


def test_follow_up_uses_context(client, operator):
    cid, _ = ask(client, operator, "Which documents discuss escalator maintenance requirements?")
    _, m = ask(client, operator, "Which pages mention it?", cid)
    assert m["meta"]["is_followup"] and "escalator" in m["meta"]["standalone_query"]
    assert m["citations"]


def test_collection_analysis_reports_coverage(client, operator):
    r = client.post("/api/chat/analysis", headers=operator, json={"question": "escalator maintenance"}).json()
    run_pending_sync()
    job = client.get(f"/api/jobs/{r['job_id']}", headers=operator).json()
    cov = job["result"]["coverage"]
    assert job["status"] == "COMPLETED" and cov["documents_in_scope"] >= 5 and cov["documents_analysed"] + cov["documents_skipped"] == cov["documents_in_scope"]
    assert any(f["filename"] == "Test_Escalator_AMC.pdf" for f in job["result"]["findings"])


def test_graph_edges_have_provenance(client, admin):
    enqueue(SessionLocal(), "BUILD_GRAPH", {})
    run_pending_sync()
    g = client.get("/api/graph?types=station&types=document&types=topic&min_weight=1", headers=admin).json()
    assert g["edges"], "graph should have edges"
    for e in g["edges"]:
        assert e["method"] and e["evidence"], e
    doc = next(n for n in g["nodes"] if n["type"] == "document" and n["properties"]["filename"] == "Test_Escalator_AMC.pdf")
    mentions = [e for e in g["edges"] if e["source"] == doc["id"] and e["type"] == "MENTIONS"]
    assert mentions and all(ev["kind"] == "chunk" and ev["excerpt"] for e in mentions for ev in e["evidence"])
    rag = client.post("/api/graph/query", headers=admin, json={"question": "escalator maintenance at Egmore"}).json()
    assert [s["stage"] for s in rag["stages"]][0] == "Query understanding"
    assert any(e["key"] == "station:SEG" for e in rag["entities"])


def test_persistence_after_restart():
    from app.config import settings
    from sqlalchemy.orm import Session
    eng = make_engine(settings.database_path)  # fresh engine = simulated restart
    with Session(eng) as s:
        assert s.query(Document).filter(Document.status == "INDEXED").count() >= 5
    eng.dispose()


def test_interrupted_ocr_leaves_no_unembedded_chunks(client, monkeypatch):
    """Regression: an interruption mid-document must not persist passages without embeddings."""
    import app.services.ingestion.extractors as ex
    from app.models import DocumentChunk
    from app.services.ingestion.pipeline import ocr_pending_documents
    db = SessionLocal()
    d = db.query(Document).filter(Document.filename == "Test_Escalator_AMC.pdf").one()
    d.meta = {**d.meta, "ocr_pending_pages": [1, 2]}
    db.commit()
    calls = {"n": 0}

    def fake(path, pages, dpi=150):
        calls["n"] += 1
        if calls["n"] == 2:
            raise KeyboardInterrupt("simulated crash")
        return {pages[0]: "Scanned annex: escalator handrail inspection is required every week at all stations."}
    monkeypatch.setattr(ex, "ocr_pdf_pages", fake)
    try:
        ocr_pending_documents(db, progress=lambda *a: None)
    except KeyboardInterrupt:
        db.rollback()
    db.close()
    db = SessionLocal()
    d = db.query(Document).filter(Document.filename == "Test_Escalator_AMC.pdf").one()
    assert d.meta["ocr_pending_pages"] == [2]  # page 1 done and committed, page 2 still pending
    assert db.query(DocumentChunk).filter(DocumentChunk.embedding.is_(None)).count() == 0
    monkeypatch.setattr(ex, "ocr_pdf_pages", lambda path, pages, dpi=150: {pages[0]: ""})
    ocr_pending_documents(db)
    assert db.get(Document, d.id).meta["ocr_pending_pages"] == []
    db.close()
