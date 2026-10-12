# MegaAsset-Agentic — Project Presentation

**Evidence-Grounded Agentic Graph-RAG for Metro Infrastructure Intelligence (CMRL data)**

---

## 1. Introduction

Metro operators collect two very different kinds of information:

- **What passengers experience.** A complaint says, "the lift at Guindy is not working again."
- **What the organisation has written down.** Annual reports, maintenance contracts (AMCs), tenders with their addenda and corrigenda, safety audits, compliance reports, ridership data and timetable (GTFS) feeds.

Today these two worlds rarely meet. A complaint becomes a ticket, someone fixes something, and the ticket is closed. Nobody checks the complaint against the maintenance contract that defines the repair time. Nobody notices that three other passengers reported the same lift last week. The fix is not recorded in a way that helps the next engineer.

MegaAsset-Agentic connects these worlds. It is a working web platform built on CMRL's public documents and transit data. Passenger complaints become tickets, and each ticket is linked to:

- the station and the documented equipment;
- similar earlier complaints;
- the exact pages of the relevant documents;
- previously verified fixes.

An agentic AI workflow investigates each ticket and proposes actions. Engineers and supervisors stay in control: every proposal needs human approval, and a ticket is only marked resolved when the passenger confirms it.

The guiding principle is **evidence first**. Every answer cites a document page or a spreadsheet row. Every graph relationship records where it came from. When the evidence is not there, the system says: *"Insufficient verified evidence to support this conclusion."*

---

## 2. Problem Statement

1. **Complaints are isolated.** They are handled one at a time, so repeated issues at the same station or asset go unnoticed.
2. **Documents are not usable in operations.** Hundreds of pages of contracts, audits and reports cannot be searched quickly. Engineers rarely check what a contract actually requires, for example a lift repair time of 60 minutes.
3. **There is no trustworthy closure.** Tickets are often closed without independent review or passenger confirmation.
4. **Knowledge is lost.** The cause and the fix of a resolved case are not kept for future cases.
5. **AI tools are hard to trust.** Typical chatbots answer from general knowledge and may invent sources. That is unacceptable for infrastructure decisions.

---

## 3. Objectives

1. Build a **passenger complaint system** (English and Tamil) with attachments. It creates a tracked ticket for every complaint and never creates duplicates.
2. Enforce a **complete, auditable ticket lifecycle**: engineer work, supervisor review, passenger verification, and closure.
3. Ingest and index the **real CMRL document collection** (PDF, DOCX, CSV, XLSX, scanned pages), keeping page-level and row-level provenance.
4. Provide a **document assistant** that answers natural-language questions across the collection, with verified citations and an explicit "insufficient evidence" response.
5. Build a **knowledge graph** linking stations, assets, complaints, tickets, documents and resolutions, where every link is traceable.
6. Run an **agentic investigation workflow** that turns a complaint into evidence-based proposed solutions, with a human approval gate.
7. Keep **resolution memory**: verified fixes, plus failed fixes as counterexamples, to support future investigations.
8. Use **only real data**, run **fully locally** (no hosted AI API), and enforce **role-based access** so passengers see only their own tickets.

---

## 4. Modules

| # | Module | What it does |
|---|---|---|
| 1 | **Authentication & Roles** | JWT login with bcrypt password hashing. Five roles: passenger, operator, engineer, supervisor and admin. Passengers see only their own complaints and tickets. Every other area is staff-only, enforced on the server. |
| 2 | **Complaint Assistant** | Chat-style form in English or Tamil. Uses the real station list (GTFS), offers an optional "which equipment?" choice from the station's documented assets, and accepts photo, video and document uploads with validation. An idempotency key prevents duplicate complaints. |
| 3 | **Ticket Lifecycle Engine** | A state machine enforced on the server: RECEIVED → INVESTIGATING → ASSIGNED → IN_PROGRESS → PENDING_REVIEW → AWAITING_VERIFICATION → RESOLVED → CLOSED, plus REOPENED. Optimistic concurrency, notifications and a full audit trail. |
| 4 | **Engineer Workspace** | Lists assigned, available and returned tickets. Engineers start work, record findings (keeping hypotheses separate from verified causes), and submit the solution and the action actually taken, with evidence files. |
| 5 | **Supervisor Review Queue** | Supervisors approve work or reject it with a reason (rework or more evidence). Self-approval is blocked. The queue also tracks overdue (past SLA), reopened, and awaiting-passenger tickets. |
| 6 | **Passenger Verification** | The passenger chooses "Issue Resolved" (the ticket is closed and logged) or "Issue Still Exists" (the ticket is reopened and the failed fix is kept as a counterexample). |
| 7 | **Document Ingestion Pipeline** | Recursive discovery, SHA-256 duplicate detection, page-preserving extraction, OCR for scanned pages, structure-aware chunking, local embeddings, a keyword index, and incremental re-indexing. |
| 8 | **Document Assistant (RAG chatbot)** | Hybrid search with reranking. Detects the question type (comparison, tender changes, risks, conflicts, evidence gaps). Handles follow-up questions. Every claim cites a page or row. Can analyse the whole collection as a background job. |
| 9 | **Knowledge Graph (3D)** | An interactive Three.js graph of stations, assets, complaints, tickets, documents, actions and resolutions, colour-coded by type. Every edge shows how it was derived and its source evidence. |
| 10 | **Agentic Investigation (LangGraph)** | An 11-stage workflow: understand → classify → identify entities → find similar complaints → retrieve documents → retrieve graph → analyse operations → assess risk → evaluate evidence → recommend (or report insufficient evidence) → human approval gate. |
| 11 | **Risk Intelligence** | Flags clusters of complaints at the same station and category, reopened cases, and risk statements quoted from documents. Each flag comes with reasons and information gaps. These are indications, not predictions. |
| 12 | **Resolution Memory** | Stores verified fixes and failed fixes, with the evidence and the reviewer. Used as context for new investigations. |
| 13 | **Stations, Assets & Operations** | Station pages show an inventory with three separate reliability levels: verified, documented and reported. Also live sidebar counts of active complaints, ridership and hourly flow charts, and GTFS service statistics. |
| 14 | **Data & Models** | Shows document status, dataset previews (with the Chennai-wide GTFS kept separate from CMRL data), and the live status of each local AI component. |

---

## 5. Methodology

The project followed an **evidence-first, iterative engineering** method:

1. **Data audit first.** Every file in the workspace was inspected before any assumption was made. This revealed real data-quality problems (see Findings).
2. **Provenance by design.** Every record carries a label: DOCUMENTED, REPORTED, PROCESSED, AI_HYPOTHESIS, POTENTIAL, VERIFIED or INSUFFICIENT_EVIDENCE. A passenger complaint is REPORTED, never a verified fault. A tender is procurement scope, never proof that work was done.
3. **Human-in-the-loop.** The AI proposes. Humans approve, act and verify. Nothing safety-related is automated, and no ticket closes without either passenger confirmation or an audited administrator decision.
4. **Workflow by workflow.** Each workflow was built and tested end to end before moving on: complaint → ticket → work → review → verification → memory.
5. **Verification at three levels:**
   - automated backend tests;
   - browser end-to-end tests run on a copy of the database;
   - manual visual review of every screen.

---

## 6. Approach, Algorithms and Tools

### Algorithms

- **Hybrid retrieval.** SQLite FTS5 BM25 keyword search is combined with dense vector search (BAAI/bge-small-en-v1.5, 384 dimensions). The two rankings are merged with **Reciprocal Rank Fusion** (k = 60).
- **Cross-encoder reranking.** A local `ms-marco-MiniLM-L-6` model re-orders candidate passages by how well they answer the question.
- **Iterative retrieval.** If the evidence is weak, the question is reformulated (for example, lift → elevator, MTTR → mean time to repair) and the search runs again.
- **Structure-aware chunking.** Passages never cross a PDF page, so every citation points to one exact page. Spreadsheets are chunked by row ranges with sheet and row numbers.
- **Citation validation.** Every quoted excerpt is checked against the stored passage text. Unverifiable citations are removed.
- **Complaint similarity.** Complaint texts are embedded, and cosine similarity of 0.80 or more links two complaints. They are never merged. Connected components group repeated complaints at a station.
- **Rules-based classification and risk.** Transparent keyword rules (English and Tamil) and weighted risk factors, labelled as hypotheses. No accuracy is claimed because no labelled dataset exists.
- **Agent orchestration.** A LangGraph state machine. Each stage records its inputs, outputs, timing and errors.
- **Optimistic concurrency.** Each ticket has a version number. An update only succeeds if the version is unchanged, so duplicate or conflicting actions are rejected.

### Tools

| Layer | Tools |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Recharts, Three.js / React Three Fiber, Motion, Lucide |
| Backend | Python 3.11, FastAPI, Pydantic, SQLAlchemy, SQLite (WAL), JWT, bcrypt |
| AI / NLP | LangGraph, fastembed (ONNX), BGE embeddings, MiniLM cross-encoder, RapidOCR, PyMuPDF, python-docx, openpyxl, scikit-learn |
| Testing | pytest, Playwright (Edge) |
| Data | CMRL annual reports, compliance reports, tenders, safety and maintenance documents, parking tariff, monthly ridership CSV, station passenger-flow XLSX, CMRL GTFS, Chennai-wide GTFS (kept separate) |

---

## 7. Findings and Results

### Data processed (real workspace data)

- **30 files discovered:**
  - 29 indexed;
  - 1 skipped as a byte-identical duplicate;
  - 1,128 pages in total, 95 of them read by OCR;
  - 4,052 searchable passages.
- **From the GTFS feed:**
  - 41 CMRL stations and 212 entrance records;
  - 90 lift, 76 escalator and 93 ramp references found in entrance descriptions.
- **Ridership:** 39 months of monthly ridership by ticket type, plus station-level and hourly passenger counts.
- **Knowledge graph:** 357 entities and 886 traceable relationships.

### Data-quality problems found

- **Four of the five annual-report files are misnamed.** For example, `CMRL_Annual_Report_2020_21.pdf` is actually the *18th Annual Report 2024-25*. The system reads the real year from the cover page and flags the mismatch. The original files are not changed.
- **`CMRL_UPS_Battery_NIT_2026.pdf` is an exact copy of the lift/escalator pre-bid document**, so the real UPS tender appears to be missing.
- **Three compliance reports are scanned images**, so their text could only be recovered with OCR.

### Assistant behaviour (examples on the real collection)

- *"What is the MTTR requirement for lifts?"* — The exact clause, "The Lifts shall achieve MTTR of 60 minutes", is ranked first and cited with its page.
- *"Total passenger flow in March 2024?"* — The answer cites the exact CSV row (Row 13, Mar-24).
- *Tender vs. addenda/corrigenda* — The answer found the real clause 17.16 change (insurance) and the corrigendum dates.
- *Off-topic questions* (for example, "population of Paris") — The answer is correctly "Insufficient verified evidence".

### Similarity calibration

| Complaint pair | Similarity | Linked? |
|---|---|---|
| Same lift problem, worded differently | ≈ 0.81 | Yes |
| Lift vs. escalator | ≈ 0.77 | No |
| Unrelated complaints | ≈ 0.4–0.5 | No |

### Performance (laptop CPU, no GPU)

- Full indexing of 27 text documents: **9.3 minutes**.
- A rescan when nothing has changed: **0.2 seconds**.
- OCR: about **9 seconds per page**.
- Answering a question: **1–3 seconds**.

### Quality assurance

- **26 automated backend tests pass.** They cover:
  - the full ticket lifecycle;
  - concurrent duplicate actions (exactly one of four simultaneous requests succeeds);
  - blocking self-approval;
  - duplicate-free complaint submission;
  - audited administrator closure;
  - citations;
  - follow-up questions;
  - OCR recovery after an interruption;
  - passenger access restrictions.
- **Browser end-to-end flows pass with no page errors.** They cover:
  - complaint submission;
  - engineer work;
  - supervisor rejection and approval;
  - passenger confirmation;
  - live station counts;
  - the 3D graph;
  - the assistant's retrieval trace.

### Honest limitations

- **No local language model is installed**, so answers are quoted extracts rather than written in fluent prose. Ollama support is built in and can be switched on.
- **There is no sensor data, work-order history or asset register** in the workspace, so the system shows these as missing rather than estimating them.
- **The complaint data is a small pilot set.** The similarity and risk methods are ready for larger volumes, but they have not been measured at scale.

---

## 8. Conclusion

MegaAsset-Agentic shows that passenger complaints and organisational documents can be combined into one trustworthy decision-support system. Each complaint becomes a structured, linked record. Each answer is traceable to a page. Each fix is reviewed, verified by the passenger, and remembered.

The system is deliberately conservative. It separates reports from facts and hypotheses from verified causes, and it says clearly when evidence is missing. That makes it suitable for safety-sensitive infrastructure work, where invented answers are worse than no answer.

The platform runs fully on local hardware with open tools, so a public-sector operator can adopt it without sending data to external AI services.

**Future work:**
- connect live sources: maintenance work orders, asset registers, and SCADA or sensor feeds;
- add a local language model for fluent answers, keeping the same citation checks;
- evaluate classification and risk scoring once enough verified cases have built up in resolution memory.

---

## 9. Five-Minute Pitch

> *(About 650 words, roughly 5 minutes at a calm speaking pace.)*

Good morning everyone.

Imagine you use a wheelchair, and you arrive at Guindy Metro station. The lift isn't working. You complain. Two days later, another passenger complains about the same lift. And the next week, a third.

Each of those complaints becomes a separate ticket. Someone resets the lift, closes the ticket, and moves on. Nobody connects the three reports. Nobody opens the maintenance contract, which says lifts must be repaired within sixty minutes. And when the lift fails again, the next engineer starts from zero.

The problem isn't a lack of information. CMRL publishes annual reports, maintenance contracts, safety audits and ridership data, and passengers tell us every day what's broken. The problem is that these two sources of truth never meet.

That's why we built **MegaAsset-Agentic**.

It starts with the passenger. A passenger raises a complaint in English or Tamil, chooses the station, and can say which lift or escalator they mean, from CMRL's own records. They get a ticket number straight away, and they can follow that ticket, and only their own ticket, to the end.

Behind the scenes, that complaint becomes data. The system compares it with every earlier complaint, and finds that the Guindy lift has been reported before. It links the complaint to the station and the equipment. Then it searches more than a thousand pages of CMRL documents and finds the exact clause, on the exact page, that defines the repair standard.

An AI investigation runs eleven clear steps. It classifies the issue, gathers evidence from the documents and from a knowledge graph, weighs the risk, and proposes solutions. Each proposal lists its benefits, its risks, and what information is still missing.

But here's what matters most: **the AI never has the final word.** An engineer does the work and records what was actually done. A supervisor reviews it, and the system won't let anyone approve their own work. And the ticket only closes when the passenger confirms the problem is really fixed. If the passenger says "it's still broken," the ticket reopens, and the failed fix is remembered, so nobody repeats it.

Now, why should you trust it? Because it shows its evidence. Every answer cites a page or a spreadsheet row, and every quote is checked against the source. When the evidence isn't there, it says so: *insufficient verified evidence.* Ask it about the population of Paris, and it won't make something up.

While building this, the system found real problems in the data itself. Four of the five annual reports are filed under the wrong year. One tender file is an exact copy of a different tender, so the real one is missing. And three compliance reports are scanned images that nobody could search until now. These are exactly the issues that slip through when information lives in silos.

Everything runs locally, on an ordinary laptop, with open-source tools and no external AI service. Passenger data never leaves the organisation. It answers questions in one to three seconds, and twenty-six automated tests, plus full browser walkthroughs, verify every workflow.

So what's the value?

For **passengers**, it means a complaint that's tracked, connected, and truly resolved.
For **engineers**, it puts the right contract clause and the history of similar cases in front of them at the moment they need it.
For **managers**, it shows patterns: which stations and which equipment keep failing, and why.
And for the **organisation**, every complaint becomes knowledge instead of noise.

MegaAsset-Agentic turns the voice of the passenger into evidence, and evidence into better decisions.

Thank you.

---

## 10. How Passenger Complaints Become a Dataset for Document Analysis

A complaint is not just a message to answer. In MegaAsset-Agentic, each complaint becomes a **structured data record** that drives document analysis in six ways.

1. **Structured capture.** Each complaint stores:
   - the text and its language;
   - the station (from the GTFS list);
   - the category;
   - the reported equipment, if any;
   - attachments and a timestamp;
   - the provenance label **REPORTED**.

   This turns free text into consistent fields that can be queried.

2. **Embedding and similarity.** Each complaint is converted into a vector by the same local model used for the documents. That allows:
   - **similarity search between complaints.** Repeated reports are linked when similarity is 0.80 or more, and never merged;
   - **station-level clusters** ("3 similar active lift complaints at Guindy").

3. **The complaint as a search query.** During an investigation, the complaint text, its category and its station form the query against the indexed documents. "Lift not working at Guindy" retrieves the lift and escalator maintenance-contract clauses, such as the 60-minute repair standard, and station-specific passages, each with page citations. The complaint therefore decides which parts of the document collection are examined.

4. **Graph links.** Complaints become nodes in the knowledge graph, linked to:
   - their station (REPORTED_AT);
   - their equipment (CONCERNS_ASSET);
   - a subject area such as lifts (CONCERNS);
   - similar complaints (RESEMBLES);
   - their ticket, investigation, approved action and final resolution.

   Graph search can then move from a complaint to every document that mentions the same station or equipment type.

5. **Aggregate evidence in the assistant.** When staff ask questions such as *"Compare reported complaints with the maintenance documents,"* the assistant adds a **complaint-records section**: counts by station and category, with how many are still active. These counts sit next to the cited document passages, so reported problems can be compared with what contracts and audits require. They are clearly labelled as reports, not verified incidents.

6. **A feedback loop through resolution memory.** When a passenger confirms a fix, the complaint, the engineer's findings, the approved action and the supervisor's decision are stored together as a **verified case**. When a fix fails, it is stored as a **counterexample**. Future complaints are compared against these cases, so the dataset improves with every resolved ticket.

**The safeguard.** Complaints are always treated as **reports**, never as proof that something failed. A cluster of complaints raises investigative priority. It does not confirm a fault. A fault is confirmed only by an engineer's finding, and a fix only by the passenger.
