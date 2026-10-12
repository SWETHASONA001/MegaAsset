"""Metro operations: ridership series, hourly flow, service stats, incidents and maintenance records."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (Dataset, Document, HourlyRidership, Incident, MaintenanceRecord, RidershipMonthly, Station,
                      StationRidership, Ticket, User)
from ..security import get_current_user, require_staff
from ..serializers import document_dict, iso, station_brief
from ..services.common import user_brief

router = APIRouter(prefix="/api/operations", tags=["operations"])


@router.get("/ridership")
def ridership(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    monthly = [{"month": r.month_label, "month_start": r.month_start, "closed_loop": r.closed_loop, "qr": r.qr, "ncmc": r.ncmc,
                "total": r.total, "source_row": r.source_row}
               for r in db.scalars(select(RidershipMonthly).order_by(RidershipMonthly.month_start))]
    hourly = [{"date": h.service_date, "partial": h.is_partial, "hour": h.hour, "total": h.total}
              for h in db.scalars(select(HourlyRidership).order_by(HourlyRidership.service_date, HourlyRidership.hour))]
    latest = db.scalar(select(func.max(StationRidership.service_date)).where(StationRidership.is_partial.is_(False)))
    stations = []
    if latest:
        for r in db.scalars(select(StationRidership).where(StationRidership.service_date == latest).order_by(StationRidership.passengers.desc())):
            stations.append({"station_name": r.station_name, "station_id": r.station_id, "line": r.line_name, "passengers": r.passengers,
                             "source_row": r.source_row, "match": r.match_method})
    by_line = {}
    for s in stations:
        by_line[s["line"]] = by_line.get(s["line"], 0) + s["passengers"]
    ds = {d.slug: d for d in db.scalars(select(Dataset))}
    # Year-over-year derived metrics (PROCESSED)
    derived = {}
    if len(monthly) >= 2:
        last, prev = monthly[-1], monthly[-2]
        if last["total"] and prev["total"]:
            derived["mom_change_pct"] = round((last["total"] - prev["total"]) / prev["total"] * 100, 1)
        yoy = next((m for m in monthly if m["month_start"][5:7] == last["month_start"][5:7] and int(m["month_start"][:4]) == int(last["month_start"][:4]) - 1), None)
        if yoy and yoy["total"] and last["total"]:
            derived["yoy_change_pct"] = round((last["total"] - yoy["total"]) / yoy["total"] * 100, 1)
            derived["yoy_month"] = yoy["month"]
        derived["latest_month"] = last["month"]
        derived["latest_total"] = last["total"]
        derived["peak_month"] = max(monthly, key=lambda m: m["total"] or 0)["month"]
    return {"monthly": monthly, "hourly": hourly, "station_date": latest, "stations": stations, "by_line": by_line,
            "derived": derived,
            "sources": {k: {"name": v.name, "path": v.rel_path, "scope": v.scope} for k, v in ds.items() if k in ("cmrl-monthly-ridership", "cmrl-passenger-flow")},
            "summary": (ds.get("cmrl-passenger-flow").stats.get("summary") if ds.get("cmrl-passenger-flow") else None)}


@router.get("/service")
def service(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    ds = db.scalar(select(Dataset).where(Dataset.slug == "cmrl-gtfs"))
    if not ds:
        return {"available": False}
    st = ds.stats
    by_line = {}
    for r in st.get("route_stats", []):
        by_line.setdefault(r["line"], {"routes": 0, "trips": 0})
        by_line[r["line"]]["routes"] += 1
        by_line[r["line"]]["trips"] += r["trips"]
    return {"available": True, "stations": st.get("stations"), "entrances": st.get("entrances"), "routes": st.get("routes"),
            "trips": st.get("trips"), "stop_times": st.get("stop_times"), "by_line": by_line, "route_stats": st.get("route_stats"),
            "calendar": st.get("calendar"), "note": st.get("note")}


@router.get("/incidents")
def incidents(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = []
    for i in db.scalars(select(Incident).order_by(Incident.created_at.desc())):
        rows.append({"id": i.id, "code": i.code, "title": i.title, "description": i.description, "severity": i.severity,
                     "status": i.status, "provenance": i.provenance, "ticket_id": i.ticket_id,
                     "station": station_brief(db.get(Station, i.station_id)) if i.station_id else None,
                     "recorded_by": user_brief(db.get(User, i.recorded_by)), "created_at": iso(i.created_at)})
    return {"items": rows, "note": "Incidents are recorded only when an engineer confirms one in a ticket finding. Passenger complaints alone are not treated as incidents."}


@router.get("/maintenance")
def maintenance(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    work = [{"id": m.id, "work_type": m.work_type, "description": m.description, "status": m.status, "provenance": m.provenance,
             "ticket_id": m.ticket_id, "ticket_code": db.get(Ticket, m.ticket_id).ticket_code if m.ticket_id else None,
             "station": station_brief(db.get(Station, m.station_id)) if m.station_id else None,
             "performed_by": user_brief(db.get(User, m.performed_by)), "created_at": iso(m.created_at)}
            for m in db.scalars(select(MaintenanceRecord).order_by(MaintenanceRecord.created_at.desc()))]
    procurement = [document_dict(d) for d in db.scalars(select(Document).where(
        Document.category.in_(["Maintenance Procurement", "Contracts & Tenders"])).order_by(Document.filename))]
    return {"work_records": work, "procurement_documents": procurement,
            "note": "Procurement documents (tenders, addenda, corrigenda, pre-bid replies) describe intended maintenance scope. They are not evidence that maintenance was performed."}
