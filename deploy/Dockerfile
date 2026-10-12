```dockerfile
# Build the React frontend
FROM node:22-slim AS frontend-build

WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Run the FastAPI application
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/app/ /app/backend/app/
COPY data/raw/ /app/data/raw/
COPY --from=frontend-build /src/frontend/dist/ /app/frontend/dist/

ENV PYTHONUNBUFFERED=1
ENV MEGAASSET_CREATE_DEMO_STAFF=false
ENV MEGAASSET_AUTO_INGEST_ON_STARTUP=false

EXPOSE 10000

CMD ["sh", "-c", "uvicorn app.main:app --app-dir /app/backend --host 0.0.0.0 --port ${PORT:-10000}"]
```