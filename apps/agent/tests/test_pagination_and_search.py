import pytest
from agent.graph import parse_deterministic_intent
from agent.tools import SearchEmailsInput

def test_intent_find_email_from_aws():
    tool_call, msg = parse_deterministic_intent("Find the email from AWS", {})
    assert tool_call is not None
    assert tool_call["name"] == "search_emails"
    assert tool_call["arguments"].get("sender") == "AWS"
    assert tool_call["arguments"].get("folder") == "inbox"

def test_intent_find_email_from_sarah_project_update():
    tool_call, msg = parse_deterministic_intent("Find the email from Sarah about the project update", {})
    assert tool_call is not None
    assert tool_call["name"] == "search_emails"
    assert tool_call["arguments"].get("sender") == "Sarah"
    assert "project" in tool_call["arguments"].get("keyword", "").lower()

def test_intent_search_for_aws_invoice():
    tool_call, msg = parse_deterministic_intent("Search for AWS invoice", {})
    assert tool_call is not None
    assert tool_call["name"] == "search_emails"
    assert tool_call["arguments"].get("keyword") == "AWS invoice"

def test_search_emails_input_model():
    inp = SearchEmailsInput(
        sender="AWS",
        keyword="invoice",
        unread_only=True,
        folder="inbox"
    )
    assert inp.sender == "AWS"
    assert inp.keyword == "invoice"
    assert inp.unread_only is True
    assert inp.folder == "inbox"
