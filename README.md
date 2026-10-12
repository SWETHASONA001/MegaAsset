# MegaAsset-Agentic

**Evidence-grounded agentic Graph-RAG for metro infrastructure intelligence, built on public CMRL data.**

MegaAsset-Agentic connects passenger complaints, operational tickets, CMRL documents and transit datasets. A knowledge graph links them, and an agentic workflow investigates issues. Every answer, relationship and recommendation can be traced to its source: a document page, a dataset row or a database record.

> This is an independent project that uses publicly available CMRL documents and transit data. It is not an official Chennai Metro Rail Limited system.

---

## Quick start (Windows)

```powershell
.\start.ps1          # builds the UI and serves everything at http://127.0.0.1:8010
.\start.ps1 -Dev     # API on :8010, plus the Vite dev server with hot reload at http://localhost:5173
```

The first start does the following:
1. Creates the database at `backend/data/megaasset.db`.
2. Processes the datasets in `data/raw`.
3. Indexes every document in the background, then OCRs any image-only pages.

The Documents page shows live progress. Later starts are incremental: unchanged files are skipped by checksum.

**Accounts.** These are created locally on first start. Change the passwords for any real use.

| Role | Email | Password |
|---|---|---|
| Administrator / supervisor | `admin@megaasset.local` | `ChangeMe!2026` |
| Control-room operator (demo) | `operator@megaasset.local` | `Operator!2026` |
| E&M engineer (demo) | `engineer@megaasset.local` | `Engineer!2026` |
| Operations supervisor (demo) | `supervisor@megaasset.local` | `Supervisor!2026` |

Passengers register themselves at `/signup`.

### Manual setup
```powershell
cd backend
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env      # optional
.venv\Scripts\python -m uvicorn app.main:app --port 8010
cd ..\frontend
npm install
npm run dev                 # or: npm run build (the API then serves frontend/dist)
```

### Tests
```powershell
cd backend
.venv\Scripts\python -m pytest tests -q
```
The tests run against an isolated temporary database. They use the real CMRL GTFS feed and small generated PDF, DOCX, XLSX, CSV and TXT files.

---

## What's in the workspace data

| Source | Scope | How it's used |
|---|---|---|
| `data/raw/cmrl/documents/**` (annual reports, compliance, tenders, projects, safety, parking) | CMRL | Indexed for the assistant, the graph and investigations |
| `data/raw/cmrl/gtfs` | **CMRL only** | 41 stations, 212 entrance records, and the lift, escalator and ramp references in entrance descriptions, plus lines, routes and timetable statistics |
| `data/raw/chennai_mobility` | **Chennai-wide** (MTC and others) | Registered as a separate dataset. Never used for CMRL stations, assets or KPIs |
| `data/raw/cmrl/ridership/cmrl_monthly_ridership.csv` | CMRL | Monthly ridership by ticket type, with source row numbers |
| `data/raw/cmrl/passenger_flow/*.xlsx` | CMRL | Station-level and hourly passenger counts for the dates in the workbook |

**Data issues found during ingestion.** The UI reports these issues and does not hide them:
- **Annual report filenames don't match their contents.** For example, `CMRL_Annual_Report_2020_21.pdf` is the *18th Annual Report 2024-25*. The reporting period is detected from each report's cover page. The detected period is used in titles, and a warning is shown. The raw files are left unchanged.
- **`CMRL_UPS_Battery_NIT_2026.pdf` is byte-identical to `CMRL_Lift_Escalator_AMC_PreBid_2026.pdf`.** It is marked `DUPLICATE` and is not indexed twice.
- **Three compliance PDFs (CRZ monitoring reports and the environment statement) are scanned images.** Their text comes from local OCR and is labelled as OCR text.

**Not present in the workspace.** The workspace has no complaints, incidents, maintenance work orders, sensor/SCADA data or live feeds. The app starts with these empty and shows labelled empty states. It never generates sample records.

---

## Architecture

```
frontend/  React 19 + TypeScript + Vite + Tailwind v4 + React Router + Recharts + React Flow + Motion + Lucide
backend/   FastAPI + SQLAlchemy (SQLite, WAL) + Pydantic + JWT (bcrypt)
  app/services/ingestion/   discovery → checksum/duplicates → extraction (PyMuPDF, python-docx, openpyxl, csv)
                            → structure-aware chunking (never crosses a page) → FTS5 + embeddings
  app/services/retrieval.py hybrid search: SQLite FTS5 BM25 + dense cosine, fused with reciprocal-rank fusion
  app/services/answer.py    intent-aware grounded synthesis, follow-up rewriting, conflict & gap analysis,
                            citation validation (each quote must exist in the cited passage)
  app/services/analysis.py  collection-wide map-reduce analysis job with coverage reporting
  app/services/graph.py     knowledge graph: every edge stores its method and evidence
  app/agents/workflow.py    LangGraph investigation workflow with a human-approval gate
  app/services/tickets.py   ticket state machine, permissions, verification, resolution memory
  app/services/jobs.py      persistent background job queue (recoverable after restart, cancellable)
```

**Local AI only.** No hosted AI API is used.
- **Embeddings.** `BAAI/bge-small-en-v1.5` runs through ONNX Runtime (fastembed) and is cached in `backend/data/models`. If the model can't be loaded, a deterministic hashing embedder is used instead, and the AI Models page shows this.
- **OCR.** RapidOCR (ONNX) runs as a background job for image-only pages. Each page is atomic, so the job resumes safely after an interruption.
- **Generative LLM (optional).** Set `MEGAASSET_OLLAMA_MODEL` and install [Ollama](https://ollama.com). Model output is accepted only if its citations validate. Without an LLM, answers are extractive: every sentence is quoted from a cited passage.
- **Classification and risk scoring.** Both use transparent rules, labelled `AI_HYPOTHESIS` and `POTENTIAL`. No predictive accuracy is claimed.

**Measured on this machine** (i7-1165G7, 16 GB RAM, no GPU):
- Indexing the 27 text-layer documents (about 1,050 pages) took 9.3 minutes, with embedding as the main cost. A rescan with no changed files takes about 0.2 seconds.
- OCR takes about 9 seconds per page.
- A query takes 1–3 seconds.

Scaling to hundreds of files is handled in the following ways:
- Bounded process-pool extraction.
- Batched embeddings that are persisted per passage.
- Incremental re-indexing.
- An in-memory vector matrix that is reloaded only when the index changes.

---

## Ticket workflow (v2)

```
RECEIVED → INVESTIGATING → ASSIGNED → IN_PROGRESS → PENDING_REVIEW → AWAITING_VERIFICATION → RESOLVED → CLOSED
                                            ↑              │ reject (reason)        │ "Issue still exists"
                                            └──────────────┘                        ↓
                                                                                 REOPENED
```

| Step | Who | Server-enforced rule |
|---|---|---|
| Start work | Engineer | Records the (self-)assignment first; cannot take a ticket assigned to someone else |
| Complete work | Assigned engineer | Solution **and** action actually taken are required; evidence files optional |
| Review | Supervisor | Approve, or reject with a reason (rework / more evidence). **No self-approval** |
| Verify | Passenger | "Issue Resolved" → resolved and closed automatically (logged); "Issue Still Exists" → reopened + counterexample |
| No response | — | Stays awaiting verification; flagged after 7 days; never auto-verified |
| Admin closure | Administrator | Explicit reason, audit-logged, never counted as a verified resolution |

Policy lives in `backend/app/config.py` (`MEGAASSET_REQUIRE_SUPERVISOR_REVIEW`, `MEGAASSET_ALLOW_SELF_APPROVAL`, `MEGAASSET_AUTO_CLOSE_ON_PASSENGER_CONFIRMATION`, SLA hours).
Every mutating ticket request uses **optimistic concurrency** (ticket `version`): a stale or simultaneous duplicate action gets HTTP 409 and the UI reloads.
Complaint submission carries an **idempotency key**, so retries and double-clicks never create a second ticket.

## Other v2 capabilities
- **Station activity in the sidebar** — live active-complaint / open-ticket / in-review counts per station from `GET /api/stations/activity` (RESOLVED/CLOSED are not active).
- **Complaint similarity** — complaints are embedded locally; reports with cosine ≥ 0.80 are linked (`RESEMBLES` edges, "Related & similar" tab), never merged. The investigation workflow has a `find_similar_complaints` stage.
- **Reported equipment** — passengers may pick a documented asset at the station (stored as REPORTED, not a verified fault).
- **Station inventory tiers** — verified (engineer-confirmed) / document-derived (GTFS references) / reported (complaints), shown side by side and never summed; platforms are "Not inventoried".
- **3D knowledge graph** (Three.js + React Three Fiber) — colour-coded entity types with legend, dashed edges for processed/reported/hypothesis links, station-level start with expand-on-demand, search, station focus, "hide unrelated", status/time filters, label modes, node limit, fit/reset, station inventory panel.
- **Chat retrieval** — local cross-encoder reranking (`Xenova/ms-marco-MiniLM-L-6-v2`), a second reformulated retrieval pass when evidence is weak, tender-vs-addenda/corrigenda change comparison with dates, "latest annual report" scoping by content-detected period, ticket-aware questions (`TKT-…`/`CMP-…`), complaint-record counts for staff, and a per-answer "how this was retrieved / documents consulted" trace.
- **Migrations** — additive, idempotent column migrations recorded in `schema_migrations`; existing data is preserved.

---

## Key flows

**Complaint → ticket.** "Raise a Complaint" opens a chat-style drawer with an English/தமிழ் toggle.
- The station list comes from GTFS.
- You choose a category. The category is treated as a report, not as proof of an incident.
- Photos, videos and documents are optional. Files are validated by extension, MIME type, magic bytes and size, and stored under random names.

The success screen appears only after the backend returns the real `CMP-XXXXXXXX` complaint ID and `TKT-XXXXXXXX` ticket ID.

**Ticket lifecycle.** The backend enforces these transitions:
- `RECEIVED → INVESTIGATING → ASSIGNED → IN_PROGRESS → AWAITING_VERIFICATION → RESOLVED → CLOSED`
- `REOPENED` is used when an issue persists.

Further rules:
- Only `RESOLVED` tickets can be closed.
- The passenger answers **Issue Resolved** or **Issue Still Exists**. "Issue Still Exists" reopens the ticket.

**Agentic investigation.** The workflow runs these stages in order:
1. understand
2. classify (EN and Tamil keywords)
3. identify entities
4. retrieve documents
5. retrieve graph
6. analyse operations
7. assess risk
8. evaluate evidence
9. recommend, or report insufficient evidence
10. human approval gate

Each solution lists the problem it addresses, its supporting evidence, benefits, risks, dependencies, missing information, approval requirements and verification criteria. No costs or timelines are invented. Only a supervisor can approve a solution.

**Resolution memory.** A case is stored only after a passenger verifies it.
- Reopened cases are kept as counterexamples.
- Investigations use these cases as context, never as proof.

**Notifications.** Notifications are in-app and stored in the database. Email and SMS are **not** configured.

---

## Provenance labels
`DOCUMENTED` · `REPORTED` · `PROCESSED` · `MODEL_PREDICTED` · `AI_HYPOTHESIS` · `POTENTIAL` · `SIMULATION` · `VERIFIED` · `PENDING` · `INSUFFICIENT_EVIDENCE` · `REQUIRES_REVIEW`

When retrieval cannot support a conclusion, the assistant answers: **"Insufficient verified evidence to support this conclusion."**

## Security notes
- JWT authentication, with bcrypt password hashing.
- Role permissions are checked on every endpoint: passenger, operator, engineer and admin.
- Uploads are validated, and attachment and file downloads are protected against path traversal.
- Secrets are read from environment variables or a locally generated secret file.
- Original documents open in the browser with `?token=` so the PDF viewer can jump to `#page=N`. Use HTTPS if the app is exposed beyond localhost.
