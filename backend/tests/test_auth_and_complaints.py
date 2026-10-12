from conftest import PNG, make_passenger, raise_complaint


def test_signup_login_me(client):
    h = make_passenger(client, "alice@example.com")
    me = client.get("/api/auth/me", headers=h).json()
    assert me["user"]["role"] == "passenger"
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/signup", json={"full_name": "A", "email": "alice@example.com", "password": "Passw0rd!x"}).status_code in (409, 422)
    assert client.post("/api/auth/signup", json={"full_name": "Bob", "email": "bob@example.com", "password": "onlyletters"}).status_code == 422
    assert client.get("/api/auth/me").status_code == 401


def test_stations_come_from_gtfs(client, passenger):
    items = client.get("/api/stations", headers=passenger).json()["items"]
    assert len(items) == 41
    assert all(s["source"].startswith("data/raw/cmrl/gtfs/stops.txt") for s in items)


def test_complaint_creates_ticket_attachment_and_notification(client, passenger, station_id):
    c = raise_complaint(client, passenger, station_id, files=[("images", ("photo.png", PNG, "image/png"))])
    assert c["complaint_code"].startswith("CMP-") and len(c["complaint_code"]) == 12
    assert c["ticket"]["ticket_code"].startswith("TKT-")
    assert c["ticket"]["status"] == "RECEIVED"
    assert len(c["attachments"]) == 1
    att = client.get(c["attachments"][0]["url"], headers=passenger)
    assert att.status_code == 200 and att.content == PNG
    notes = client.get("/api/notifications", headers=passenger).json()
    assert any(n["type"] == "complaint_submitted" for n in notes["items"])
    mine = client.get("/api/complaints?mine=true", headers=passenger).json()
    assert any(x["id"] == c["id"] for x in mine["items"])
    detail = client.get(f"/api/tickets/{c['ticket']['id']}", headers=passenger).json()
    assert detail["events"][0]["event_type"] == "COMPLAINT_RECEIVED"


def test_attachment_validation_and_isolation(client, passenger, station_id):
    bad = client.post("/api/complaints", headers=passenger, data={"description": "Escalator broken at the station entrance", "station_id": station_id, "category": "lifts_escalators"},
                      files=[("images", ("evil.png", b"MZ\x90\x00not-a-png", "image/png"))])
    assert bad.status_code == 422
    exe = client.post("/api/complaints", headers=passenger, data={"description": "Escalator broken at the station entrance", "station_id": station_id, "category": "lifts_escalators"},
                      files=[("documents", ("../../x.exe", b"MZ", "application/octet-stream"))])
    assert exe.status_code == 422
    assert client.post("/api/complaints", headers=passenger, data={"description": "short", "station_id": station_id, "category": "lifts_escalators"}).status_code == 422
    assert client.post("/api/complaints", headers=passenger, data={"description": "A valid long description", "station_id": 99999, "category": "lifts_escalators"}).status_code == 422
    c = raise_complaint(client, passenger, station_id, files=[("images", ("p.png", PNG, "image/png"))])
    other = make_passenger(client, "mallory@example.com")
    assert client.get(c["attachments"][0]["url"], headers=other).status_code == 403
    assert client.get(f"/api/complaints/{c['id']}", headers=other).status_code == 403
    assert client.get(f"/api/tickets/{c['ticket']['id']}", headers=other).status_code == 403


def test_role_based_access(client, passenger, operator):
    assert client.get("/api/admin/users", headers=operator).status_code == 403
    assert client.get("/api/graph", headers=passenger).status_code == 403
    assert client.get("/api/investigations", headers=passenger).status_code == 403
    assert client.post("/api/documents/ingest", headers=operator).status_code == 403


MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64


def test_video_upload_validation(client, passenger, station_id):
    ok = raise_complaint(client, passenger, station_id, files=[("videos", ("clip.mp4", MP4, "video/mp4"))])
    assert ok["attachments"][0]["kind"] == "video"
    r = client.get(ok["attachments"][0]["url"], headers=passenger)
    assert r.status_code == 200 and r.content == MP4
    fake = client.post("/api/complaints", headers=passenger, data={"description": "Escalator broken at the station entrance", "station_id": station_id, "category": "lifts_escalators"},
                       files=[("videos", ("clip.mp4", b"this is not a video at all" * 4, "video/mp4"))])
    assert fake.status_code == 422
    too_many = [("videos", (f"c{i}.mp4", MP4, "video/mp4")) for i in range(3)]
    r = client.post("/api/complaints", headers=passenger, data={"description": "Escalator broken at the station entrance", "station_id": station_id, "category": "lifts_escalators"}, files=too_many)
    assert r.status_code == 422


def test_document_upload_permissions_and_validation(client, passenger, operator):
    pdf = b"%PDF-1.4\n%fake\n"
    assert client.post("/api/documents/upload", headers=passenger, files=[("files", ("a.pdf", pdf, "application/pdf"))]).status_code == 403
    assert client.post("/api/documents/upload", headers=operator, files=[("files", ("a.exe", b"MZ", "application/octet-stream"))]).status_code == 422
    assert client.post("/api/documents/upload", headers=operator, files=[("files", ("b.pdf", b"not a pdf", "application/pdf"))]).status_code == 422
    r = client.post("/api/documents/upload", headers=operator, files=[("files", ("../../evil name.txt", b"Uploaded note about platform screen doors.", "text/plain"))])
    assert r.status_code == 200 and "/" not in r.json()["saved"][0] and ".." not in r.json()["saved"][0]
    from app.services.jobs import run_pending_sync
    run_pending_sync()  # index the upload now so later incremental-ingestion tests start from a clean state
    docs = {d["filename"]: d for d in client.get("/api/documents?page_size=500", headers=operator).json()["items"]}
    assert docs[r.json()["saved"][0]]["status"] == "INDEXED"


def test_passenger_sees_only_ticket_data(client, passenger, station_id):
    """Passengers may file complaints and follow their own tickets; every other area is staff-only."""
    blocked = ["/api/documents", "/api/documents/stats", "/api/documents/1", "/api/datasets", "/api/models",
               "/api/operations/ridership", "/api/operations/service", "/api/network-map", f"/api/stations/{station_id}",
               "/api/stations/activity", f"/api/stations/{station_id}/inventory", "/api/assets", "/api/assets/1",
               "/api/chat/conversations", "/api/graph", "/api/investigations", "/api/risk/signals", "/api/analytics",
               "/api/resolution-memory", "/api/work/queue", "/api/review/queue", "/api/documents/1/file"]
    for path in blocked:
        assert client.get(path, headers=passenger).status_code in (401, 403), path
    assert client.post("/api/chat/conversations", headers=passenger, json={}).status_code == 403
    # what the complaint form needs: station names and that station's equipment — nothing operational
    st = client.get("/api/stations", headers=passenger).json()["items"]
    assert st and set(st[0]) <= {"id", "code", "name", "lines", "source"}
    eq = client.get(f"/api/assets?station_id={station_id}", headers=passenger).json()["items"]
    assert eq and set(eq[0]) == {"id", "name", "asset_type", "station"}
    ov = client.get("/api/overview", headers=passenger).json()
    assert ov["scope"] == "mine" and "documents" not in ov and "ridership" not in ov
    assert all(r["type"] == "ticket" for r in client.get("/api/search?q=metro", headers=passenger).json()["results"])
