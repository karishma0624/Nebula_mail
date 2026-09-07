import pytest
from fastapi.testclient import TestClient
from main import app
import routers.emails as emails_mod

client = TestClient(app)

def test_auth_logout_clears_credentials():
    # Setup initial cached state
    emails_mod._cached_credentials = object() # Dummy credentials
    emails_mod._cached_user_email = "testuser@nebula.local"

    # Verify status before logout
    res = client.get("/auth/status")
    assert res.status_code == 200
    assert res.json()["authenticated"] is True
    assert res.json()["email"] == "testuser@nebula.local"

    # Call logout
    logout_res = client.post("/auth/logout")
    assert logout_res.status_code == 200
    data = logout_res.json()
    assert data["status"] == "success"

    # Verify state after logout
    assert emails_mod._cached_credentials is None
    assert emails_mod._cached_user_email is None

    # Status check should now report unauthenticated
    status_res = client.get("/auth/status")
    assert status_res.status_code == 200
    assert status_res.json()["authenticated"] is False
    assert status_res.json()["email"] is None
