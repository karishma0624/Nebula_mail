import sys
import os
import json
import uuid
import datetime
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from googleapiclient.errors import HttpError

# Ensure agent directory is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from agent.tools import (
    prepare_meeting, PrepareMeetingArgs,
    prepare_bulk_send, PrepareBulkSendInput,
    draft_compose, DraftComposeInput,
    prepare_send, PrepareSendInput,
    search_emails, SearchEmailsInput,
    open_email, OpenEmailInput,
)
from agent.pii import redact_pii_recursive
from agent.errors import log_agent_error
from routers.emails import _send_single_email, save_composed_draft, get_composed_draft


# =====================================================================
# Fixtures & Helpers
# =====================================================================

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
OTHER_USER_ID = "00000000-0000-0000-0000-000000000002"

@pytest.fixture
def client():
    return TestClient(app)

class MockSupabaseTable:
    def __init__(self, data=None):
        self._data = [dict(d) for d in (data if data is not None else [])]
        self._query_filters = {}
        self._selected_cols = "*"
        self._pending_update = None
        self._pending_insert = None
        self._is_delete = False
        self._order_col = None
        self._limit_val = None

    def select(self, cols="*"):
        self._selected_cols = cols
        return self

    def insert(self, record):
        self._pending_insert = record
        return self

    def update(self, updates):
        self._pending_update = updates
        return self

    def delete(self):
        self._is_delete = True
        return self

    def eq(self, col, val):
        self._query_filters[col] = val
        return self

    def in_(self, col, vals):
        self._query_filters["_in"] = (col, vals)
        return self

    def order(self, col, desc=False):
        self._order_col = col
        return self

    def limit(self, val):
        self._limit_val = val
        return self

    def execute(self):
        # 1. Handle insert
        if self._pending_insert is not None:
            rec = self._pending_insert
            self._pending_insert = None
            if isinstance(rec, list):
                self._data.extend([dict(r) for r in rec])
                ret_data = rec
            else:
                self._data.append(dict(rec))
                ret_data = [rec]
            res = MagicMock()
            res.data = ret_data
            self._query_filters = {}
            return res

        # 2. Filter data
        matching_indices = []
        for idx, item in enumerate(self._data):
            match = True
            for k, v in self._query_filters.items():
                if k == "_in":
                    col, vals = v
                    if item.get(col) not in vals:
                        match = False
                elif item.get(k) != v:
                    match = False
            if match:
                matching_indices.append(idx)

        # 3. Handle delete
        if self._is_delete:
            self._is_delete = False
            self._data = [item for idx, item in enumerate(self._data) if idx not in matching_indices]
            res = MagicMock()
            res.data = []
            self._query_filters = {}
            return res

        # 4. Handle update
        if self._pending_update is not None:
            updates = self._pending_update
            self._pending_update = None
            updated = []
            for idx in matching_indices:
                self._data[idx].update(updates)
                updated.append(self._data[idx].copy())
            res = MagicMock()
            res.data = updated
            self._query_filters = {}
            return res

        # 5. Handle select
        filtered = [self._data[idx] for idx in matching_indices]
        if self._limit_val:
            filtered = filtered[:self._limit_val]
        res = MagicMock()
        res.data = filtered
        self._query_filters = {}
        return res


class MockSupabaseClient:
    def __init__(self):
        self.tables = {
            "users": MockSupabaseTable([{"id": TEST_USER_ID, "email": "test@example.com", "send_mode": "confirm"}]),
            "restricted_senders": MockSupabaseTable([]),
            "meeting_drafts": MockSupabaseTable([]),
            "agent_tool_calls": MockSupabaseTable([]),
            "agent_errors": MockSupabaseTable([]),
            "emails": MockSupabaseTable([]),
            "agent_visible_emails": MockSupabaseTable([]),
            "agent_visible_attachments": MockSupabaseTable([]),
        }

    def table(self, name):
        if name not in self.tables:
            self.tables[name] = MockSupabaseTable([])
        return self.tables[name]


# =====================================================================
# EVALUATOR PHRASE TESTS
# =====================================================================

def test_eval_phrase_1_meeting_scheduling_with_meet_link():
    """
    Evaluator Phrase 1:
    'Schedule a meeting with john@example.com tomorrow at 3pm about the project sync and email him the invite with the Meet link'
    → draft_compose (body with {meet_link}) then prepare_meeting(attendees=['john@example.com'], ...)
    → Calendar API is NEVER called during planning or prepare_meeting.
    """
    from agent.graph import parse_deterministic_intent

    user_msg = "Schedule a meeting with john@example.com tomorrow at 3pm about the project sync and email him the invite with the Meet link"
    mock_db = MockSupabaseClient()
    with (
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID)
    ):
        tc, reply = parse_deterministic_intent(user_msg, {"open_email": None}, user_id=TEST_USER_ID)

        # Must select tool calls
        assert tc is not None
        tc_list = tc if isinstance(tc, list) else [tc]

        # Verify draft_compose call exists with {meet_link} placeholder
        compose_calls = [c for c in tc_list if c["name"] == "draft_compose"]
        assert len(compose_calls) > 0
        compose_args = compose_calls[0]["arguments"]
        assert "{meet_link}" in compose_args.get("body", "")
        assert "https://meet.google.com" not in compose_args.get("body", "")

        # Verify prepare_meeting call exists
        meeting_calls = [c for c in tc_list if c["name"] == "prepare_meeting"]
        assert len(meeting_calls) > 0
        meeting_args = meeting_calls[0]["arguments"]
        assert "john@example.com" in meeting_args.get("attendees", [])
        assert "{meet_link}" in meeting_args.get("email_body_template", "")

        # Linked email_draft_id matches draft_compose draft_id
        assert meeting_args.get("email_draft_id") == compose_args.get("draft_id")

        # Verify executing prepare_meeting directly NEVER calls Calendar API
        with patch("routers.calendar.build") as mock_cal_build:
            res = prepare_meeting(
                PrepareMeetingArgs(
                    title=meeting_args["title"],
                    start_time=datetime.datetime.now(datetime.timezone.utc),
                    end_time=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1),
                    attendees=meeting_args["attendees"],
                    email_body_template=meeting_args["email_body_template"],
                    email_draft_id=meeting_args["email_draft_id"]
                ),
                user_id=TEST_USER_ID
            )
            # Assert Calendar API was never touched
            mock_cal_build.assert_not_called()
            assert res["status"] == "pending_approval"
            assert res["requires_human_confirmation"] is True


def test_eval_phrase_2_restricted_sender_confidential_search():
    """
    Evaluator Phrase 2:
    'Show me emails from [an address marked restricted in the test fixture]'
    → search_emails runs normally, agent_visible_emails returns zero rows,
      the reply states exact confidential wording: 'That contact is marked confidential — I can't access or act on this email.'
    """
    from agent.graph import parse_deterministic_intent

    mock_db = MockSupabaseClient()
    # Add restricted contact
    mock_db.table("restricted_senders").insert({
        "id": str(uuid.uuid4()),
        "user_id": TEST_USER_ID,
        "email_address": "confidential.boss@enterprise.com",
        "label": "Confidential Executive"
    }).execute()

    user_msg = "Show me emails from confidential.boss@enterprise.com"
    with (
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID)
    ):
        tc, reply = parse_deterministic_intent(user_msg, {"open_email": None}, user_id=TEST_USER_ID)
        # The response must contain the exact mandated confidential notice
        assert "That contact is marked confidential — I can't access or act on this email." in reply


def test_eval_phrase_3_batch_update_bulk_confirmation():
    """
    Evaluator Phrase 3:
    'Send a quick update to alice@example.com, bob@example.com, and charlie@example.com'
    → draft_compose x3, then prepare_bulk_send for ONE combined confirmation screen,
      not three separate modals.
    """
    from agent.graph import parse_deterministic_intent

    user_msg = "Send a quick update to alice@example.com, bob@example.com, and charlie@example.com saying we deployed the fix"
    mock_db = MockSupabaseClient()

    with (
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID)
    ):
        tc, reply = parse_deterministic_intent(user_msg, {"open_email": None}, user_id=TEST_USER_ID)
        assert tc is not None
        tc_list = tc if isinstance(tc, list) else [tc]

        # 3 draft_compose calls
        compose_calls = [c for c in tc_list if c["name"] == "draft_compose"]
        assert len(compose_calls) == 3

        # 1 prepare_bulk_send call combining all 3 drafts
        bulk_calls = [c for c in tc_list if c["name"] == "prepare_bulk_send"]
        assert len(bulk_calls) == 1
        draft_ids = bulk_calls[0]["arguments"].get("draft_ids", [])
        assert len(draft_ids) == 3
        assert "combined" in reply.lower() or "batch" in reply.lower()


# =====================================================================
# SAFETY & RELIABILITY REGRESSION TESTS (A - H)
# =====================================================================

def test_regression_a_unapproved_bulk_send_zero_gmail_calls(client):
    """
    Safety Regression A:
    A direct POST to /emails/bulk_send without server-side approval must produce ZERO Gmail send API calls.
    """
    mock_db = MockSupabaseClient()
    unapproved_batch_id = str(uuid.uuid4())

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.emails.GmailClient") as mock_gmail,
    ):
        mock_gmail_inst = mock_gmail.return_value
        resp = client.post("/emails/bulk_send", json={
            "batch_id": unapproved_batch_id,
            "draft_ids": ["draft-1", "draft-2"]
        })
        assert resp.status_code == 400
        assert "never prepared" in str(resp.json()["detail"]).lower()
        # Crucial assertion: ZERO Gmail send calls occurred
        mock_gmail_inst.send_message.assert_not_called()


def test_regression_b_approved_bulk_send_exactly_one_send_per_draft(client):
    """
    Safety Regression B:
    Approved bulk send invokes _send_single_email exactly once per approved draft
    and logs each attempt as its own agent_tool_calls row.
    """
    mock_db = MockSupabaseClient()
    batch_id = str(uuid.uuid4())
    draft_ids = ["draft-b1", "draft-b2", "draft-b3"]

    # Register drafts
    for d_id in draft_ids:
        save_composed_draft(d_id, {
            "draft_id": d_id,
            "to": f"{d_id}@example.com",
            "subject": f"Subject {d_id}",
            "body": f"Body for {d_id}",
            "user_id": TEST_USER_ID
        })

    # Server-side pending approval in agent_tool_calls
    mock_db.table("agent_tool_calls").insert({
        "id": batch_id,
        "user_id": TEST_USER_ID,
        "tool_name": "prepare_bulk_send",
        "arguments": {"draft_ids": draft_ids},
        "status": "pending_approval"
    }).execute()

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.emails._send_single_email") as mock_single_send,
    ):
        mock_single_send.return_value = {"status": "sent", "result": {"id": "gmail-ok"}}
        resp = client.post("/emails/bulk_send", json={
            "batch_id": batch_id,
            "draft_ids": draft_ids
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["sent"]) == 3
        assert len(data["failed"]) == 0
        # Exactly one send attempt per approved draft
        assert mock_single_send.call_count == 3


def test_regression_c_and_g_duplicate_bulk_confirmation_zero_additional_sends(client):
    """
    Safety Regressions C & G:
    Duplicate bulk confirmation or already-consumed approval cannot send drafts twice.
    A second POST is rejected and produces ZERO additional Gmail sends.
    """
    mock_db = MockSupabaseClient()
    batch_id = str(uuid.uuid4())
    draft_ids = ["draft-c1"]

    save_composed_draft("draft-c1", {
        "draft_id": "draft-c1",
        "to": "c1@example.com",
        "subject": "C1",
        "body": "Body",
        "user_id": TEST_USER_ID
    })

    # Create approved batch
    mock_db.table("agent_tool_calls").insert({
        "id": batch_id,
        "user_id": TEST_USER_ID,
        "tool_name": "prepare_bulk_send",
        "arguments": {"draft_ids": draft_ids},
        "status": "pending_approval"
    }).execute()

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.emails._send_single_email") as mock_single_send,
    ):
        mock_single_send.return_value = {"status": "sent", "result": {"id": "gmail-ok"}}
        # 1st call -> succeeds
        r1 = client.post("/emails/bulk_send", json={"batch_id": batch_id, "draft_ids": draft_ids})
        assert r1.status_code == 200
        assert mock_single_send.call_count == 1

        # 2nd call (duplicate / already-consumed) -> REJECTED
        r2 = client.post("/emails/bulk_send", json={"batch_id": batch_id, "draft_ids": draft_ids})
        assert r2.status_code in [400, 409]
        assert "already been" in str(r2.json()["detail"]).lower()
        # ZERO additional send calls!
        assert mock_single_send.call_count == 1


def test_regression_d_cross_user_draft_ids_rejected(client):
    """
    Safety Regression D:
    Drafts belonging to another user are rejected; produces zero Gmail sends.
    """
    mock_db = MockSupabaseClient()
    batch_id = str(uuid.uuid4())
    cross_user_draft = "draft-other-user-99"

    save_composed_draft(cross_user_draft, {
        "draft_id": cross_user_draft,
        "to": "victim@example.com",
        "subject": "Attack",
        "body": "Data Exfil",
        "user_id": OTHER_USER_ID  # Belongs to another user!
    })

    # Also test batch registered with different user_id
    mock_db.table("agent_tool_calls").insert({
        "id": batch_id,
        "user_id": OTHER_USER_ID,
        "tool_name": "prepare_bulk_send",
        "arguments": {"draft_ids": [cross_user_draft]},
        "status": "pending_approval"
    }).execute()

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.emails._send_single_email") as mock_single_send,
    ):
        resp = client.post("/emails/bulk_send", json={
            "batch_id": batch_id,
            "draft_ids": [cross_user_draft]
        })
        # Cross-user batch authorization check
        assert resp.status_code == 403
        assert "another user" in str(resp.json()["detail"]).lower()
        mock_single_send.assert_not_called()


def test_regression_e_over_20_drafts_rejected_with_input_error(client):
    """
    Safety Regression E:
    More than 20 drafts produces an input_error and zero emails are sent.
    """
    drafts_21 = [f"draft-limit-{i}" for i in range(21)]
    mock_db = MockSupabaseClient()

    with (
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("agent.tools.get_supabase", return_value=mock_db)
    ):
        res = prepare_bulk_send(PrepareBulkSendInput(draft_ids=drafts_21), user_id=TEST_USER_ID)
        assert res.get("error") == "input_error"
        assert "exceeds maximum limit of 20" in res.get("message", "")

    # Also test direct endpoint rejection
    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.emails._send_single_email") as mock_single_send,
    ):
        resp = client.post("/emails/bulk_send", json={
            "batch_id": str(uuid.uuid4()),
            "draft_ids": drafts_21
        })
        assert resp.status_code == 400
        assert "maximum limit of 20" in str(resp.json()["detail"]).lower()
        mock_single_send.assert_not_called()


def test_regression_f_one_email_fails_remaining_continue(client):
    """
    Safety Regression F:
    If one email fails in a bulk send batch, remaining drafts continue processing.
    """
    mock_db = MockSupabaseClient()
    batch_id = str(uuid.uuid4())
    draft_ids = ["draft-f1", "draft-f2", "draft-f3"]

    for d_id in draft_ids:
        save_composed_draft(d_id, {
            "draft_id": d_id,
            "to": f"{d_id}@example.com",
            "subject": f"Sub {d_id}",
            "body": "Body",
            "user_id": TEST_USER_ID
        })

    mock_db.table("agent_tool_calls").insert({
        "id": batch_id,
        "user_id": TEST_USER_ID,
        "tool_name": "prepare_bulk_send",
        "arguments": {"draft_ids": draft_ids},
        "status": "pending_approval"
    }).execute()

    # Simulate draft-f2 failing, f1 and f3 succeeding
    def mock_send_impl(to, subject, body, thread_id=None, reply_to_id=None, draft_id=None, user_id=None):
        if draft_id == "draft-f2":
            raise RuntimeError("SMTP 550 Mailbox unavailable")
        return {"status": "sent", "result": {"id": f"msg-{draft_id}"}}

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.emails._send_single_email", side_effect=mock_send_impl),
    ):
        resp = client.post("/emails/bulk_send", json={
            "batch_id": batch_id,
            "draft_ids": draft_ids
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["sent"]) == 2
        assert len(data["failed"]) == 1
        assert data["failed"][0]["draft_id"] == "draft-f2"
        assert "550" in data["failed"][0]["error"]


def test_regression_h1_normal_calendar_confirmation(client):
    """
    Safety Regression H1:
    Normal confirmation creates exactly ONE Calendar event and sends email with Meet link.
    """
    mock_db = MockSupabaseClient()
    meeting_id = str(uuid.uuid4())
    email_draft_id = f"draft-mtg-{uuid.uuid4().hex[:6]}"

    save_composed_draft(email_draft_id, {
        "draft_id": email_draft_id,
        "to": "attendee@example.com",
        "subject": "Invitation",
        "body": "Join the call here: {meet_link}",
        "user_id": TEST_USER_ID
    })

    mock_db.table("meeting_drafts").insert({
        "id": meeting_id,
        "user_id": TEST_USER_ID,
        "title": "Quarterly Review",
        "start_time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "end_time": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).isoformat(),
        "attendees": ["attendee@example.com"],
        "email_draft_id": email_draft_id,
        "status": "pending_approval"
    }).execute()

    mock_events = MagicMock()
    mock_cal_service = MagicMock()
    mock_cal_service.events.return_value = mock_events
    # get() returns 404 HttpError (not yet created)
    mock_events.get.return_value.execute.side_effect = HttpError(resp=MagicMock(status=404), content=b"Not found")
    mock_events.insert.return_value.execute.return_value = {
        "id": "cal-event-101",
        "hangoutLink": "https://meet.google.com/abc-defg-hij"
    }

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.calendar.get_credentials_for_user", return_value=MagicMock()),
        patch("routers.calendar.build", return_value=mock_cal_service),
        patch("routers.emails._send_single_email") as mock_send_email,
    ):
        mock_send_email.return_value = {"status": "sent"}
        resp = client.post("/calendar/confirm_meeting", json={"meeting_draft_id": meeting_id})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "created"
        assert data["meet_link"] == "https://meet.google.com/abc-defg-hij"

        # Exactly one calendar event created
        assert mock_events.insert.return_value.execute.call_count == 1

        # Real Meet link replaced in email draft
        mock_send_email.assert_called_once()
        sent_body = mock_send_email.call_args.kwargs.get("body", "")
        assert "https://meet.google.com/abc-defg-hij" in sent_body
        assert "{meet_link}" not in sent_body


def test_regression_h2_duplicate_calendar_confirmation_idempotent(client):
    """
    Safety Regression H2:
    Calling /calendar/confirm_meeting twice with the same meeting_draft_id creates
    exactly ONE Calendar event.
    """
    mock_db = MockSupabaseClient()
    meeting_id = str(uuid.uuid4())

    mock_db.table("meeting_drafts").insert({
        "id": meeting_id,
        "user_id": TEST_USER_ID,
        "title": "Strategy Session",
        "start_time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "end_time": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).isoformat(),
        "attendees": ["attendee@example.com"],
        "status": "pending_approval"
    }).execute()

    mock_events = MagicMock()
    mock_cal_service = MagicMock()
    mock_cal_service.events.return_value = mock_events
    mock_events.get.return_value.execute.side_effect = HttpError(resp=MagicMock(status=404), content=b"Not found")
    mock_events.insert.return_value.execute.return_value = {
        "id": "cal-event-strategy",
        "hangoutLink": "https://meet.google.com/str-ateg-y01"
    }

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.calendar.get_credentials_for_user", return_value=MagicMock()),
        patch("routers.calendar.build", return_value=mock_cal_service),
        patch("routers.emails._send_single_email"),
    ):
        # First confirmation
        r1 = client.post("/calendar/confirm_meeting", json={"meeting_draft_id": meeting_id})
        assert r1.status_code == 200
        assert r1.json()["status"] == "created"

        # Second confirmation (duplicate click)
        r2 = client.post("/calendar/confirm_meeting", json={"meeting_draft_id": meeting_id})
        assert r2.status_code == 200
        assert r2.json()["status"] == "created"

        # Crucial check: insert was called ONLY ONCE
        assert mock_events.insert.return_value.execute.call_count == 1


def test_regression_h3_calendar_failure_no_email_sent(client):
    """
    Safety Regression H3:
    If Calendar creation fails, meeting is marked failed and no email is sent.
    """
    mock_db = MockSupabaseClient()
    meeting_id = str(uuid.uuid4())
    email_draft_id = f"draft-fail-{uuid.uuid4().hex[:6]}"

    mock_db.table("meeting_drafts").insert({
        "id": meeting_id,
        "user_id": TEST_USER_ID,
        "title": "Failing Meeting",
        "start_time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "end_time": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).isoformat(),
        "attendees": ["attendee@example.com"],
        "email_draft_id": email_draft_id,
        "status": "pending_approval"
    }).execute()

    mock_events = MagicMock()
    mock_cal_service = MagicMock()
    mock_cal_service.events.return_value = mock_events
    mock_events.get.return_value.execute.side_effect = HttpError(resp=MagicMock(status=404), content=b"Not found")
    mock_events.insert.return_value.execute.side_effect = HttpError(resp=MagicMock(status=500), content=b"Google Calendar API error")

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.calendar.get_credentials_for_user", return_value=MagicMock()),
        patch("routers.calendar.build", return_value=mock_cal_service),
        patch("routers.emails._send_single_email") as mock_send_email,
    ):
        resp = client.post("/calendar/confirm_meeting", json={"meeting_draft_id": meeting_id})
        data = resp.json()
        assert data.get("status") == "failed"

        # Meeting marked failed
        row = mock_db.table("meeting_drafts")._data[0]
        assert row["status"] == "failed"

        # Email must NOT be sent
        mock_send_email.assert_not_called()


def test_regression_h4_processing_crash_recovery(client):
    """
    Safety Regression H4:
    An interrupted processing state recovers safely without creating duplicate Calendar events.
    """
    mock_db = MockSupabaseClient()
    meeting_id = str(uuid.uuid4())

    # Simulate meeting where process crashed while in 'approved' status, but Calendar event was already created
    mock_db.table("meeting_drafts").insert({
        "id": meeting_id,
        "user_id": TEST_USER_ID,
        "title": "Crash Recovery Meeting",
        "start_time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "end_time": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).isoformat(),
        "attendees": ["attendee@example.com"],
        "status": "approved", # in-flight claim
        "calendar_event_id": "existing-cal-id-404",
        "meet_link": "https://meet.google.com/cra-shed-rec"
    }).execute()

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.calendar.build") as mock_build,
        patch("routers.emails._send_single_email"),
    ):
        resp = client.post("/calendar/confirm_meeting", json={"meeting_draft_id": meeting_id})
        assert resp.status_code == 200
        data = resp.json()
        assert data["calendar_event_id"] == "existing-cal-id-404"
        # Calendar API is NOT called again
        mock_build.assert_not_called()


def test_regression_h5_calendar_succeeds_email_fails_calendar_preserved(client):
    """
    Safety Regression H5:
    When Calendar creation succeeds but the subsequent email send fails,
    the Calendar event remains created and no second Calendar event is created.
    """
    mock_db = MockSupabaseClient()
    meeting_id = str(uuid.uuid4())
    email_draft_id = f"draft-mailfail-{uuid.uuid4().hex[:6]}"

    save_composed_draft(email_draft_id, {
        "draft_id": email_draft_id,
        "to": "attendee@example.com",
        "subject": "Invite",
        "body": "Link: {meet_link}",
        "user_id": TEST_USER_ID
    })

    mock_db.table("meeting_drafts").insert({
        "id": meeting_id,
        "user_id": TEST_USER_ID,
        "title": "Sync with Email Glitch",
        "start_time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "end_time": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).isoformat(),
        "attendees": ["attendee@example.com"],
        "email_draft_id": email_draft_id,
        "status": "pending_approval"
    }).execute()

    mock_events = MagicMock()
    mock_cal_service = MagicMock()
    mock_cal_service.events.return_value = mock_events
    mock_events.get.return_value.execute.side_effect = HttpError(resp=MagicMock(status=404), content=b"Not found")
    mock_events.insert.return_value.execute.return_value = {
        "id": "cal-event-preserved",
        "hangoutLink": "https://meet.google.com/pre-serv-ed1"
    }

    with (
        patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID),
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("routers.calendar.get_credentials_for_user", return_value=MagicMock()),
        patch("routers.calendar.build", return_value=mock_cal_service),
        patch("routers.emails._send_single_email", side_effect=RuntimeError("Gmail send failed")),
    ):
        resp = client.post("/calendar/confirm_meeting", json={"meeting_draft_id": meeting_id})
        assert resp.status_code == 200
        data = resp.json()
        # Calendar event is created and preserved
        expected_cal_id = "meet" + meeting_id.replace("-", "").lower()[:28]
        assert data["calendar_event_id"] == expected_cal_id
        assert data["status"] == "created"
        assert data.get("email_status") == "failed"

        # Database record must preserve created state and meet_link
        row = mock_db.table("meeting_drafts")._data[0]
        assert row["status"] == "created"
        assert row["calendar_event_id"] == expected_cal_id


def test_fix_0_regression_send_mode_confirm_and_automatic_both_require_human_confirmation(client):
    """
    Fix 0 Regression:
    Human-in-the-loop confirmation before every send is mandatory.
    Test under BOTH send_mode='confirm' AND send_mode='automatic'.
    Direct send without draft approval must result in ZERO Gmail send API calls.
    """
    for mode in ["confirm", "automatic"]:
        mock_db = MockSupabaseClient()
        mock_db.table("users")._data = [{"id": TEST_USER_ID, "email": "test@example.com", "send_mode": mode}]

        # Direct send call
        with (
            patch("db.supabase_client.ensure_default_user_id", return_value=TEST_USER_ID),
            patch("db.supabase_client.get_supabase", return_value=mock_db),
            patch("routers.emails.GmailClient") as mock_gmail,
        ):
            mock_inst = mock_gmail.return_value
            # Direct call without prepare_send
            resp = client.post("/emails/send", json={
                "draft_id": f"unapproved-draft-{mode}",
                "to": "hacker@example.com",
                "subject": "Bypass Test",
                "body": "Should not send"
            })
            # Must NOT have sent via Gmail
            # Either rejected or required approval
            assert resp.status_code == 400
            assert "never prepared" in resp.json()["detail"].lower()
            mock_inst.send_message.assert_not_called()


def test_regression_ui_context_bypass_closed():
    """
    Safety Regression C (ui_context bypass):
    Opening a restricted email in plain mail UI, then asking assistant to act on it,
    is rejected with 'That contact is marked confidential — I can't access or act on this email.'
    and recorded in agent_tool_calls with status='rejected'.
    """
    from agent.graph import parse_deterministic_intent

    mock_db = MockSupabaseClient()
    mock_db.table("restricted_senders").insert({
        "id": str(uuid.uuid4()),
        "user_id": TEST_USER_ID,
        "email_address": "restricted.client@lawfirm.com",
        "label": "Confidential"
    }).execute()

    # Frontend passes open_email in ui_context
    ui_context = {
        "open_email": {
            "id": "restricted-email-uuid",
            "sender": "restricted.client@lawfirm.com",
            "subject": "Case Settlement Discussions",
            "snippet": "Confidential terms inside..."
        }
    }

    user_msg = "Summarize this email for me"
    with (
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID)
    ):
        tc, reply = parse_deterministic_intent(user_msg, ui_context, user_id=TEST_USER_ID)
        # Must reject
        assert "That contact is marked confidential — I can't access or act on this email." in reply
        # No open_email tool execution permitted
        if tc:
            assert tc.get("name") != "open_email"


def test_regression_pii_safe_recursive_logging():
    """
    Feature 5 Regression:
    Recursive PII-safe logging replaces body/subject with character count length and 40-char preview.
    """
    long_body = "This is a very sensitive email message containing private client data that should never appear in logs in full."
    long_subject = "Highly Confidential Q3 Financial Results for Executive Committee Review"
    payload = {
        "to": "test@example.com",
        "subject": long_subject,
        "body": long_body,
        "nested": {
            "email_body_template": "Template with private info: " + long_body
        }
    }

    redacted = redact_pii_recursive(payload)

    # Top-level body redacted
    assert isinstance(redacted["body"], dict)
    assert redacted["body"]["length"] == len(long_body)
    assert redacted["body"]["preview"] == long_body[:40] + "..."

    # Top-level subject redacted
    assert isinstance(redacted["subject"], dict)
    assert redacted["subject"]["length"] == len(long_subject)
    assert redacted["subject"]["preview"] == long_subject[:40] + "..."

    # Nested body template redacted
    nested_tmpl = redacted["nested"]["email_body_template"]
    assert isinstance(nested_tmpl, dict)
    assert "preview" in nested_tmpl
    assert "length" in nested_tmpl

    # Recipient address remains unredacted
    assert redacted["to"] == "test@example.com"


# =====================================================================
# Feature 7 Eval Suite: Meeting Confirmation Hardening & Audit Datetime Serialization
# =====================================================================

def test_eval_feature_7_confirm_meeting_invalid_uuid_returns_422(client):
    """
    Feature 7:
    Confirming a meeting with a malformed/non-UUID meeting_draft_id
    (such as a client placeholder 'meeting-1788708761093') returns a 422 validation error,
    never crashing as an unhandled 500 in Postgres.
    """
    resp = client.post("/calendar/confirm_meeting", json={
        "meeting_draft_id": "meeting-1788708761093"
    })
    assert resp.status_code == 422
    err_body = resp.json()
    assert "meeting_draft_id" in str(err_body)


def test_eval_feature_7_prepare_meeting_uuid_roundtrip_to_confirm_meeting(client):
    """
    Feature 7:
    prepare_meeting returns a valid database UUID.
    The ID sent to /calendar/confirm_meeting matches the actual meeting_drafts.id
    in the database, and round-trips correctly without client-generated placeholder IDs.
    """
    mock_db = MockSupabaseClient()
    with (
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("agent.tools.get_supabase", return_value=mock_db),
        patch("agent.tools.get_current_user_id", return_value=TEST_USER_ID),
        patch("agent.errors.get_supabase", return_value=mock_db),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID),
        patch("routers.calendar.get_credentials_for_user", return_value=MagicMock()),
        patch("routers.calendar.build") as mock_cal_build,
        patch("routers.emails._send_single_email", return_value=({"id": "msg-sent-123"}, None))
    ):
        mock_events = MagicMock()
        mock_events.get.return_value.execute.side_effect = HttpError(resp=MagicMock(status=404), content=b"Not found")
        mock_events.insert.return_value.execute.return_value = {
            "id": "cal-event-uuid-777",
            "hangoutLink": "https://meet.google.com/xyz-uvwx-rst"
        }
        mock_service = MagicMock()
        mock_service.events.return_value = mock_events
        mock_cal_build.return_value = mock_service

        # 1. Run prepare_meeting
        prep_res = prepare_meeting(
            PrepareMeetingArgs(
                title="Q4 Product Review",
                start_time=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2),
                end_time=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2, hours=1),
                attendees=["stakeholder@company.com"],
                email_body_template="Let's sync up on Q4 goals.\nMeet Link: {meet_link}"
            ),
            user_id=TEST_USER_ID
        )

        returned_id = prep_res.get("meeting_draft_id")
        assert returned_id is not None
        # Must be a valid UUID string
        parsed = uuid.UUID(returned_id)
        assert str(parsed) == returned_id

        # Verify meeting_drafts in DB has this exact id
        drafts = mock_db.table("meeting_drafts").select("*").execute().data
        assert any(d["id"] == returned_id for d in drafts)

        # 2. Confirm meeting using the exact returned UUID
        conf_resp = client.post("/calendar/confirm_meeting", json={
            "meeting_draft_id": returned_id
        })
        assert conf_resp.status_code == 200
        conf_data = conf_resp.json()
        assert conf_data["status"] == "created"
        assert conf_data["meet_link"] == "https://meet.google.com/xyz-uvwx-rst"
        assert conf_data["meeting_draft_id"] == returned_id


def test_eval_feature_7_audit_logging_handles_datetime_objects():
    """
    Bug 2 Fix:
    Tool arguments and results containing native Python datetime objects serialize
    cleanly without raising 'TypeError: Object of type datetime is not JSON serializable'.
    """
    from agent.tools import log_tool_audit

    mock_db = MockSupabaseClient()
    with (
        patch("db.supabase_client.get_supabase", return_value=mock_db),
        patch("agent.tools.get_supabase", return_value=mock_db),
        patch("agent.tools.get_current_user_id", return_value=TEST_USER_ID),
        patch("agent.errors.get_supabase", return_value=mock_db),
        patch("db.supabase_client.get_current_user_id", return_value=TEST_USER_ID)
    ):
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        test_args = {
            "start_time": now_dt,
            "end_time": now_dt + datetime.timedelta(hours=1),
            "title": "Datetime Serialization Test"
        }
        test_res = {
            "scheduled_at": now_dt,
            "status": "success"
        }

        # Must execute cleanly and write to agent_tool_calls without throwing
        log_tool_audit(
            tool_name="test_datetime_tool",
            arguments=test_args,
            result=test_res,
            status="executed",
            user_id=TEST_USER_ID
        )

        audit_rows = mock_db.table("agent_tool_calls").select("*").execute().data
        assert len(audit_rows) > 0
        logged_call = audit_rows[-1]
        assert logged_call["tool_name"] == "test_datetime_tool"
        assert isinstance(logged_call["arguments"]["start_time"], str)

