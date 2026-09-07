import uuid
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app
from auth.session import create_session_token, verify_session_token, set_user_credentials, clear_user_session, get_user_credentials

client = TestClient(app)

def test_session_token_generation_and_verification():
    uid = str(uuid.uuid4())
    token = create_session_token(uid, "user_alpha@example.com")
    assert token is not None
    payload = verify_session_token(token)
    assert payload is not None
    assert payload["user_id"] == uid
    assert payload["email"] == "user_alpha@example.com"

    # Tampered token should fail
    tampered = token[:-4] + "xxxx"
    assert verify_session_token(tampered) is None

def test_multi_user_session_isolation():
    user_a_id = str(uuid.uuid4())
    user_b_id = str(uuid.uuid4())
    user_a_email = "alice@example.com"
    user_b_email = "bob@example.com"

    token_a = create_session_token(user_a_id, user_a_email)
    token_b = create_session_token(user_b_id, user_b_email)

    mock_creds_a = MagicMock()
    mock_creds_a.valid = True
    mock_creds_a.expired = False
    mock_creds_b = MagicMock()
    mock_creds_b.valid = True
    mock_creds_b.expired = False

    set_user_credentials(user_a_id, mock_creds_a)
    set_user_credentials(user_b_id, mock_creds_b)

    # Both users exist independently in credentials cache
    assert get_user_credentials(user_a_id) == mock_creds_a
    assert get_user_credentials(user_b_id) == mock_creds_b

    # Status check with token A returns alice
    with patch("routers.emails._cached_credentials", None):
        res_a = client.get("/auth/status", headers={"Authorization": f"Bearer {token_a}"})
        assert res_a.status_code == 200
        data_a = res_a.json()
        assert data_a["authenticated"] is True
        assert data_a["email"] == user_a_email

        # Status check with token B returns bob
        res_b = client.get("/auth/status", headers={"Authorization": f"Bearer {token_b}"})
        assert res_b.status_code == 200
        data_b = res_b.json()
        assert data_b["authenticated"] is True
        assert data_b["email"] == user_b_email

        # Alice logs out
        with patch("auth.session.get_supabase") as mock_get_supabase:
            mock_sb = MagicMock()
            mock_get_supabase.return_value = mock_sb
            table_mock = MagicMock()
            mock_sb.table.return_value = table_mock
            delete_mock = MagicMock()
            table_mock.delete.return_value = delete_mock
            eq_mock = MagicMock()
            delete_mock.eq.return_value = eq_mock
            eq_mock.execute.return_value = MagicMock()

            logout_res = client.post("/auth/logout", headers={"Authorization": f"Bearer {token_a}"})
            assert logout_res.status_code == 200

            # Verify that supabase delete was called targeting ONLY alice, NOT all users
            delete_mock.eq.assert_called_with("user_id", user_a_id)

        # Alice is now logged out
        res_a_after = client.get("/auth/status", headers={"Authorization": f"Bearer {token_a}"})
        assert res_a_after.status_code == 200
        assert res_a_after.json()["authenticated"] is False

        # BOB IS STILL CONNECTED! His session is completely unaffected!
        res_b_after = client.get("/auth/status", headers={"Authorization": f"Bearer {token_b}"})
        assert res_b_after.status_code == 200
        assert res_b_after.json()["authenticated"] is True
        assert res_b_after.json()["email"] == user_b_email
