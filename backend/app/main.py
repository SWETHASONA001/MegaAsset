"""MegaAsset-Agentic API entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import func, select

from .config import PROJECT_DIR, settings
from .db import SessionLocal, init_db
from .models import Role, Station, User
from .security import ROLES, hash_password

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("megaasset")

DEMO_STAFF = [
    ("operator@megaasset.local", "Control Room Operator (demo)", "operator", "Station Operations", "Operator!2026"),
    ("engineer@megaasset.local", "E&M Engineer (demo)", "engineer", "Lifts & Escalators (E&M)", "Engineer!2026"),
    ("supervisor@megaasset.local", "Operations Supervisor (demo)", "supervisor", "Station Operations", "Supervisor!2026"),
]


def bootstrap(start_jobs: bool = True):
    init_db()
    db = SessionLocal()
    try:
        for name, spec in ROLES.items():
            r = db.get(Role, name)
            if not r:
                db.add(Role(name=name, description=spec["description"], permissions=spec["permissions"]))
            else:
                r.description, r.permissions = spec["description"], spec["permissions"]
        db.flush()
        if not db.scalar(select(User).where(User.role == "admin")):
            db.add(User(email=settings.bootstrap_admin_email, full_name="Platform Administrator", role="admin",
                        password_hash=hash_password(settings.bootstrap_admin_password), team="Station Operations", is_demo=True))
            log.warning("Created bootstrap admin %s — change its password after first login.", settings.bootstrap_admin_email)
        if settings.create_demo_staff:
            for email, name, role, team, pw in DEMO_STAFF:
                if not db.scalar(select(User).where(User.email == email)):
                    db.add(User(email=email, full_name=name, role=role, team=team, password_hash=hash_password(pw), is_demo=True))
        db.commit()
        from .services.ingestion.pipeline import backfill_metadata
        backfill_metadata(db)
        if start_jobs:
            from .services.jobs import enqueue, start_worker
            if not db.scalar(select(func.count(Station.id))):
                enqueue(db, "INGEST_DATASETS", {})
            if settings.auto_ingest_on_startup:
                enqueue(db, "INGEST_DOCUMENTS", {})
            start_worker()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap(start_jobs=not getattr(app.state, "testing", False))
    # Load the embedding model in the background so the first query is fast
    import threading
    from .services.embeddings import get_embedder
    from .services.retrieval import get_reranker
    threading.Thread(target=lambda: (get_embedder(), get_reranker()), daemon=True).start()
    yield
    from .services.jobs import stop_worker
    stop_worker()


app = FastAPI(title="MegaAsset-Agentic API", version="1.0.0", lifespan=lifespan,
              description="Evidence-grounded Agentic Graph-RAG for metro infrastructure intelligence (CMRL data).")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

from .routers import auth, chat, complaints, documents, infrastructure, intelligence, operations, platform, tickets, workspace  # noqa: E402

for r in (auth, complaints, tickets, workspace, documents, chat, infrastructure, operations, intelligence, platform):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


# Serve the built frontend (npm run build) from the same origin when available.
DIST = PROJECT_DIR / "frontend" / "dist"
if DIST.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="static-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        candidate = (DIST / full_path).resolve()
        if full_path and DIST.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
