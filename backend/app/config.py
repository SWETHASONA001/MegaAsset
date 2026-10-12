"""Application settings, loaded from environment variables (or backend/.env)."""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


def _default_secret() -> str:
    """Persist a random JWT secret locally if none is configured, so tokens survive restarts."""
    path = BACKEND_DIR / "data" / ".jwt_secret"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path.read_text().strip()
    value = secrets.token_urlsafe(48)
    path.write_text(value)
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BACKEND_DIR / ".env"), env_prefix="MEGAASSET_", extra="ignore")

    database_path: Path = BACKEND_DIR / "data" / "megaasset.db"
    raw_data_dir: Path = PROJECT_DIR / "data" / "raw"
    uploads_dir: Path = PROJECT_DIR / "data" / "uploads"
    processed_dir: Path = BACKEND_DIR / "data" / "processed"
    models_dir: Path = BACKEND_DIR / "data" / "models"

    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 12

    # Bootstrap administrator (created once if no admin exists). Change the password after first login.
    bootstrap_admin_email: str = "admin@megaasset.local"
    bootstrap_admin_password: str = "ChangeMe!2026"
    create_demo_staff: bool = True

    # AI configuration — everything runs locally.
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_batch_size: int = 32
    enable_ocr: bool = True
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = ""  # empty = no generative LLM; extractive grounded synthesis is used
    auto_ingest_on_startup: bool = True
    ingest_workers: int = 3

    # Ticket workflow policy
    require_supervisor_review: bool = True        # engineer work must be approved before passenger verification
    allow_self_approval: bool = False             # an engineer may not approve their own work
    auto_close_on_passenger_confirmation: bool = True  # passenger "Issue Resolved" -> RESOLVED -> CLOSED (system event)
    verification_reminder_days: int = 7           # tickets awaiting passenger confirmation longer than this are flagged
    sla_hours: dict = {"CRITICAL": 24, "HIGH": 72, "MEDIUM": 168, "LOW": 336}  # overdue thresholds (open age)
    complaint_similarity_threshold: float = 0.80
    enable_reranker: bool = True
    reranker_model: str = "Xenova/ms-marco-MiniLM-L-6-v2"

    max_upload_mb: int = 50
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    def model_post_init(self, __context) -> None:  # noqa: D401
        if not self.jwt_secret:
            self.jwt_secret = os.environ.get("MEGAASSET_JWT_SECRET") or _default_secret()
        for p in (self.database_path.parent, self.processed_dir, self.models_dir,
                  self.uploads_dir / "documents", self.uploads_dir / "images",
                  self.uploads_dir / "videos", self.uploads_dir / "attachments"):
            p.mkdir(parents=True, exist_ok=True)


settings = Settings()
