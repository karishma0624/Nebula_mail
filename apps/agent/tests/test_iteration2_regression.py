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
