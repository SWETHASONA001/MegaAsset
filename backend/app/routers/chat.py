"""Document assistant: persistent conversations, streamed grounded answers (SSE), and collection-wide jobs."""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import SessionLocal, get_db
from ..models import Conversation, Job, Message, User, utcnow
from ..provenance import INSUFFICIENT_MSG
from ..security import get_current_user, require_perm, require_staff
from ..serializers import iso
from ..services.answer import answer_question, llm_passages
from ..services.jobs import enqueue
from ..services.llm import generate_stream, llm_status

router = APIRouter(prefix="/api/chat", tags=["assistant"])


def _conv(c: Conversation):
    return {"id": c.id, "title": c.title, "scope": c.scope, "created_at": iso(c.created_at), "updated_at": iso(c.updated_at)}


def _msg(m: Message):
    return {"id": m.id, "role": m.role, "content": m.content, "citations": m.citations, "meta": m.meta, "created_at": iso(m.created_at)}


def _own(db, cid, user) -> Conversation:
    c = db.get(Conversation, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "Conversation not found")
    return c


@router.get("/conversations")
def conversations(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    return [_conv(c) for c in db.scalars(select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.updated_at.desc()).limit(100))]


class ConvIn(BaseModel):
    title: str | None = None
    scope: dict = {}


@router.post("/conversations")
def new_conversation(body: ConvIn, user: User = Depends(require_perm("chat:use")), db: Session = Depends(get_db)):
    c = Conversation(user_id=user.id, title=body.title or "New conversation", scope=body.scope or {})
    db.add(c)
    db.commit()
    return _conv(c)


@router.get("/conversations/{cid}")
def get_conversation(cid: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    c = _own(db, cid, user)
    msgs = db.scalars(select(Message).where(Message.conversation_id == c.id).order_by(Message.id))
    return {**_conv(c), "messages": [_msg(m) for m in msgs]}


class ConvPatch(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    scope: dict | None = None


@router.patch("/conversations/{cid}")
def patch_conversation(cid: int, body: ConvPatch, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    c = _own(db, cid, user)
    if body.title:
        c.title = body.title
    if body.scope is not None:
        c.scope = body.scope
    db.commit()
    return _conv(c)


@router.delete("/conversations/{cid}")
def delete_conversation(cid: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    c = _own(db, cid, user)
    db.delete(c)
    db.commit()
    return {"ok": True}


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    scope: dict | None = None
    retry_of: int | None = None


def _history(db, cid, exclude_id=None):
    msgs = list(db.scalars(select(Message).where(Message.conversation_id == cid).order_by(Message.id)))
    return [{"role": m.role, "content": m.content, "citations": m.citations, "meta": m.meta} for m in msgs if m.id != exclude_id][-8:]


def _sse(obj) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.post("/conversations/{cid}/ask")
def ask(cid: int, body: AskIn, user: User = Depends(require_perm("chat:use")), db: Session = Depends(get_db)):
    conv = _own(db, cid, user)
    scope = body.scope if body.scope is not None else (conv.scope or {})
    if body.scope is not None:
        conv.scope = body.scope
    user_msg = None
    if body.retry_of:  # retry: drop the failed assistant reply and answer the existing user message again
        failed = db.get(Message, body.retry_of)
        if failed and failed.conversation_id == conv.id and failed.role == "assistant":
            db.delete(failed)
            db.flush()
        history = _history(db, conv.id)
        if history and history[-1]["role"] == "user":
            history = history[:-1]
    else:
        history = _history(db, conv.id)
        user_msg = Message(conversation_id=conv.id, role="user", content=body.question)
    if user_msg:
        db.add(user_msg)
    if conv.title == "New conversation":
        conv.title = re.sub(r"\s+", " ", body.question).strip()[:70]
    conv.updated_at = utcnow()
    db.commit()
    conv_id, question, user_id = conv.id, body.question, user.id
    user_msg_id = user_msg.id if user_msg else None

    def stream():
        s = SessionLocal()
        try:
            yield _sse({"type": "status", "stage": "understanding", "message": "Understanding the question"})
            yield _sse({"type": "status", "stage": "retrieving", "message": "Searching the index (keyword + semantic)"})
            result = answer_question(s, question, scope, history, user=s.get(User, user_id))
            if user_msg_id:
                um = s.get(Message, user_msg_id)
                um.meta = {"standalone_query": result["standalone_query"]}
            yield _sse({"type": "evidence", "scope": result["scope"], "coverage": result["coverage"],
                        "strength": result["evidence_strength"], "intent": result["intent"],
                        "citations": result["citations"], "is_followup": result["is_followup"],
                        "standalone_query": result["standalone_query"]})
            yield _sse({"type": "status", "stage": "synthesising", "message": "Composing a grounded answer"})
            text = result["answer"]
            st = llm_status()
            if st["active"] and result["citations"] and not text.startswith(f"**{INSUFFICIENT_MSG}"):
                try:
                    buf = ""
                    for delta in generate_stream(question, llm_passages(result["citations"]), history):
                        buf += delta
                        yield _sse({"type": "delta", "text": delta})
                    valid = {c["n"] for c in result["citations"]}
                    cited = {int(n) for n in re.findall(r"\[(\d+)\]", buf)}
                    if not cited or not cited <= valid:
                        buf = re.sub(r"\[(\d+)\]", lambda m: m.group(0) if int(m.group(1)) in valid else "", buf)
                        result["limitations"].append("Some model citations failed validation and were removed.")
                    if not cited & valid:
                        result["limitations"].append("The local model's answer contained no valid citations; the extractive answer is shown instead.")
                        yield _sse({"type": "replace", "text": text})
                    else:
                        text = buf
                        result["mode"] = f"local LLM ({st['configured_model']})"
                except Exception as exc:
                    result["limitations"].append(f"Local LLM unavailable ({type(exc).__name__}); extractive answer shown.")
                    yield _sse({"type": "replace", "text": text})
            else:
                for part in re.split(r"(?<=\n)", text):
                    yield _sse({"type": "delta", "text": part})
            meta = {k: result.get(k) for k in ("intent", "scope", "coverage", "evidence_strength", "labels", "limitations",
                                               "conflicts", "gaps", "follow_ups", "mode", "standalone_query", "is_followup",
                                               "resolution_cases", "consulted_documents", "retrieval")}
            m = Message(conversation_id=conv_id, role="assistant", content=text, citations=result["citations"], meta=meta)
            s.add(m)
            s.commit()
            yield _sse({"type": "done", "message": _msg(m)})
        except GeneratorExit:  # client pressed "stop"
            s.rollback()
            raise
        except Exception as exc:
            s.rollback()
            m = Message(conversation_id=conv_id, role="assistant", content="", citations=[],
                        meta={"error": f"{type(exc).__name__}: {exc}"})
            s.add(m)
            s.commit()
            yield _sse({"type": "error", "message": f"Answer generation failed: {exc}", "message_id": m.id})
        finally:
            s.close()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class AnalysisIn(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    document_ids: list[int] | None = None
    categories: list[str] | None = None


@router.post("/analysis")
def start_analysis(body: AnalysisIn, user: User = Depends(require_perm("chat:use")), db: Session = Depends(get_db)):
    job = enqueue(db, "COLLECTION_ANALYSIS", body.model_dump(), user.id)
    return {"job_id": job.id}


@router.get("/analysis")
def list_analysis(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    jobs = db.scalars(select(Job).where(Job.type == "COLLECTION_ANALYSIS", Job.created_by == user.id).order_by(Job.id.desc()).limit(30))
    return [{"id": j.id, "status": j.status, "question": j.params.get("question"), "progress": j.progress, "total": j.total,
             "message": j.message, "created_at": iso(j.created_at), "finished_at": iso(j.finished_at),
             "coverage": (j.result or {}).get("coverage")} for j in jobs]
