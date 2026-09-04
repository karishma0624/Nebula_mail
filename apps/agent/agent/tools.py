import time
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from db.supabase_client import get_supabase
from routers.emails import get_current_gmail_client

# ----------------------------------------------------
# Pydantic Schemas for each tool
# ----------------------------------------------------

class SearchEmailsInput(BaseModel):
    sender: Optional[str] = Field(None, description="Sender name or email address to filter by")
    keyword: Optional[str] = Field(None, description="Keyword in subject or body")
    date_from: Optional[str] = Field(None, description="ISO date or YYYY-MM-DD for emails after this date")
    date_to: Optional[str] = Field(None, description="ISO date or YYYY-MM-DD for emails before this date")
    unread_only: Optional[bool] = Field(None, description="Filter for unread messages only")
    folder: Optional[str] = Field("inbox", description="Folder to search: 'inbox' or 'sent'")

class OpenEmailInput(BaseModel):
    email_id: str = Field(..., description="The unique message ID of the email to view in detail")

class DraftComposeInput(BaseModel):
    to: Optional[str] = Field(None, description="Recipient email address")
    subject: Optional[str] = Field(None, description="Subject line for the message")
    body: Optional[str] = Field(None, description="Body content of the draft email")
    reply_to_id: Optional[str] = Field(None, description="Message ID being replied to if this is a reply")

class PrepareSendInput(BaseModel):
    draft_id: Optional[str] = Field(None, description="ID of draft or pending message to send")

class ApplyFiltersInput(BaseModel):
    criteria: Dict[str, Any] = Field(..., description="Filter criteria object containing sender, keyword, date_from, date_to, unread_only")

class ListRecentInput(BaseModel):
    folder: str = Field("inbox", description="Folder to list from: 'inbox' or 'sent'")
    limit: int = Field(15, description="Number of recent emails to list")


# ----------------------------------------------------
# Audit Logging Helper
# ----------------------------------------------------

def log_tool_audit(tool_name: str, arguments: Dict[str, Any], result: Optional[Dict[str, Any]], status: str, user_id: Optional[str] = None):
    supabase = get_supabase()
    if not supabase:
        return
    try:
        supabase.table("agent_tool_calls").insert({
            "tool_name": tool_name,
            "arguments": arguments,
            "result": result or {},
            "status": status,
            "user_id": user_id
        }).execute()
    except Exception as e:
        print(f"Failed to log tool call to agent_tool_calls: {e}")


# ----------------------------------------------------
# Tool Executions with Single Retry on Transient Error
# ----------------------------------------------------

def search_emails(args: SearchEmailsInput) -> Dict[str, Any]:
    """Search emails using criteria. Emits filter criteria to update frontend UI."""
    # Build query string for Gmail
    query_parts = []
    if args.sender:
        query_parts.append(f"from:{args.sender}")
    if args.keyword:
        query_parts.append(args.keyword)
    if args.date_from:
        query_parts.append(f"after:{args.date_from}")
    if args.date_to:
        import datetime
        try:
            dt = datetime.datetime.strptime(args.date_to, "%Y-%m-%d").date()
            today = datetime.datetime.now().astimezone().date()
            if dt < today:
                next_day = (dt + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
                query_parts.append(f"before:{next_day}")
        except Exception:
            pass
    if args.unread_only:
        query_parts.append("is:unread")

    query_str = " ".join(query_parts)

    retries = 1
    last_err = None
    for attempt in range(retries + 1):
        try:
            client = get_current_gmail_client()
            messages = client.list_messages(folder=args.folder or "inbox", query=query_str, max_results=20)
            res = {
                "folder": args.folder or "inbox",
                "query": query_str,
                "sender": args.sender,
                "keyword": args.keyword,
                "date_from": args.date_from,
                "date_to": args.date_to,
                "unread_only": args.unread_only,
                "count": len(messages),
                "emails": messages
            }
            log_tool_audit("search_emails", args.model_dump(), res, "executed")
            return res
        except Exception as e:
            last_err = e
            time.sleep(1)

    log_tool_audit("search_emails", args.model_dump(), {"error": str(last_err)}, "failed")
    # Return UI filter action so frontend can still apply local filters
    return {
        "folder": args.folder or "inbox",
        "sender": args.sender,
        "keyword": args.keyword,
        "date_from": args.date_from,
        "date_to": args.date_to,
        "unread_only": args.unread_only,
        "count": 0,
        "emails": []
    }

def open_email(args: OpenEmailInput) -> Dict[str, Any]:
    """Fetch specific email and tell UI to switch to detail view."""
    retries = 1
    last_err = None
    for attempt in range(retries + 1):
        try:
            client = get_current_gmail_client()
            msg = client.get_message(args.email_id)
            res = {"email_id": args.email_id, "email": msg}
            log_tool_audit("open_email", args.model_dump(), res, "executed")
            return res
        except Exception as e:
            last_err = e
            time.sleep(1)

    log_tool_audit("open_email", args.model_dump(), {"error": str(last_err)}, "failed")
    return {"email_id": args.email_id, "error": str(last_err)}

def draft_compose(args: DraftComposeInput) -> Dict[str, Any]:
    """Fill compose form and switch UI view. Never directly sends."""
    res = {
        "to": args.to or "",
        "subject": args.subject or "",
        "body": args.body or "",
        "reply_to_id": args.reply_to_id,
        "action": "open_compose"
    }
    log_tool_audit("draft_compose", args.model_dump(), res, "executed")
    return res

def prepare_send(args: PrepareSendInput) -> Dict[str, Any]:
    """
    CRITICAL GUARDRAIL: Marks draft as pending approval.
    NEVER sends directly. Returns draft info for the frontend ConfirmSendModal.
    """
    res = {
        "draft_id": args.draft_id,
        "status": "pending_approval",
        "requires_human_confirmation": True
    }
    log_tool_audit("prepare_send", args.model_dump(), res, "pending_approval")
    return res

def apply_filters(args: ApplyFiltersInput) -> Dict[str, Any]:
    """Apply arbitrary filter criteria to the main inbox view."""
    res = {"criteria": args.criteria}
    log_tool_audit("apply_filters", args.model_dump(), res, "executed")
    return res

def list_recent(args: ListRecentInput) -> Dict[str, Any]:
    """List recent emails from a given folder."""
    try:
        client = get_current_gmail_client()
        messages = client.list_messages(folder=args.folder, query="", max_results=args.limit)
        res = {"folder": args.folder, "count": len(messages), "emails": messages}
        log_tool_audit("list_recent", args.model_dump(), res, "executed")
        return res
    except Exception as e:
        log_tool_audit("list_recent", args.model_dump(), {"error": str(e)}, "failed")
        return {"folder": args.folder, "count": 0, "emails": []}
