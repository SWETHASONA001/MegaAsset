"""Local embedding model + in-memory cosine index backed by embeddings persisted in SQLite.

Primary: fastembed ONNX model (default BAAI/bge-small-en-v1.5, 384-d) stored under backend/data/models.
Fallback (if the model cannot be loaded): a deterministic feature-hashing embedder, so the system still works
offline. The active embedder name is persisted; if it changes, chunks are re-embedded.
"""
from __future__ import annotations

import json
import logging
import threading

import numpy as np
from sqlalchemy import select, text

from ..config import settings

log = logging.getLogger("megaasset.embeddings")
_META = settings.processed_dir / "index_meta.json"


class _HashingEmbedder:
    name = "hashing-fallback-1024"
    dim = 1024

    def __init__(self):
        from sklearn.feature_extraction.text import HashingVectorizer
        self._v = HashingVectorizer(n_features=self.dim, ngram_range=(1, 2), alternate_sign=False,
                                    norm="l2", stop_words="english")

    def embed(self, texts):
        return self._v.transform(texts).toarray().astype(np.float32)

    def embed_query(self, text):
        return self.embed([text])[0]


class _FastEmbedder:
    def __init__(self, model_name: str):
        from fastembed import TextEmbedding
        self._m = TextEmbedding(model_name, cache_dir=str(settings.models_dir))
        self.name = model_name
        self.dim = len(next(iter(self._m.embed(["probe"]))))

    def embed(self, texts):
        return np.asarray(list(self._m.embed(list(texts), batch_size=settings.embedding_batch_size)), dtype=np.float32)

    def embed_query(self, text):
        return np.asarray(next(iter(self._m.query_embed([text]))), dtype=np.float32)


_embedder = None
_embedder_error: str | None = None
_lock = threading.Lock()


def get_embedder():
    global _embedder, _embedder_error
    with _lock:
        if _embedder is None:
            try:
                _embedder = _FastEmbedder(settings.embedding_model)
                _embedder_error = None
            except Exception as exc:  # model missing / offline
                _embedder_error = f"{type(exc).__name__}: {exc}"
                log.warning("Embedding model unavailable (%s); using hashing fallback", _embedder_error)
                _embedder = _HashingEmbedder()
        return _embedder


def embedder_status() -> dict:
    e = _embedder
    return {"loaded": e is not None, "name": getattr(e, "name", None), "dim": getattr(e, "dim", None),
            "configured": settings.embedding_model, "error": _embedder_error,
            "fallback": isinstance(e, _HashingEmbedder)}


def to_blob(vec: np.ndarray) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def read_meta() -> dict:
    try:
        return json.loads(_META.read_text())
    except Exception:
        return {}


def write_meta(**kw) -> None:
    meta = read_meta()
    meta.update(kw)
    _META.write_text(json.dumps(meta, indent=2))


class VectorIndex:
    """Holds all chunk embeddings as one normalised matrix; reloaded lazily when the index version changes."""

    def __init__(self):
        self._lock = threading.Lock()
        self._version = -1
        self.ids = np.zeros(0, dtype=np.int64)
        self.doc_ids = np.zeros(0, dtype=np.int64)
        self.matrix = np.zeros((0, 1), dtype=np.float32)
        self.current_version = 0

    def bump(self):
        with self._lock:
            self.current_version += 1

    def _load(self, engine):
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT c.id, c.document_id, c.embedding FROM document_chunks c "
                "JOIN documents d ON d.id = c.document_id WHERE c.embedding IS NOT NULL AND d.status IN ('INDEXED','PARTIAL')"
            )).fetchall()
        if not rows:
            self.ids = np.zeros(0, dtype=np.int64); self.doc_ids = np.zeros(0, dtype=np.int64)
            self.matrix = np.zeros((0, 1), dtype=np.float32)
            return
        dims = {len(r[2]) for r in rows}
        dim_bytes = max(dims, key=lambda d: sum(1 for r in rows if len(r[2]) == d))
        rows = [r for r in rows if len(r[2]) == dim_bytes]
        self.ids = np.array([r[0] for r in rows], dtype=np.int64)
        self.doc_ids = np.array([r[1] for r in rows], dtype=np.int64)
        m = np.frombuffer(b"".join(r[2] for r in rows), dtype=np.float32).reshape(len(rows), -1).copy()
        norms = np.linalg.norm(m, axis=1, keepdims=True)
        norms[norms == 0] = 1
        self.matrix = m / norms

    def search(self, engine, qvec: np.ndarray, k: int = 40, doc_filter: set[int] | None = None):
        with self._lock:
            if self._version != self.current_version:
                self._load(engine)
                self._version = self.current_version
            if self.matrix.shape[0] == 0 or self.matrix.shape[1] != qvec.shape[0]:
                return []
            q = qvec / (np.linalg.norm(qvec) or 1)
            scores = self.matrix @ q
            if doc_filter is not None:
                mask = np.isin(self.doc_ids, np.fromiter(doc_filter, dtype=np.int64))
                scores = np.where(mask, scores, -np.inf)
            k = min(k, len(scores))
            idx = np.argpartition(-scores, k - 1)[:k]
            idx = idx[np.argsort(-scores[idx])]
            return [(int(self.ids[i]), float(scores[i])) for i in idx if np.isfinite(scores[i])]

    @property
    def size(self):
        return int(self.matrix.shape[0])


vector_index = VectorIndex()
