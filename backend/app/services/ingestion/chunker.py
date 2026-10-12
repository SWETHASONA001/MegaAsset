"""Structure-aware chunking. Chunks never cross a PDF page so every citation maps to one exact page."""
from __future__ import annotations

import re

TARGET = 900
MAX = 1300
OVERLAP = 160
ROWS_PER_CHUNK = 12

_heading_re = re.compile(r"^(?:#{1,6}\s+.+|(?:\d+(?:\.\d+){0,3}\.?|[IVX]+\.|[A-Z]\.)\s+[A-Z][^\n]{2,90}|[A-Z][A-Z0-9 &/,\-\(\)']{4,90})$")


def _is_heading(para: str) -> bool:
    p = para.strip()
    if len(p) > 110 or len(p) < 4 or "\n" in p:
        return False
    if p.endswith((".", ",", ";")) and not p.startswith("#"):
        return False
    return bool(_heading_re.match(p))


def _split_long(para: str) -> list[str]:
    if len(para) <= MAX:
        return [para]
    sentences = re.split(r"(?<=[.!?;])\s+", para)
    out, cur = [], ""
    for s in sentences:
        while len(s) > MAX:  # pathological unbroken text
            out.append(s[:MAX]); s = s[MAX:]
        if len(cur) + len(s) + 1 > TARGET and cur:
            out.append(cur); cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        out.append(cur)
    return out


def chunk_text_unit(text: str, page: int | None, carry_heading: str | None, ocr: bool = False):
    """Returns (chunks, last_heading). chunk = dict(text, heading, page_start, page_end, ocr)."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) <= 1 and text.count("\n") > 3:  # line-separated text (OCR, TXT)
        paras = [p.strip() for p in text.split("\n") if p.strip()]
    heading = carry_heading
    chunks, cur, cur_heading = [], [], heading

    def flush():
        nonlocal cur
        body = "\n".join(cur).strip()
        if len(body) >= 25:
            chunks.append({"text": body, "heading": cur_heading, "page_start": page, "page_end": page, "ocr": ocr})
        # overlap: keep tail of previous chunk for context continuity
        tail = body[-OVERLAP:] if len(body) > OVERLAP else ""
        cur = [tail.split(" ", 1)[-1]] if tail else []

    for para in paras:
        if _is_heading(para):
            if sum(len(c) for c in cur) > 200:
                flush()
                cur = []
            heading = para.lstrip("# ").strip()
            cur_heading = heading
            cur.append(para.lstrip("# ").strip())
            continue
        for piece in _split_long(para):
            if sum(len(c) for c in cur) + len(piece) > TARGET and cur:
                flush()
                cur_heading = heading
            cur.append(piece)
    if cur and sum(len(c) for c in cur) > 0:
        body = "\n".join(cur).strip()
        if len(body) >= 25:
            chunks.append({"text": body, "heading": cur_heading, "page_start": page, "page_end": page, "ocr": ocr})
    return chunks, heading


def chunk_rows(unit: dict) -> list[dict]:
    """Tabular data: chunk by row ranges, prefixing column header so each chunk is self-describing."""
    rows = unit.get("rows") or []
    header = unit.get("header") or []
    label = unit.get("label")
    out = []
    for i in range(0, len(rows), ROWS_PER_CHUNK):
        group = rows[i:i + ROWS_PER_CHUNK]
        body = (f"Sheet/table: {label}\n" if label else "") + "Columns: " + ", ".join(map(str, header)) + "\n" + \
            "\n".join(f"Row {r}: {t}" for r, t in group)
        out.append({"text": body, "heading": label, "page_start": unit.get("page"), "page_end": unit.get("page"),
                    "sheet": label, "row_start": group[0][0], "row_end": group[-1][0], "ocr": False})
    return out


def chunk_document(units: list[dict]) -> list[dict]:
    chunks, heading = [], None
    for u in units:
        if u.get("rows") is not None:
            chunks.extend(chunk_rows(u))
            continue
        if not u.get("text"):
            continue
        c, heading = chunk_text_unit(u["text"], u.get("page"), heading, u.get("ocr", False))
        chunks.extend(c)
    for i, c in enumerate(chunks):
        c["chunk_index"] = i
    return chunks
