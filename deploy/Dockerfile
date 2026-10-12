# MegaAsset-Agentic — container for Hugging Face Spaces (Docker SDK).
# The bundle (built by deploy/build_space.py) already contains the built UI, the indexed database snapshot
# and the local ONNX models, so the container starts serving immediately without re-indexing.
FROM python:3.11-slim

# OpenCV (used by RapidOCR) needs these shared libraries
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces runs containers as uid 1000
RUN useradd -m -u 1000 app
WORKDIR /app

COPY --chown=app:app backend/requirements-deploy.txt backend/requirements-deploy.txt
RUN pip install --no-cache-dir -r backend/requirements-deploy.txt

COPY --chown=app:app . .
RUN mkdir -p backend/data/processed data/uploads/documents data/uploads/images data/uploads/videos data/uploads/attachments \
    && chown -R app:app /app
USER app

ENV MEGAASSET_CREATE_DEMO_STAFF=false \
    MEGAASSET_AUTO_INGEST_ON_STARTUP=false \
    MEGAASSET_INGEST_WORKERS=2 \
    MEGAASSET_CORS_ORIGINS="" \
    HF_HUB_OFFLINE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 7860
WORKDIR /app/backend
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
