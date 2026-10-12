import threading
import uuid

from conftest import PNG, make_passenger, raise_complaint


def act(client, h, tid, action, **kw):
    return client.post(f"/api/tickets/{tid}/actions", headers=h, json={"action": action, **kw})


def detail(client, h, tid):
    return client.get(f"/api/tickets/{tid}", headers=h).json()


def submit_work(client, h, tid, **kw):
    data = {"solution": "Realigned the door sensor bracket and re-tested the lift", "action_taken": "Replaced loose bracket bolts; ran 20 test cycles", **kw}
    return client.post(f"/api/tickets/{tid}/work", headers=h, data=data)


def test_full_lifecycle_review_reject_reopen_and_memory(client, passenger, operator, engineer, supervisor, admin, station_id):
    c = raise_complaint(client, passenger, station_id, text="Lift at entrance B1 stuck between floors, elderly passengers stranded")
    tid = c["ticket"]["id"]
    assert act(client, passenger, tid, "assign").status_code == 403
    assert act(client, operator, tid, "close").status_code == 409
    # supervisor-review policy: direct verification requests are refused
    assert act(client, operator, tid, "request_verification").status_code in (403, 409)

    assert act(client, operator, tid, "start_investigation").status_code == 200
    staff = client.get("/api/tickets/meta", headers=operator).json()["staff"]
    eng_id = next(s["id"] for s in staff if s["role"] == "engineer")
    assert act(client, operator, tid, "assign", team="Lifts & Escalators (E&M)", assignee_id=eng_id).json()["status"] == "ASSIGNED"
    assert act(client, operator, tid, "start_work").status_code == 403
    assert act(client, engineer, tid, "start_work").json()["status"] == "IN_PROGRESS"

    # investigation now includes complaint-similarity stage
    inv = client.post("/api/investigations", headers=engineer, json={"ticket_id": tid}).json()
    stages = [t["stage"] for t in inv["trace"]]
    assert "find_similar_complaints" in stages and all(t["status"] == "ok" for t in inv["trace"]), inv["trace"]

    # work submission requires solution + action
    assert client.post(f"/api/tickets/{tid}/work", headers=engineer, data={"solution": "x", "action_taken": "y"}).status_code == 422
    r = submit_work(client, engineer, tid)
    assert r.status_code == 200, r.text
    assert r.json()["ticket"]["status"] == "PENDING_REVIEW"
    # engineer cannot review own work; supervisor rejection needs a reason
    assert client.post(f"/api/tickets/{tid}/review", headers=engineer, json={"decision": "APPROVED"}).status_code == 403
    assert client.post(f"/api/tickets/{tid}/review", headers=supervisor, json={"decision": "REJECTED"}).status_code == 422
    r = client.post(f"/api/tickets/{tid}/review", headers=supervisor, json={"decision": "REJECTED", "reason": "Attach test-cycle evidence", "review_type": "MORE_EVIDENCE"})
    assert r.json()["ticket"]["status"] == "IN_PROGRESS" and r.json()["submission"]["review_type"] == "MORE_EVIDENCE"
    eng_notes = client.get("/api/notifications", headers=engineer).json()["items"]
    assert any(n["type"] == "work_reviewed" for n in eng_notes)

    # resubmit with an attachment, approve -> awaiting passenger verification
    r = client.post(f"/api/tickets/{tid}/work", headers=engineer, data={"solution": "Realigned the door sensor bracket", "action_taken": "Replaced bolts; 20 test cycles logged"},
                    files=[("files", ("cycles.png", PNG, "image/png"))])
    assert r.status_code == 200 and len(r.json()["submission"]["attachments"]) == 1
    r = client.post(f"/api/tickets/{tid}/review", headers=supervisor, json={"decision": "APPROVED", "reason": "Evidence provided"})
    assert r.json()["ticket"]["status"] == "AWAITING_VERIFICATION"
    assert any(n["type"] == "verification_requested" for n in client.get("/api/notifications", headers=passenger).json()["items"])

    # passenger still sees no internal notes (rejection reason) on their ticket
    pt = detail(client, passenger, tid)
    assert "Attach test-cycle evidence" not in str(pt["events"])

    # passenger says still exists -> reopened + counterexample
    assert client.post(f"/api/tickets/{tid}/verify", headers=passenger, json={"outcome": "STILL_EXISTS", "comment": "Still stuck"}).json()["status"] == "REOPENED"
    mem = client.get("/api/resolution-memory", headers=admin).json()
    assert any(m["ticket_id"] == tid and m["outcome"] == "FAILED_REOPENED" for m in mem["items"])

    # second attempt: engineer restarts directly, submit, approve, passenger confirms -> auto-closed
    assert act(client, engineer, tid, "start_work").json()["status"] == "IN_PROGRESS"
    submit_work(client, engineer, tid)
    client.post(f"/api/tickets/{tid}/review", headers=supervisor, json={"decision": "APPROVED"})
    r = client.post(f"/api/tickets/{tid}/verify", headers=passenger, json={"outcome": "RESOLVED"})
    assert r.json()["status"] == "CLOSED" and r.json()["closure_type"] == "PASSENGER_VERIFIED"
    mem = client.get("/api/resolution-memory?outcome=VERIFIED_RESOLVED", headers=admin).json()
    case = next(m for m in mem["items"] if m["ticket_id"] == tid)
    assert case["approved_action"] and case["reviewer"]["role"] == "supervisor"
    types = [e["event_type"] for e in detail(client, admin, tid)["events"]]
    for t in ("WORK_SUBMITTED", "WORK_REJECTED", "WORK_APPROVED", "VERIFIED_STILL_EXISTS", "VERIFIED_RESOLVED", "AUTO_CLOSED"):
        assert t in types, t


def test_self_assignment_records_assignment(client, passenger, engineer, station_id):
    c = raise_complaint(client, passenger, station_id, category="cleanliness", text="Spilled oil near platform 1 stairs is slippery")
    tid = c["ticket"]["id"]
    assert act(client, engineer, tid, "start_work").json()["status"] == "IN_PROGRESS"
    d = detail(client, engineer, tid)
    assert d["assignee"]["role"] == "engineer"
    assert [e["event_type"] for e in d["events"]][:3] == ["COMPLAINT_RECEIVED", "ASSIGNED", "WORK_STARTED"]


def test_optimistic_concurrency_and_duplicate_actions(client, passenger, operator, station_id):
    c = raise_complaint(client, passenger, station_id, category="ticketing", text="QR ticket gate did not open at gate 3 twice today")
    tid = c["ticket"]["id"]
    v = detail(client, operator, tid)["version"]
    assert act(client, operator, tid, "start_investigation", expected_version=v).status_code == 200
    # stale version -> conflict, no change applied
    r = act(client, operator, tid, "assign", expected_version=v)
    assert r.status_code == 409 and "updated by someone else" in r.json()["detail"]
    # simultaneous identical requests: exactly one succeeds
    v2 = detail(client, operator, tid)["version"]
    results = []

    def go():
        results.append(act(client, operator, tid, "assign", expected_version=v2).status_code)
    ts = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert results.count(200) == 1 and all(r == 409 for r in results if r != 200), results
    assert sum(1 for e in detail(client, operator, tid)["events"] if e["event_type"] == "ASSIGNED") == 1


def test_idempotent_complaint_submission(client, station_id):
    p = make_passenger(client, f"idem.{uuid.uuid4().hex[:6]}@example.com")
    key = uuid.uuid4().hex
    a = raise_complaint(client, p, station_id, text="Escalator at gate A2 running in wrong direction", client_request_id=key)
    b = raise_complaint(client, p, station_id, text="Escalator at gate A2 running in wrong direction", client_request_id=key)
    assert a["id"] == b["id"] and b.get("duplicate_request") is True
    assert client.get("/api/complaints?mine=true", headers=p).json()["total"] == 1


def test_admin_close_is_explicit_and_audited(client, passenger, operator, admin, station_id):
    c = raise_complaint(client, passenger, station_id, category="other", text="Duplicate report submitted by mistake, please ignore")
    tid = c["ticket"]["id"]
    assert client.post(f"/api/tickets/{tid}/admin-close", headers=operator, json={"reason": "Duplicate of an existing ticket"}).status_code == 403
    assert client.post(f"/api/tickets/{tid}/admin-close", headers=admin, json={"reason": "short"}).status_code == 422
    r = client.post(f"/api/tickets/{tid}/admin-close", headers=admin, json={"reason": "Duplicate of an existing ticket"})
    assert r.json()["status"] == "CLOSED" and r.json()["closure_type"] == "ADMIN_CLOSED"
    audit = client.get("/api/admin/audit", headers=admin).json()
    assert any(a["action"] == "ticket.admin_closed" for a in audit)
    mem = client.get("/api/resolution-memory", headers=admin).json()
    assert not any(m["ticket_id"] == tid for m in mem["items"])  # never recorded as a verified resolution


def test_station_activity_counts_follow_status(client, passenger, operator, admin, station_id):
    def counts():
        return next(s for s in client.get("/api/stations/activity", headers=operator).json()["items"] if s["id"] == station_id)
    before = counts()
    c = raise_complaint(client, passenger, station_id, category="station_facilities", text="Drinking water dispenser near platform is broken")
    mid = counts()
    assert mid["active_complaints"] == before["active_complaints"] + 1 and mid["open_tickets"] == before["open_tickets"] + 1
    client.post(f"/api/tickets/{c['ticket']['id']}/admin-close", headers=admin, json={"reason": "Closed for counting test verification"})
    after = counts()
    assert after["active_complaints"] == before["active_complaints"] and after["total_complaints"] == mid["total_complaints"]


def test_similar_complaints_linked_not_merged(client, operator, station_id):
    p = make_passenger(client, f"sim.{uuid.uuid4().hex[:6]}@example.com")
    a = raise_complaint(client, p, station_id, text="The lift is not working at this station since morning")
    b = raise_complaint(client, p, station_id, text="lift is not working again")
    sim = client.get(f"/api/tickets/{b['ticket']['id']}/similar", headers=operator).json()
    match = next(x for x in sim["items"] if x["id"] == a["id"])
    assert match["same_station"] and match["similarity"] >= sim["threshold"]
    assert a["ticket"]["id"] != b["ticket"]["id"]  # separate records


def test_reported_asset_and_inventory_tiers(client, passenger, operator, station_id):
    assets = client.get(f"/api/assets?station_id={station_id}&asset_type=escalator", headers=passenger).json()["items"]
    esc = assets[0]
    c = raise_complaint(client, passenger, station_id, text="Escalator near this entrance stopped suddenly", asset_id=esc["id"])
    assert c["reported_asset"]["id"] == esc["id"] and c["reported_asset"]["provenance"] == "REPORTED"
    other_station_asset = client.get("/api/assets?asset_type=escalator&page_size=200", headers=operator).json()["items"]
    foreign = next(x for x in other_station_asset if x["station"]["id"] != station_id)
    bad = client.post("/api/complaints", headers=passenger, data={"description": "Escalator stopped suddenly here", "station_id": station_id,
                                                                  "category": "lifts_escalators", "asset_id": foreign["id"]})
    assert bad.status_code == 422
    inv = client.get(f"/api/stations/{station_id}/inventory", headers=operator).json()
    esc_cat = next(x for x in inv["categories"] if x["asset_type"] == "escalator")
    assert esc_cat["document_derived_count"] >= 1 and esc_cat["reported_unverified"] >= 1 and esc_cat["verified_count"] == 0
    assert next(x for x in inv["categories"] if x["asset_type"] == "platform")["inventory_status"] == "Not inventoried"
