"""SQLAlchemy engine/session and SQLite FTS5 setup."""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


def make_engine(path=None):
    db_path = path or settings.database_path
    eng = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(eng, "connect")
    def _pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

    return eng


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db(eng=None) -> None:
    from . import models  # noqa: F401  (register tables)

    eng = eng or engine
    Base.metadata.create_all(eng)  # creates new tables; never alters or drops existing ones
    migrate(eng)
    with eng.begin() as conn:
        # Keyword index over chunks. rowid == document_chunks.id
        conn.execute(text(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5("
            "content, heading, doc_title, tokenize='porter unicode61')"
        ))


# Additive, idempotent schema migrations for databases created by earlier versions. Existing rows are preserved;
# each step only adds a column/index that is missing. Applied steps are recorded in schema_migrations.
MIGRATIONS = [
    ("2026_10_v2_ticket_version", "tickets", "version", "INTEGER NOT NULL DEFAULT 1"),
    ("2026_10_v2_complaint_request_id", "complaints", "client_request_id", "VARCHAR(64)"),
    ("2026_10_v2_complaint_asset", "complaints", "asset_id", "INTEGER REFERENCES assets(id)"),
    ("2026_10_v2_complaint_embedding", "complaints", "embedding", "BLOB"),
    ("2026_10_v2_finding_cause_verified", "engineer_findings", "cause_verified", "BOOLEAN NOT NULL DEFAULT 0"),
    ("2026_10_v2_ticket_admin_closed", "tickets", "closure_type", "VARCHAR(32)"),
]
INDEXES = [
    ("2026_10_v2_uq_complaint_request", "CREATE UNIQUE INDEX IF NOT EXISTS uq_complaint_request ON complaints(user_id, client_request_id) WHERE client_request_id IS NOT NULL"),
]


def migrate(eng) -> list[str]:
    applied = []
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(80) PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)"))
        done = {r[0] for r in conn.execute(text("SELECT id FROM schema_migrations"))}
        for mid, table, column, ddl in MIGRATIONS:
            if mid in done:
                continue
            cols = {r[1] for r in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            conn.execute(text("INSERT INTO schema_migrations(id) VALUES (:i)"), {"i": mid})
            applied.append(mid)
        for mid, sql in INDEXES:
            if mid not in done:
                conn.execute(text(sql))
                conn.execute(text("INSERT INTO schema_migrations(id) VALUES (:i)"), {"i": mid})
                applied.append(mid)
    return applied


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
