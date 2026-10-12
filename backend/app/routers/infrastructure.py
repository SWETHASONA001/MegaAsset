"""Stations, assets and the CMRL network map (all derived from CMRL GTFS records)."""
from __future__ import annotations

import csv
from collections import defaultdict
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import (Asset, Complaint, Dataset, EngineerFinding, GraphEntity, GraphRelationship, Incident,
                      MaintenanceRecord, Station, StationRidership, Ticket, User)
from ..provenance import COMPLAINT_CATEGORIES
from ..security import get_current_user, has_perm, require_staff
from ..serializers import iso, station_brief

router = APIRouter(prefix="/api", tags=["infrastructure"])


@router.get("/stations")
def stations(q: str | None = None, line: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Station).order_by(Station.display_name)))
    if not has_perm(user, "ticket:read_all"):
        # Passengers only need station names to file a complaint; no operational data is exposed.
        return {"ridership_date": None, "items": [{**station_brief(s), "source": s.source} for s in rows
                                                  if not q or q.lower() in s.display_name.lower()]}
    if q:
        ql = q.lower()
        rows = [s for s in rows if ql in s.display_name.lower() or ql in s.code.lower()]
    if line:
        rows = [s for s in rows if line in (s.lines or [])]
    asset_counts = defaultdict(dict)
    for sid, atype, n in db.execute(select(Asset.station_id, Asset.asset_type, func.count()).group_by(Asset.station_id, Asset.asset_type)):
        asset_counts[sid][atype] = n
    comp_counts = dict(db.execute(select(Complaint.station_id, func.count()).group_by(Complaint.station_id)).all())
    open_counts = dict(db.execute(select(Complaint.station_id, func.count()).join(Ticket).where(Ticket.status.notin_(["RESOLVED", "CLOSED"])).group_by(Complaint.station_id)).all())
    latest = db.scalar(select(func.max(StationRidership.service_date)).where(StationRidership.is_partial.is_(False)))
    rid = dict(db.execute(select(StationRidership.station_id, StationRidership.passengers).where(StationRidership.service_date == latest, StationRidership.is_partial.is_(False))).all()) if latest else {}
    svc = (db.scalar(select(Dataset).where(Dataset.slug == "cmrl-gtfs")) or Dataset(stats={})).stats.get("station_service", {})
    return {"ridership_date": latest, "items": [{
        **station_brief(s), "official_name": s.name, "lat": s.lat, "lon": s.lon, "assets": asset_counts.get(s.id, {}),
        "complaints": comp_counts.get(s.id, 0), "open_tickets": open_counts.get(s.id, 0), "passengers": rid.get(s.id),
        "service": svc.get(s.code), "source": s.source, "provenance": s.provenance} for s in rows]}


@lru_cache(maxsize=1)
def _shapes():
    path = settings.raw_data_dir / "cmrl" / "gtfs" / "shapes.txt"
    trips = settings.raw_data_dir / "cmrl" / "gtfs" / "trips.txt"
    routes = settings.raw_data_dir / "cmrl" / "gtfs" / "routes.txt"
    colour = {r["route_id"]: (r.get("route_color") or "").strip() for r in csv.DictReader(open(routes, encoding="utf-8-sig"))}
    shape_colour = {}
    for t in csv.DictReader(open(trips, encoding="utf-8-sig")):
        c = colour.get(t["route_id"], "")
        if c:
            shape_colour[t["shape_id"]] = c
    pts = defaultdict(list)
    for r in csv.DictReader(open(path, encoding="utf-8-sig")):
        pts[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
    out = []
    seen = set()
    for sid, p in pts.items():
        p.sort()
        coords = [(round(a, 5), round(b, 5)) for _, a, b in p[::3]]
        key = (coords[0], coords[-1]) if coords else None
        rkey = (coords[-1], coords[0]) if coords else None
        if not coords or key in seen or rkey in seen:
            continue
        seen.add(key)
        out.append({"shape_id": sid, "color": "#" + shape_colour.get(sid, "94A3B8"), "points": coords})
    return out


@router.get("/network-map")
def network_map(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = [{"id": s.id, "code": s.code, "name": s.display_name, "lat": s.lat, "lon": s.lon, "lines": s.lines} for s in db.scalars(select(Station))]
    return {"stations": st, "shapes": _shapes(), "source": "data/raw/cmrl/gtfs/shapes.txt + stops.txt (DOCUMENTED)"}


@router.get("/stations/{station_id}")
def station_detail(station_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    s = db.get(Station, station_id)
    if not s:
        raise HTTPException(404, "Station not found")
    assets = [{"id": a.id, "asset_code": a.asset_code, "asset_type": a.asset_type, "name": a.name, "description": a.description,
               "source": a.source, "provenance": a.provenance, "attributes": a.attributes}
              for a in db.scalars(select(Asset).where(Asset.station_id == s.id).order_by(Asset.asset_type, Asset.name))]
    rid = [{"date": r.service_date, "day_label": r.day_label, "partial": r.is_partial, "line": r.line_name, "passengers": r.passengers,
            "source_row": r.source_row, "match": r.match_method}
           for r in db.scalars(select(StationRidership).where(StationRidership.station_id == s.id).order_by(StationRidership.service_date))]
    svc = (db.scalar(select(Dataset).where(Dataset.slug == "cmrl-gtfs")) or Dataset(stats={})).stats.get("station_service", {}).get(s.code)
    staff = has_perm(user, "ticket:read_all")
    comps = []
    if staff:
        comps = [{"id": c.id, "complaint_code": c.complaint_code, "category": c.category, "summary": c.description[:140],
                  "ticket_id": c.ticket.id if c.ticket else None, "status": c.ticket.status if c.ticket else None,
                  "priority": c.ticket.priority if c.ticket else None, "created_at": iso(c.created_at)}
                 for c in db.scalars(select(Complaint).where(Complaint.station_id == s.id).order_by(Complaint.created_at.desc()).limit(25))]
    docs = []
    ent = db.scalar(select(GraphEntity).where(GraphEntity.key == f"station:{s.code}"))
    if ent:
        for r in db.scalars(select(GraphRelationship).where(GraphRelationship.target_id == ent.id, GraphRelationship.type == "MENTIONS").order_by(GraphRelationship.weight.desc()).limit(20)):
            src = db.get(GraphEntity, r.source_id)
            docs.append({"document_id": src.ref_id, "title": src.label, "filename": src.properties.get("filename"),
                         "mentions": int(r.weight), "evidence": r.evidence[:2], "provenance": r.provenance, "method": r.method})
    incidents = [{"id": i.id, "code": i.code, "title": i.title, "severity": i.severity, "created_at": iso(i.created_at)}
                 for i in db.scalars(select(Incident).where(Incident.station_id == s.id))] if staff else []
    return {**station_brief(s), "official_name": s.name, "lat": s.lat, "lon": s.lon, "aliases": s.aliases, "source": s.source,
            "provenance": s.provenance, "assets": assets, "ridership": rid, "service": svc, "complaints": comps,
            "documents": docs, "incidents": incidents}


@router.get("/assets")
def assets(q: str | None = None, asset_type: str | None = None, station_id: int | None = None, page: int = 1, page_size: int = 50,
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_perm(user, "ticket:read_all"):
        # Passengers: only the equipment list of one station, for the optional "which equipment?" field.
        if not station_id:
            raise HTTPException(403, "Staff access required")
        rows = db.scalars(select(Asset).where(Asset.station_id == station_id).order_by(Asset.asset_type, Asset.name))
        return {"total": None, "types": {}, "items": [{"id": a.id, "name": a.name, "asset_type": a.asset_type,
                                                       "station": station_brief(a.station)} for a in rows
                                                      if not asset_type or a.asset_type == asset_type]}
    query = select(Asset)
    if q:
        query = query.where(or_(Asset.name.ilike(f"%{q}%"), Asset.asset_code.ilike(f"%{q}%"), Asset.description.ilike(f"%{q}%")))
    if asset_type:
        query = query.where(Asset.asset_type == asset_type)
    if station_id:
        query = query.where(Asset.station_id == station_id)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(Asset.station_id, Asset.asset_type, Asset.name).offset((page - 1) * page_size).limit(min(page_size, 200)))
    types = dict(db.execute(select(Asset.asset_type, func.count()).group_by(Asset.asset_type)).all())
    return {"total": total, "types": types, "items": [{
        "id": a.id, "asset_code": a.asset_code, "asset_type": a.asset_type, "name": a.name, "description": a.description,
        "station": station_brief(a.station), "source": a.source, "provenance": a.provenance, "attributes": a.attributes} for a in rows]}


@router.get("/assets/{asset_id}")
def asset_detail(asset_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    a = db.get(Asset, asset_id)
    if not a:
        raise HTTPException(404, "Asset not found")
    siblings = [{"id": x.id, "name": x.name, "asset_type": x.asset_type} for x in db.scalars(
        select(Asset).where(Asset.station_id == a.station_id, Asset.id != a.id, Asset.source_ref == a.source_ref))]
    staff = has_perm(user, "ticket:read_all")
    findings = [{"id": f.id, "ticket_id": f.ticket_id, "finding": f.finding, "root_cause": f.root_cause, "created_at": iso(f.created_at)}
                for f in db.scalars(select(EngineerFinding).where(EngineerFinding.asset_id == a.id))] if staff else []
    maint = [{"id": m.id, "work_type": m.work_type, "status": m.status, "description": m.description, "created_at": iso(m.created_at)}
             for m in db.scalars(select(MaintenanceRecord).where(MaintenanceRecord.asset_id == a.id))] if staff else []
    cat = {"lift": "lifts_escalators", "escalator": "lifts_escalators", "accessibility_ramp": "accessibility"}.get(a.asset_type)
    related = []
    if staff and cat:
        related = [{"id": c.id, "complaint_code": c.complaint_code, "summary": c.description[:120], "ticket_id": c.ticket.id if c.ticket else None,
                    "status": c.ticket.status if c.ticket else None, "created_at": iso(c.created_at)}
                   for c in db.scalars(select(Complaint).where(Complaint.station_id == a.station_id, Complaint.category == cat).limit(20))]
    topic = {"lift": "lifts", "escalator": "escalators", "accessibility_ramp": "accessibility"}.get(a.asset_type)
    docs = []
    if topic:
        ent = db.scalar(select(GraphEntity).where(GraphEntity.key == f"topic:{topic}"))
        if ent:
            for r in db.scalars(select(GraphRelationship).where(GraphRelationship.target_id == ent.id, GraphRelationship.type == "DISCUSSES").order_by(GraphRelationship.weight.desc()).limit(8)):
                src = db.get(GraphEntity, r.source_id)
                docs.append({"document_id": src.ref_id, "title": src.label, "doc_kind": src.properties.get("doc_kind"),
                             "mentions": int(r.weight), "evidence": r.evidence[:1]})
    return {"id": a.id, "asset_code": a.asset_code, "asset_type": a.asset_type, "name": a.name, "description": a.description,
            "lat": a.lat, "lon": a.lon, "station": station_brief(a.station), "source": a.source, "provenance": a.provenance,
            "attributes": a.attributes, "same_entrance": siblings, "findings": findings, "maintenance": maint,
            "related_complaints": related, "related_documents": docs,
            "data_note": "This asset is documented by reference in GTFS. Make, model, installation date, condition and maintenance history are not available in the workspace data."}
