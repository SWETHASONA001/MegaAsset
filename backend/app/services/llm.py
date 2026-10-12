"""Optional local generative model via Ollama. Never required: when unavailable, answers are composed
extractively from retrieved passages (every sentence is quoted from a cited source)."""
from __future__ import annotations

import json
import time

import httpx

from ..config import settings

_status_cache: dict = {"t": 0, "value": None}


def llm_status(force: bool = False) -> dict:
    if not force and _status_cache["value"] and time.time() - _status_cache["t"] < 30:
        return _status_cache["value"]
    st = {"configured_model": settings.ollama_model or None, "url": settings.ollama_url, "reachable": False,
          "available_models": [], "active": False,
          "setup": "Install Ollama (https://ollama.com), run `ollama pull llama3.1:8b` (or another local model), "
                   "then set MEGAASSET_OLLAMA_MODEL in backend/.env and restart the API."}
    try:
        r = httpx.get(f"{settings.ollama_url}/api/tags", timeout=1.5)
        if r.status_code == 200:
            st["reachable"] = True
            st["available_models"] = [m["name"] for m in r.json().get("models", [])]
            st["active"] = bool(settings.ollama_model) and any(
                m == settings.ollama_model or m.split(":")[0] == settings.ollama_model for m in st["available_models"])
    except Exception:
        pass
    _status_cache.update(t=time.time(), value=st)
    return st


SYSTEM = (
    "You are MegaAsset-Agentic, an evidence-grounded analyst for metro infrastructure documents. "
    "Answer ONLY from the numbered passages. Cite every factual sentence with its passage number in square "
    "brackets, e.g. [2]. Never invent sources, page numbers, figures, costs or timelines. If the passages do not "
    "support an answer, reply exactly: 'Insufficient verified evidence to support this conclusion.' Distinguish "
    "documented facts from your own inferences, and label inferences as 'Hypothesis:'. Tender documents describe "
    "procurement scope, not completed work."
)


def generate_stream(question: str, passages: list[dict], history: list[dict] | None = None):
    """Yields text deltas from the local model. Raises on connection errors (caller falls back)."""
    ctx = "\n\n".join(f"[{p['n']}] ({p['filename']}, {p['loc']})\n{p['text']}" for p in passages)
    messages = [{"role": "system", "content": SYSTEM}]
    for h in (history or [])[-4:]:
        messages.append({"role": h["role"], "content": h["content"][:1500]})
    messages.append({"role": "user", "content": f"Passages:\n{ctx}\n\nQuestion: {question}"})
    with httpx.stream("POST", f"{settings.ollama_url}/api/chat", timeout=httpx.Timeout(120, connect=3),
                      json={"model": settings.ollama_model, "messages": messages, "stream": True,
                            "options": {"temperature": 0.1}}) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line:
                continue
            data = json.loads(line)
            delta = data.get("message", {}).get("content", "")
            if delta:
                yield delta
            if data.get("done"):
                break
