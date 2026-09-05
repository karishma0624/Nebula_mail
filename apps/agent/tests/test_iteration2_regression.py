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
