import datetime
import pytest
from unittest.mock import patch
from langchain_core.messages import HumanMessage
from agent.graph import parse_deterministic_intent, agent_graph
from agent.state import AgentState

@pytest.fixture(autouse=True)
def mock_no_network_llm():
    with patch("agent.graph.get_llm", return_value=None):
        yield

def test_section_13_single_shot_draft_placement_drive():
    """Section 13: Single-shot compose with placement drive body and subject 'sample'"""
    msg = "draft an email to hr@company.com saying it's for a placement drive, subject should be 'sample'"
    tool_calls, reply = parse_deterministic_intent(msg, {})
    assert tool_calls is not None
    assert isinstance(tool_calls, list)
    assert len(tool_calls) == 2
    
    draft_tc = tool_calls[0]
    prepare_tc = tool_calls[1]
    
    assert draft_tc["name"] == "draft_compose"
    assert prepare_tc["name"] == "prepare_send"
    
    draft_args = draft_tc["arguments"]
    prep_args = prepare_tc["arguments"]
    
    assert draft_args["to"] == "hr@company.com"
    assert draft_args["subject"] == "sample"
    assert "placement drive" in draft_args["body"].lower()
    assert draft_args["draft_id"] is not None
    assert draft_args["draft_id"].startswith("draft-")
    
    # Both draft_compose and prepare_send must have matching draft_id and literal fields
    assert prep_args["draft_id"] == draft_args["draft_id"]
    assert prep_args["subject"] == "sample"
    assert prep_args["to"] == "hr@company.com"

def test_section_13_mid_conversation_subject_correction():
    """Section 13: Mid-conversation correction ('the subject has to be sample')"""
    msg = "the subject has to be 'sample'"
    tool_calls, reply = parse_deterministic_intent(msg, {})
    assert tool_calls is not None
    assert isinstance(tool_calls, list)
    assert len(tool_calls) == 2
    assert tool_calls[0]["name"] == "draft_compose"
    assert tool_calls[1]["name"] == "prepare_send"
    assert tool_calls[0]["arguments"]["subject"] == "sample"
    assert tool_calls[1]["arguments"]["subject"] == "sample"
    assert tool_calls[0]["arguments"]["draft_id"] is not None

def test_section_15_casual_filter_phrasings():
    """Section 15: Casual filter phrasings beyond official evaluator phrases"""
    # 1. "mails from supabase"
    tc1, _ = parse_deterministic_intent("mails from supabase", {})
    assert tc1 is not None
    assert tc1["name"] == "search_emails"
    assert tc1["arguments"]["sender"].lower() == "supabase"

    # 2. "filter emails from supabase"
    tc2, _ = parse_deterministic_intent("filter emails from supabase", {})
    assert tc2 is not None
    assert tc2["name"] == "search_emails"
    assert tc2["arguments"]["sender"].lower() == "supabase"

    # 3. "any emails from AWS"
    tc3, _ = parse_deterministic_intent("any emails from AWS", {})
    assert tc3 is not None
    assert tc3["name"] == "search_emails"
    assert tc3["arguments"]["sender"] == "AWS"

    # 4. "filter by David"
    tc4, _ = parse_deterministic_intent("filter by David", {})
    assert tc4 is not None
    assert tc4["name"] == "search_emails"
    assert tc4["arguments"]["sender"] == "David"

def test_section_3_relative_date_range_now():
    """Section 3: 'last 10 days' computes today - 10 to today dynamically"""
    tc, reply = parse_deterministic_intent("Show me emails from the last 10 days", {})
    assert tc is not None
    assert tc["name"] == "search_emails"
    today = datetime.datetime.now().astimezone().date()
    expected_from = (today - datetime.timedelta(days=10)).strftime("%Y-%m-%d")
    expected_to = today.strftime("%Y-%m-%d")
    assert tc["arguments"]["date_from"] == expected_from
    assert tc["arguments"]["date_to"] == expected_to
    assert expected_from in reply
    assert expected_to in reply

def test_section_6_form_detection_tool():
    """Section 6: 'fill out that form' produces fill_form preview tool call"""
    tc, reply = parse_deterministic_intent("fill out that form", {"open_email": {"id": "msg-form-test"}})
    assert tc is not None
    assert tc["name"] == "fill_form"
    assert tc["arguments"]["email_id"] == "msg-form-test"
    assert "preview" in reply.lower()

def test_section_8_grounded_rag_query():
    """Section 8: 'Which Supabase project is paused?' produces citation-grounded response"""
    res, reply, citations = parse_deterministic_intent("Which Supabase project is paused?", {}, include_citations=True)
    assert res is not None
    assert res["name"] == "open_email"
    assert citations is not None
    assert len(citations) > 0
    assert "[1]" in reply or "1" in str(citations[0]["number"])

def test_section_20_no_unbound_local_citations_all_paths():
    """Section 20: Verify planner_node never raises UnboundLocalError across any path (compose, filter, RAG, idle, LLM tool, RAG error)"""
    from agent.graph import planner_node
    from langchain_core.messages import AIMessage

    def make_state(content: str) -> AgentState:
        return {
            "messages": [HumanMessage(content=content)],
            "ui_context": {"current_view": "inbox", "open_email": None, "active_filters": {}},
            "tool_calls": [],
            "reflection": None,
            "retry_count": 0,
            "error": None,
            "final_response": None,
            "citations": None,
        }

    # 1. Compose path (deterministic)
    s1 = planner_node(make_state("draft an email to test@test.com with subject 'hi'"))
    assert "citations" in s1
    assert isinstance(s1["citations"], list)

    # 2. Filter path (deterministic)
    s2 = planner_node(make_state("mails from supabase"))
    assert "citations" in s2
    assert isinstance(s2["citations"], list)

    # 3. RAG question path
    s3 = planner_node(make_state("Which Supabase project is paused?"))
    assert "citations" in s3
    assert isinstance(s3["citations"], list)
    assert len(s3["citations"]) > 0

    # 4. Idle / no-match fallback path
    s4 = planner_node(make_state("completely random gibberish 99999"))
    assert "citations" in s4
    assert s4["citations"] == []

    # 5. Forced RAG failure
    with patch("agent.rag.answer_grounded_rag", side_effect=RuntimeError("Forced vector DB crash")):
        s5 = planner_node(make_state("is my verification done?"))
        assert "citations" in s5
        assert isinstance(s5["citations"], list)
        assert s5["citations"] == []

    # 6. Simulated LLM returning tool_name directly (the exact path that threw UnboundLocalError)
    mock_llm_obj = type("MockLLM", (), {})()
    mock_llm_obj.invoke = lambda msgs: AIMessage(content='{"tool": "draft_compose", "arguments": {"to": "a@b.com", "subject": "test"}, "message": "Drafted."}')
    with patch("agent.graph.get_llm", return_value=mock_llm_obj):
        s6 = planner_node(make_state("compose a message to a@b.com"))
        assert "citations" in s6
        assert isinstance(s6["citations"], list)
        assert s6["citations"] == []
        assert len(s6["tool_calls"]) >= 1

def test_section_22_network_errors_graceful_handling():
    """Section 22: Mock Gmail client raising ServerNotFoundError for /emails/list, /emails/send, and /chat asserting structured 502/graceful error"""
    from fastapi.testclient import TestClient
    from main import app
    import httplib2
    from gmail.client import GmailNetworkError

    client = TestClient(app)

    # 1. /emails/list under ServerNotFoundError
    with patch("routers.emails.get_current_gmail_client") as mock_client_getter:
        mock_gmail = mock_client_getter.return_value
        mock_gmail.list_messages.side_effect = GmailNetworkError()
        res = client.get("/emails/list")
        assert res.status_code == 502
        data = res.json()
        err_obj = data.get("detail") if "detail" in data else data
        assert err_obj.get("error") == "gmail_unreachable"

    # 2. /emails/send under ServerNotFoundError
    with patch("routers.emails.get_current_gmail_client") as mock_client_getter:
        mock_gmail = mock_client_getter.return_value
        mock_gmail.send_message.side_effect = GmailNetworkError()
        res = client.post("/emails/send", json={"to": "test@example.com", "subject": "hi", "body": "test"})
        assert res.status_code == 502
        data = res.json()
        err_obj = data.get("detail") if "detail" in data else data
        assert err_obj.get("error") == "gmail_unreachable"

    # 3. /chat under ServerNotFoundError
    with patch("agent.graph.agent_graph.invoke", side_effect=httplib2.error.ServerNotFoundError("Unable to find server at gmail.googleapis.com")):
        res = client.post("/chat", json={"message": "check my emails"})
        assert res.status_code == 200  # SSE stream starts
        assert "Couldn't reach Gmail" in res.text
        assert "Traceback" not in res.text

def test_section_19_grounded_qa_formatting_and_no_match():
    """Section 19: Grounded Q&A intent, bold date/time formatting, bullet points, and plain no-match message"""
    # 1. Student verification query with seed fixture email
    seed_verification_emails = [{
        "id": "sheerid-msg-1",
        "sender": "verify@sheerid.com",
        "subject": "Verification Successful: Google Student Offer",
        "snippet": "Congratulations! You have been verified for the Google student offer.",
        "received_at": "Sep 4, 2026, 10:30 AM"
    }]
    with patch("agent.rag.search_semantic_emails", return_value=seed_verification_emails):
        tc, reply, cits = parse_deterministic_intent("Is my student verification done or not?", {}, include_citations=True)
        assert cits is not None and len(cits) > 0
        assert "•" in reply
        assert "**" in reply  # bold date/time
        assert "[1]" in reply

    # 2. AWS query
    seed_aws_emails = [{
        "id": "aws-msg-1",
        "sender": "no-reply-aws@amazon.com",
        "subject": "Amazon Web Services Invoice Available",
        "snippet": "Your AWS billing statement for August 2026 is now available.",
        "received_at": "Sep 3, 2026, 08:00 AM"
    }]
    with patch("agent.rag.search_semantic_emails", return_value=seed_aws_emails):
        tc, reply, cits = parse_deterministic_intent("Has AWS emailed me about billing?", {}, include_citations=True)
        assert cits is not None and len(cits) > 0
        assert "•" in reply
        assert "**" in reply
        assert "[1]" in reply

    # 3. Genuinely unanswerable question with no matching seed email
    with patch("agent.rag.search_semantic_emails", return_value=[]):
        tc, reply, cits = parse_deterministic_intent("did I get a response from someone who never emailed me", {}, include_citations=True)
        assert "could" in reply.lower() and "find" in reply.lower()
        assert cits == []
        assert "I am ready. Tell me an action" not in reply  # MUST NOT be the idle fallback

def test_section_23_send_mode_preferences_and_execution():
    """Section 23: Default confirm mode requires human-in-the-loop, while automatic mode sends directly and logs auto_executed"""
    from fastapi.testclient import TestClient
    from main import app
    client = TestClient(app)

    # 1. Test GET /user/settings defaults to confirm
    with patch("routers.emails.get_user_settings", return_value={"send_mode": "confirm"}):
        res = client.get("/user/settings")
        assert res.status_code == 200
        assert res.json().get("send_mode") == "confirm"

    # 2. When send_mode is confirm (default), composing produces draft_compose + prepare_send (confirmation modal)
    with patch("routers.emails.get_user_settings", return_value={"send_mode": "confirm"}):
        tool_calls, reply = parse_deterministic_intent("Send an email to user@test.com with subject 'Important' and body 'Hello world'", {})
        assert len(tool_calls) == 2
        assert tool_calls[0]["name"] == "draft_compose"
        assert tool_calls[1]["name"] == "prepare_send"
        assert "confirmation" in reply.lower()

    # 3. When send_mode is automatic, composing calls send directly and logs auto_executed without prepare_send
    with patch("routers.emails.get_user_settings", return_value={"send_mode": "automatic"}):
        with patch("routers.emails.get_current_gmail_client") as mock_client:
            mock_inst = mock_client.return_value
            mock_inst.send_message.return_value = {"id": "sent-msg-123"}
            with patch("agent.tools.log_tool_audit") as mock_audit:
                tool_calls, reply = parse_deterministic_intent("Send an email to user@test.com with subject 'Important' and body 'Hello world'", {})
                # Should have sent directly
                mock_inst.send_message.assert_called_once()
                mock_audit.assert_called_with("send_email", {"draft_id": tool_calls[0]["arguments"]["draft_id"], "to": "user@test.com", "subject": "Important", "body": "Hello world"}, {"id": "sent-msg-123"}, "auto_executed")
                assert len(tool_calls) == 1
                assert tool_calls[0]["name"] == "draft_compose"
                assert "automatically sent" in reply.lower()


def test_section_24_per_message_actions_and_aws_invoice_grounded_qa():
    """Section 24 & AWS invoice test: Assert 'is AWS invoice available' returns direct confirmation with citation, and test edit-message endpoint"""
    from fastapi.testclient import TestClient
    from main import app
    from agent.graph import planner_node
    from langchain_core.messages import HumanMessage

    # 1. Test 'is AWS invoice available' directly produces grounded confirmation and citation
    state = planner_node({
        "messages": [HumanMessage(content="is AWS invoice available")],
        "ui_context": {}
    })
    reply = state.get("final_response") or ""
    citations = state.get("citations") or []
    assert "available" in reply.lower()
    assert "aws" in reply.lower()
    assert len(citations) > 0
    assert "[1]" in reply or "1" in str(citations[0]["number"])

    # 2. Test edit message endpoint
    client = TestClient(app)
    with patch("routers.chat.ensure_default_user_id", return_value="user-123"):
        with patch("routers.chat.get_supabase") as mock_sb:
            mock_inst = mock_sb.return_value
            mock_inst.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{"id": "conv-123"}]
            res = client.post("/conversations/conv-123/edit-message", json={
                "message_id": "msg-1",
                "new_content": "Show emails from AWS"
            })
            assert res.status_code == 200
            assert res.json().get("status") == "success"


def test_section_25_reply_to_natural_language_email():
    """Section 25: Reply to email described in natural language resolves target email, reply_to_id, sender, and Re: subject"""
    # 1. Test resolving target email from description with specific body
    seed_email = {
        "id": "msg-class-prep-1",
        "sender": "Karishma Sivakumar <karis@example.com>",
        "subject": "Re: reg online class",
        "snippet": "Please check what to prepare for the online class tomorrow.",
        "thread_id": "thread-class-123"
    }
    with patch("agent.graph.resolve_target_email_for_reply", return_value=seed_email):
        tool_calls, reply = parse_deterministic_intent("reply to the mail about what to prepare for the class saying I will be there", {})
        assert tool_calls is not None
        assert isinstance(tool_calls, list)
        assert len(tool_calls) == 2
        draft_tc = tool_calls[0]
        prepare_tc = tool_calls[1]

        assert draft_tc["name"] == "draft_compose"
        assert prepare_tc["name"] == "prepare_send"

        args = draft_tc["arguments"]
        assert args["reply_to_id"] == "msg-class-prep-1"
        assert args["to"] == "Karishma Sivakumar <karis@example.com>"
        assert args["subject"] == "Re: reg online class"
        assert "I will be there" in args["body"]
        assert args["thread_id"] == "thread-class-123"

    # 2. Test when no matching email is found (must say so plainly, never invent an unrelated draft)
    with patch("agent.graph.resolve_target_email_for_reply", return_value=None):
        tc_none, reply_none = parse_deterministic_intent("reply to the mail about non_existing_weird_email_topic_xyz_999", {})
        assert tc_none is None
        assert "couldn't find an email" in reply_none.lower()


def test_section_26_unified_send_mode_across_compose_reply_forward():
    """Section 26: Unified send_mode gates compose, natural-language reply, and forward identically"""
    seed_email_reply = {
        "id": "msg-class-prep-1",
        "sender": "Karishma Sivakumar <karis@example.com>",
        "subject": "Re: reg online class",
        "snippet": "Please check what to prepare for the online class tomorrow.",
        "thread_id": "thread-class-123"
    }
    seed_email_fwd = {
        "id": "msg-sarah-1",
        "sender": "Sarah <sarah@company.com>",
        "subject": "Project Update",
        "snippet": "Here is the project update.",
        "thread_id": "thread-sarah-123"
    }

    # --- Mode A: Automatic Send Mode ---
    # With Send Mode = automatic, all three skip confirmation modal and send directly, logged as auto_executed
    with patch("routers.emails.get_user_settings", return_value={"send_mode": "automatic"}):
        with patch("routers.emails.get_current_gmail_client") as mock_client_getter:
            mock_gmail = mock_client_getter.return_value
            mock_gmail.send_message.return_value = {"id": "sent-msg-auto"}
            with patch("agent.tools.log_tool_audit") as mock_audit:
                # (a) Direct compose
                tc_a, rep_a = parse_deterministic_intent("Send an email to user@test.com with subject 'Meeting' and body 'hello'", {})
                assert len(tc_a) == 1
                assert tc_a[0]["name"] == "draft_compose"
                assert "automatically sent" in rep_a.lower()
                mock_gmail.send_message.assert_called_with(
                    to="user@test.com",
                    subject="Meeting",
                    body="hello",
                    thread_id=None,
                    reply_to_message_id=None
                )
                mock_audit.assert_called_with("send_email", tc_a[0]["arguments"], {"id": "sent-msg-auto"}, "auto_executed")

                # (b) Natural-language reply
                with patch("agent.graph.resolve_target_email_for_reply", return_value=seed_email_reply):
                    mock_gmail.send_message.reset_mock()
                    tc_b, rep_b = parse_deterministic_intent("reply to the mail about what to prepare for the class saying I will bring my laptop", {})
                    assert len(tc_b) == 1
                    assert tc_b[0]["name"] == "draft_compose"
                    assert "automatically sent reply" in rep_b.lower()
                    mock_gmail.send_message.assert_called_with(
                        to="Karishma Sivakumar <karis@example.com>",
                        subject="Re: reg online class",
                        body="I will bring my laptop",
                        thread_id="thread-class-123",
                        reply_to_message_id="msg-class-prep-1"
                    )

                # (c) Forward
                with patch("agent.graph.resolve_target_email_for_reply", return_value=seed_email_fwd):
                    mock_gmail.send_message.reset_mock()
                    tc_c, rep_c = parse_deterministic_intent("forward the email from Sarah to bob@example.com", {})
                    assert len(tc_c) == 1
                    assert tc_c[0]["name"] == "draft_compose"
                    assert "automatically sent forwarded email" in rep_c.lower()
                    mock_gmail.send_message.assert_called_with(
                        to="bob@example.com",
                        subject="Fwd: Project Update",
                        body="---------- Forwarded message ---------\nFrom: Sarah <sarah@company.com>\nSubject: Project Update\n\nHere is the project update.",
                        thread_id="thread-sarah-123",
                        reply_to_message_id=None
                    )

    # --- Mode B: Confirm Send Mode (Default) ---
    # With Send Mode = confirm, all three stop at prepare_send requiring explicit human confirmation
    with patch("routers.emails.get_user_settings", return_value={"send_mode": "confirm"}):
        # (a) Direct compose
        tc_a2, rep_a2 = parse_deterministic_intent("Send an email to user@test.com with subject 'Meeting' and body 'hello'", {})
        assert len(tc_a2) == 2
        assert tc_a2[0]["name"] == "draft_compose"
        assert tc_a2[1]["name"] == "prepare_send"
        assert "confirmation" in rep_a2.lower()

        # (b) Natural-language reply
        with patch("agent.graph.resolve_target_email_for_reply", return_value=seed_email_reply):
            tc_b2, rep_b2 = parse_deterministic_intent("reply to the mail about what to prepare for the class saying I will bring my laptop", {})
            assert len(tc_b2) == 2
            assert tc_b2[0]["name"] == "draft_compose"
            assert tc_b2[1]["name"] == "prepare_send"
            assert tc_b2[1]["arguments"]["reply_to_id"] == "msg-class-prep-1"
            assert "confirmation" in rep_b2.lower()

        # (c) Forward
        with patch("agent.graph.resolve_target_email_for_reply", return_value=seed_email_fwd):
            tc_c2, rep_c2 = parse_deterministic_intent("forward the email from Sarah to bob@example.com", {})
            assert len(tc_c2) == 2
            assert tc_c2[0]["name"] == "draft_compose"
            assert tc_c2[1]["name"] == "prepare_send"
            assert tc_c2[1]["arguments"]["to"] == "bob@example.com"
            assert "confirmation" in rep_c2.lower()


def test_section_27_form_fill_graceful_no_500():
    """Section 27: Form auto-fill preview and submission never crash with raw 500 on un-synced emails or Google Forms"""
    from agent.tools import fill_form, FillFormInput
    from fastapi.testclient import TestClient
    from main import app

    # 1. Calling fill_form with a Google Form / un-synced email_id
    args = FillFormInput(email_id="unsynced-google-form-123", field_values={"full_name": "Karishma"})
    with patch("agent.tools.get_current_gmail_client") as mock_client:
        mock_client.return_value.get_message.return_value = {
            "id": "unsynced-google-form-123",
            "form_url": "https://forms.gle/sampleFormTest123",
            "form_type": "google_form",
            "subject": "Community Survey Form"
        }
        res = fill_form(args)
        assert res is not None
        assert isinstance(res["fields"], list)
        # When parsed fields are present, verify they are mapped
        with patch("routers.emails.parse_google_form", return_value={"fields": [{"name": "entry.1", "label": "Full Name"}]}):
            res_parsed = fill_form(args)
            assert len(res_parsed["fields"]) > 0
            assert res_parsed["fields"][0]["label"] == "Full Name"

    # 2. Testing /forms/submit endpoint does not raise 500 when database throws foreign key exception
    client = TestClient(app)
    with patch("db.supabase_client.ensure_default_user_id", return_value="user-test-123"):
        with patch("routers.emails.get_supabase") as mock_sb:
            mock_inst = mock_sb.return_value
            # Simulate foreign key constraint violation on first insert
            mock_inst.table.return_value.insert.return_value.execute.side_effect = Exception("violates foreign key constraint form_fill_sessions_email_id_fkey")
            response = client.post("/forms/submit", json={
                "email_id": "nonexistent-email-id",
                "form_type": "google_form",
                "fields": {"full_name": "Karishma"},
                "action": "submit"
            })
            assert response.status_code == 200
            data = response.json()
            assert data.get("status") == "submitted"
            assert "Server returned 500" not in str(data)


def test_section_28_and_29_confirm_then_open_conversation_memory():
    """Section 28 & 29: With no email open, asking to summarize offers to open, and confirming ('yes') opens and summarizes it using turn-to-turn memory"""
    from langchain_core.messages import HumanMessage, AIMessage

    seed_airbnb = {
        "id": "msg-airbnb-1",
        "sender": "Airbnb <automated@airbnb.com>",
        "subject": "Reservation confirmed - Goa Beach Villa",
        "snippet": "Your reservation for 3 nights at Goa Beach Villa is confirmed. Check-in is Sep 15, 2026 at 2:00 PM.",
        "date": "Sep 2, 2026, 04:15 PM"
    }

    with patch("agent.graph.resolve_target_email_for_reply", return_value=seed_airbnb):
        # Turn 1: User asks "summarize the Airbnb email" with no email open
        # Should NOT dead-end with "Please select or open an email first"
        # Should propose to open it
        tc1, reply1 = parse_deterministic_intent("summarize the Airbnb email", {"open_email": None})
        assert tc1 is None
        assert "airbnb" in reply1.lower()
        assert "want me to open it and summarize it?" in reply1.lower()

        # Turn 2: User confirms "yes"
        # History contains Turn 1 user message and Turn 1 assistant offer
        history = [
            HumanMessage(content="summarize the Airbnb email"),
            AIMessage(content=reply1)
        ]
        tc2, reply2 = parse_deterministic_intent("yes", {"open_email": None}, history_messages=history)
        assert tc2 is not None
        assert tc2["name"] == "open_email"
        assert tc2["arguments"]["email_id"] == "msg-airbnb-1"
        # Assistant response contains formatted summary with bold date/time and bullet points
        assert "opened the email" in reply2.lower()
        assert "•" in reply2
        assert "**" in reply2  # bold date/time
        assert "airbnb" in reply2.lower()

    # Turn 3: Also test user confirming with "i did" when email is open
    open_email = {
        "id": "msg-airbnb-1",
        "sender": "Airbnb <automated@airbnb.com>",
        "subject": "Reservation confirmed - Goa Beach Villa",
        "snippet": "Your reservation for 3 nights at Goa Beach Villa is confirmed.",
        "date": "Sep 2, 2026, 04:15 PM"
    }
    tc3, reply3 = parse_deterministic_intent("i did", {"open_email": open_email}, history_messages=[
        AIMessage(content="Please select or open an email first so I can summarize it for you")
    ])
    assert tc3 is None
    assert "summary" in reply3.lower()
    assert "•" in reply3
    assert "**" in reply3



def test_section_30_new_chat_creates_fresh_conversation():
    """Section 30: Starting a new chat creates a fresh conversation_id, preserving previous conversations in history"""
    from fastapi.testclient import TestClient
    from main import app
    client = TestClient(app)

    with patch("routers.chat.ensure_default_user_id", return_value="user-test-123"):
        with patch("routers.chat.get_supabase") as mock_sb:
            mock_inst = mock_sb.return_value
            # Mock new conversation creation
            mock_inst.table.return_value.insert.return_value.execute.return_value.data = [{"id": "new-conv-uuid-789"}]
            mock_inst.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []

            # Post chat with conversation_id=None (simulating New Chat click)
            res = client.post("/chat", json={
                "message": "Hello new chat",
                "conversation_id": None
            })
            assert res.status_code == 200
            assert "new-conv-uuid-789" in res.text


def test_section_31_reply_vs_form_fill_routing():
    """Section 31: 'reply to [sender] regarding the form saying [message]' must trigger a reply flow and NEVER call fill_form"""
    msg = "reply to jayakishan.2305044@srec.ac.in regarding the form saying that i will fill later"
    tool_calls, reply = parse_deterministic_intent(msg, {"open_email": None})

    assert tool_calls is not None
    assert isinstance(tool_calls, list)
    tc_names = [tc["name"] for tc in tool_calls]
    assert "draft_compose" in tc_names
    assert "fill_form" not in tc_names
    assert "jayakishan.2305044@srec.ac.in" in str(tool_calls)
    assert "fill later" in str(tool_calls)


def test_section_32_real_form_fill_no_placeholder_ids_and_real_fields():
    """Section 32: fill_form must use real resolved email IDs, never seed-form-msg-id, and extract genuine fields from Google Forms"""
    from unittest.mock import MagicMock
    from routers.emails import parse_google_form
    from agent.tools import fill_form, FillFormInput

    # 1. Verify parse_google_form extracts genuine question labels
    sample_form_html = """
    <html><body>
    <script type="text/javascript">
    var FB_PUBLIC_LOAD_DATA_ = [null,[null,[[1297557774,"Name",null,0,[[1297557774,null,1]]],[1604020733,"Email ID",null,0,[[1604020733,null,1]]],[2140716534,"Phone Number",null,0,[[2140716534,null,1]]]],null,null,null,null,null,null,"Basic Details Form"]];
    </script>
    </body></html>
    """
    with patch("urllib.request.urlopen") as mock_url:
        mock_resp = MagicMock()
        mock_resp.geturl.return_value = "https://docs.google.com/forms/d/e/1FAIpQLScgJJo16EAxehKvD8NrIOcrcv5s84SauVj08UqiEVfG_MdH1Q/viewform"
        mock_resp.read.return_value = sample_form_html.encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_url.return_value = mock_resp

        parsed = parse_google_form("https://forms.gle/EGEmF8k7ejnj9Wsg6")
        assert parsed["title"] == "Basic Details Form"
        field_labels = [f["label"] for f in parsed["fields"]]
        assert "Name" in field_labels
        assert "Email ID" in field_labels
        assert "Phone Number" in field_labels

    # 2. Verify fill_form never calls Gmail API with placeholder 'seed-form-msg-id'
    real_email_id = "real-gmail-msg-999"
    with patch("agent.tools.get_current_gmail_client") as mock_cl:
        mock_client_inst = mock_cl.return_value
        mock_client_inst.get_message.return_value = {
            "id": real_email_id,
            "form_url": "https://forms.gle/EGEmF8k7ejnj9Wsg6",
            "form_type": "google_form"
        }
        with patch("agent.tools.get_supabase"):
            with patch("routers.emails.parse_google_form", return_value=parsed):
                res = fill_form(FillFormInput(email_id=real_email_id))
                assert res["email_id"] == real_email_id
                assert res["email_id"] != "seed-form-msg-id"
                # Field names match the real extracted form
                assert any(f["label"] == "Name" for f in res["fields"])
                assert any(f["label"] == "Email ID" for f in res["fields"])
                mock_client_inst.get_message.assert_called_with(real_email_id)


def test_section_33_attachment_extraction_and_grounded_qa():
    """Section 33: Document attachment text extraction (PDF/DOCX/text) and grounded Q&A citing email and attachment"""
    from agent.attachments import extract_text_from_bytes
    from agent.rag import answer_grounded_rag

    # 1. Test plain text extraction
    sample_txt = b"Project Milestone Schedule: Final submission deadline: October 15, 2026."
    text, status = extract_text_from_bytes(sample_txt, "schedule.txt")
    assert status == "extracted"
    assert "October 15, 2026" in text

    # 2. Test grounded Q&A retrieving attachment
    mock_att = [{
        "id": "att-123",
        "email_id": "email-sarah-456",
        "filename": "Project_Guidelines.pdf",
        "extracted_text": "The project proposal submission deadline: October 20, 2026. All teams must submit.",
        "score": 10
    }]
    with patch("agent.attachments.search_semantic_attachments", return_value=mock_att):
        with patch("agent.rag.search_semantic_emails", return_value=[]):
            ans, citations = answer_grounded_rag("what does the PDF in that email say about the deadline", "user-123")
            assert "Project_Guidelines.pdf" in ans or "October 20, 2026" in ans
            assert len(citations) > 0
            assert citations[0]["filename"] == "Project_Guidelines.pdf"
            assert citations[0]["email_id"] == "email-sarah-456"


def test_section_34_multilingual_grounded_qa():
    """Section 34: Multilingual support responds in the user's language (Tamil, Hindi, etc.) when querying email content"""
    from agent.rag import answer_grounded_rag

    seed_email = [{
        "id": "email-tamil-seed",
        "sender": "Professor Raman <raman@university.edu>",
        "subject": "Class Announcement",
        "snippet": "Classes will be conducted online tomorrow morning.",
        "received_at": "Sep 5, 2026"
    }]

    # Query in Tamil
    with patch("agent.rag.search_semantic_emails", return_value=seed_email):
        with patch("agent.attachments.search_semantic_attachments", return_value=[]):
            ans, citations = answer_grounded_rag("மின்னஞ்சல் தகவலை சுருக்கமாக கூறுங்கள்", "user-123")
            # Should have Tamil characters in response
            assert any('\u0B80' <= c <= '\u0BFF' for c in ans)
            assert len(citations) > 0

    # Query in Hindi
    with patch("agent.rag.search_semantic_emails", return_value=seed_email):
        with patch("agent.attachments.search_semantic_attachments", return_value=[]):
            ans, citations = answer_grounded_rag("ईमेल का सारांश बताएं", "user-123")
            # Should have Devanagari characters in response
            assert any('\u0900' <= c <= '\u097F' for c in ans)
            assert len(citations) > 0




