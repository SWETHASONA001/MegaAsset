"""Assemble a deployable bundle for Hugging Face Spaces in deploy/build/space.

What it does:
  * copies backend code, the built frontend (frontend/dist), raw CMRL data and the cached ONNX models;
  * snapshots the database with SQLite's backup API (consistent even while the local server runs);
  * replaces every staff password (admin/operator/engineer/supervisor) in the snapshot with a new random one,
    written ONLY to deploy/build/STAFF_CREDENTIALS.txt (never uploaded);
  * never copies local secrets (.env, .jwt_secret) or the virtualenv.

Usage:  backend\\.venv\\Scripts\\python deploy\\build_space.py
"""
from __future__ import annotations

import secrets
import shutil
import sqlite3
import string
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deploy" / "build" / "space"
CREDS = ROOT / "deploy" / "build" / "STAFF_CREDENTIALS.txt"
sys.path.insert(0, str(ROOT / "backend"))

SPACE_README = """---
title: MegaAsset-Agentic
emoji: 🚇
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
short_description: Evidence-grounded agentic Graph-RAG for metro infrastructure
---

# MegaAsset-Agentic

Evidence-grounded agentic Graph-RAG for metro infrastructure intelligence, built on publicly available CMRL
documents and transit data. Independent project — not an official Chennai Metro Rail Limited system.

Passengers can sign up, raise complaints (English/தமிழ்) and track their own tickets. Staff accounts are not public.

Note: this free Space has no persistent disk. New complaints and accounts created here are kept until the Space
restarts, after which it returns to the published snapshot.
"""

REQS = """fastapi
uvicorn[standard]
sqlalchemy>=2.0
pydantic>=2
pydantic-settings
python-multipart
python-jose[cryptography]
bcrypt
email-validator
pymupdf
openpyxl
python-docx
numpy
scikit-learn
langgraph
fastembed
rapidocr_onnxruntime
httpx
"""


def _pw(n: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        p = "".join(secrets.choice(alphabet) for _ in range(n - 2)) + secrets.choice("!@#%") + secrets.choice(string.digits)
        if any(c.isupper() for c in p) and any(c.islower() for c in p):
            return p


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "backend" / "data").mkdir(parents=True)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache")
    shutil.copytree(ROOT / "backend" / "app", OUT / "backend" / "app", ignore=ignore)
    (OUT / "backend" / "requirements-deploy.txt").write_text(REQS)
    dist = ROOT / "frontend" / "dist"
    if not (dist / "index.html").exists():
        sys.exit("frontend/dist is missing — run `npm run build` in frontend first")
    shutil.copytree(dist, OUT / "frontend" / "dist")
    shutil.copytree(ROOT / "data" / "raw", OUT / "data" / "raw")
    shutil.copytree(ROOT / "backend" / "data" / "models", OUT / "backend" / "data" / "models",
                    ignore=shutil.ignore_patterns("*.lock", ".locks"))
    meta = ROOT / "backend" / "data" / "processed" / "index_meta.json"
    if meta.exists():
        (OUT / "backend" / "data" / "processed").mkdir(parents=True)
        shutil.copy(meta, OUT / "backend" / "data" / "processed" / "index_meta.json")
    shutil.copy(ROOT / "deploy" / "Dockerfile", OUT / "Dockerfile")
    (OUT / "README.md").write_text(SPACE_README, encoding="utf-8")
    (OUT / ".dockerignore").write_text("**/__pycache__\n**/*.pyc\n")

    # Consistent database snapshot, then rotate staff passwords inside the snapshot only
    snap = OUT / "backend" / "data" / "megaasset.db"
    src = sqlite3.connect(ROOT / "backend" / "data" / "megaasset.db")
    dst = sqlite3.connect(snap)
    src.backup(dst)
    src.close()
    from app.security import hash_password  # bcrypt, same as the app
    lines = ["MegaAsset-Agentic — staff logins for the deployed Space (keep private)", ""]
    for uid, email, role in dst.execute("SELECT id, email, role FROM users WHERE role != 'passenger' ORDER BY id").fetchall():
        pw = _pw()
        dst.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(pw), uid))
        lines.append(f"{role:<11} {email:<32} {pw}")
    dst.execute("DELETE FROM jobs WHERE status IN ('QUEUED','RUNNING')")
    dst.commit()
    dst.execute("PRAGMA journal_mode=DELETE")
    dst.execute("VACUUM")
    dst.close()
    CREDS.write_text("\n".join(lines) + "\n", encoding="utf-8")

    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file()) / 1e6
    print(f"bundle ready: {OUT}  ({size:.0f} MB)")
    print(f"staff credentials written to: {CREDS}")


if __name__ == "__main__":
    main()
