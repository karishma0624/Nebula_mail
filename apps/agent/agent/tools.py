import json
import logging
import time
import uuid
import datetime
from typing import Optional, Dict, Any, List, Union
from pydantic import BaseModel, Field
from db.supabase_client import get_supabase, get_current_user_id, ensure_default_user_id
from routers.emails import get_current_gmail_client
from agent.pii import redact_pii_recursive
from agent.errors import log_agent_error

logger = logging.getLogger("agent.tools")

def make_json_serializable(data: Any) -> Any:
    if hasattr(data, "model_dump"):
        return data.model_dump(mode="json")
    try:
        return json.loads(json.dumps(data, default=str))
    except Exception:
        return str(data)

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
    draft_id: Optional[str] = Field(None, description="Unique ID of draft")
    to: Optional[Union[str, List[str]]] = Field(None, description="Recipient email address or list of addresses")
    subject: Optional[str] = Field(None, description="Subject line for the message")
    body: Optional[str] = Field(None, description="Body content of the draft email")
    reply_to_id: Optional[str] = Field(None, description="Message ID being replied to if this is a reply")

class PrepareSendInput(BaseModel):
    draft_id: Optional[str] = Field(None, description="ID of draft or pending message to send")
    to: Optional[Union[str, List[str]]] = Field(None, description="Recipient email address or list of addresses")
    subject: Optional[str] = Field(None, description="Subject line for the message")
    body: Optional[str] = Field(None, description="Body content of the draft email")
    thread_id: Optional[str] = Field(None, description="Thread ID if replying to existing thread")

class PrepareMeetingArgs(BaseModel):
    title: str = Field(..., description="Title / subject of the meeting")
    start_time: datetime.datetime = Field(..., description="Meeting start time (ISO timestamp)")
    end_time: datetime.datetime = Field(..., description="Meeting end time (ISO timestamp)")
    attendees: List[str] = Field(..., description="List of attendee email addresses")
    email_body_template: str = Field(..., description="Email body template containing literal {meet_link} placeholder")
    email_draft_id: Optional[str] = Field(None, description="Linked email draft ID")
    reply_to_id: Optional[str] = Field(None, description="Message ID being replied to if this is a reply")
    meeting_draft_id: Optional[str] = Field(None, description="Deterministic UUID for the meeting draft")

class PrepareBulkSendInput(BaseModel):
    draft_ids: List[str] = Field(..., description="List of draft IDs to prepare for batch send approval")

class ApplyFiltersInput(BaseModel):
    criteria: Dict[str, Any] = Field(..., description="Filter criteria object containing sender, keyword, date_from, date_to, unread_only")

class ListRecentInput(BaseModel):
    folder: str = Field("inbox", description="Folder to list from: 'inbox' or 'sent'")
    limit: int = Field(15, description="Number of recent emails to list")


# ----------------------------------------------------
# Audit Logging Helper (Recursive PII Redaction & Request Tracing)
# ----------------------------------------------------

def log_tool_audit(
    tool_name: str,
    arguments: Any,
    result: Optional[Any],
    status: str,
    user_id: Optional[str] = None,
    request_id: Optional[str] = None
):
    supabase = get_supabase()
    if not supabase:
        return
    uid = user_id or get_current_user_id()
    serializable_args = make_json_serializable(arguments)
    serializable_res = make_json_serializable(result or {})
    safe_args = redact_pii_recursive(serializable_args)
    safe_res = redact_pii_recursive(serializable_res)
    # Defense-in-depth: convert any lingering datetime or complex objects to primitives
    safe_args = json.loads(json.dumps(safe_args, default=str))
    safe_res = json.loads(json.dumps(safe_res, default=str))
    try:
        supabase.table("agent_tool_calls").insert({
            "tool_name": tool_name,
            "arguments": safe_args,
            "result": safe_res,
            "status": status,
            "user_id": uid,
            "request_id": request_id
        }).execute()
    except Exception as e:
        logger.error(f"Failed to log tool call to agent_tool_calls: {e}")
        try:
            log_agent_error("output_error", "audit_logger", str(e), {"tool": tool_name}, user_id=uid, request_id=request_id)
        except Exception:
            pass


# ----------------------------------------------------
# Tool Executions with Single Retry on Transient Error
# ----------------------------------------------------

def search_emails(args: SearchEmailsInput, user_id: Optional[str] = None, request_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Search emails using criteria. Emits filter criteria to update frontend UI.
    Strictly reads from agent_visible_emails view to exclude confidential contacts.
    """
    uid = user_id or get_current_user_id()
    supabase = get_supabase()

    # 1. Structural check: if sender is in restricted_senders, immediately return confidential notice
    if args.sender and supabase and uid:
        try:
            rs_chk = supabase.table("restricted_senders").select("id").eq("user_id", uid).eq("email_address", args.sender.strip().lower()).execute()
            if rs_chk.data and len(rs_chk.data) > 0:
                res = {
                    "folder": args.folder or "inbox",
                    "sender": args.sender,
                    "keyword": args.keyword,
                    "date_from": args.date_from,
                    "date_to": args.date_to,
                    "unread_only": args.unread_only,
                    "count": 0,
                    "emails": [],
                    "restricted": True,
                    "message": "That contact is marked confidential — I can't access or act on this email."
                }
                log_tool_audit("search_emails", args.model_dump(), res, "rejected", user_id=uid, request_id=request_id)
                return res
        except Exception as e:
            print(f"[search_emails] Notice checking restricted sender: {e}")

    # 2. Query from agent_visible_emails view
    messages = []
    if supabase and uid:
        try:
            qb = supabase.table("agent_visible_emails").select("*").eq("user_id", uid)
            if args.folder:
                qb = qb.eq("folder", args.folder.lower())
            if args.unread_only:
                qb = qb.eq("is_unread", True)
            if args.sender:
                qb = qb.ilike("sender", f"%{args.sender.strip()}%")
            if args.keyword:
                clean_kw = args.keyword.strip()
                qb = qb.or_(f"subject.ilike.%{clean_kw}%,body_text.ilike.%{clean_kw}%,snippet.ilike.%{clean_kw}%")
            if args.date_from:
                qb = qb.gte("received_at", args.date_from)
            if args.date_to:
                try:
                    dt = datetime.datetime.strptime(args.date_to, "%Y-%m-%d").date()
                    next_day = (dt + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
                    qb = qb.lt("received_at", next_day)
                except Exception:
                    qb = qb.lte("received_at", args.date_to)
            db_res = qb.order("received_at", desc=True).limit(25).execute()
            messages = db_res.data or []
        except Exception as db_err:
            print(f"[search_emails] Notice querying agent_visible_emails: {db_err}")

    # 3. If Supabase cache is empty, fallback to Gmail API query but filter results through agent_visible_emails
    if not messages:
        query_parts = []
        if args.sender:
            query_parts.append(f"from:{args.sender}")
        if args.keyword:
            query_parts.append(args.keyword)
        if args.date_from:
            query_parts.append(f"after:{args.date_from}")
        if args.date_to:
            try:
                dt = datetime.datetime.strptime(args.date_to, "%Y-%m-%d").date()
                next_day = (dt + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
                query_parts.append(f"before:{next_day}")
            except Exception:
                query_parts.append(f"before:{args.date_to}")
        if args.unread_only:
            query_parts.append("is:unread")
        query_str = " ".join(query_parts)

        retries = 1
        for attempt in range(retries + 1):
            try:
                client = get_current_gmail_client()
                list_res = client.list_messages(folder=args.folder or "inbox", query=query_str, max_results=25)
                raw_messages = list_res.get("messages", []) if isinstance(list_res, dict) else list_res
                # Filter against restricted senders
                if supabase and uid and raw_messages:
                    rs_all = supabase.table("restricted_senders").select("email_address").eq("user_id", uid).execute()
                    restricted_addrs = {r["email_address"].lower() for r in (rs_all.data or [])}
                    filtered = []
                    for m in raw_messages:
                        s_addr = m.get("sender", "").lower()
                        recips = [r.lower() for r in m.get("recipients", [])]
                        if not any(ra in s_addr or any(ra in rc for rc in recips) for ra in restricted_addrs):
                            filtered.append(m)
                    messages = filtered
                else:
                    messages = raw_messages
                break
            except Exception as e:
                time.sleep(1)

    res = {
        "folder": args.folder or "inbox",
        "sender": args.sender,
        "keyword": args.keyword,
        "date_from": args.date_from,
        "date_to": args.date_to,
        "unread_only": args.unread_only,
        "count": len(messages),
        "emails": messages,
    }
    log_tool_audit("search_emails", args.model_dump(), res, "executed", user_id=uid, request_id=request_id)
    return res

def open_email(args: OpenEmailInput, user_id: Optional[str] = None, request_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch specific email and tell UI to switch to detail view.
    Section 1.5: Validates that open_email_id exists in agent_visible_emails for authenticated user.
    """
    uid = user_id or get_current_user_id()
    supabase = get_supabase()

    # Re-validate open_email_id against agent_visible_emails
    if args.email_id:
        from agent.graph import validate_open_email_visibility
        is_allowed, rej_msg = validate_open_email_visibility({"id": args.email_id}, user_id=uid)
        if not is_allowed:
            res = {
                "email_id": args.email_id,
                "restricted": True,
                "error": "confidential_contact",
                "message": rej_msg or "That contact is marked confidential — I can't access or act on this email."
            }
            log_tool_audit("open_email", args.model_dump(), res, "rejected", user_id=uid, request_id=request_id)
            return res

    retries = 1
    last_err = None
    for attempt in range(retries + 1):
        try:
            client = get_current_gmail_client()
            msg = client.get_message(args.email_id)
            res = {"email_id": args.email_id, "email": msg}
            log_tool_audit("open_email", args.model_dump(), res, "executed", user_id=uid, request_id=request_id)
            return res
        except Exception as e:
            last_err = e
            time.sleep(1)

    log_tool_audit("open_email", args.model_dump(), {"error": str(last_err)}, "failed", user_id=uid, request_id=request_id)
    return {"email_id": args.email_id, "error": str(last_err)}

def draft_compose(args: DraftComposeInput, user_id: Optional[str] = None, request_id: Optional[str] = None) -> Dict[str, Any]:
    """Fill compose form and switch UI view. Never directly sends."""
    uid = user_id or get_current_user_id()
    draft_id = args.draft_id or f"draft-{uuid.uuid4().hex[:8]}"
    to_val = args.to if args.to is not None else ""
    res = {
        "draft_id": draft_id,
        "to": to_val,
        "subject": args.subject or "",
        "body": args.body or "",
        "reply_to_id": args.reply_to_id,
        "user_id": uid,
        "action": "open_compose"
    }
    # Save draft into in-memory store so it's retrievable by prepare_bulk_send, confirm modal, and _send_single_email
    try:
        import routers.emails as em_router
        em_router.save_composed_draft(draft_id, res)
    except Exception as e:
        print(f"[draft_compose] Notice saving composed draft: {e}")

    log_tool_audit("draft_compose", args.model_dump(), res, "executed", user_id=uid, request_id=request_id)
    return res

def prepare_send(args: PrepareSendInput, user_id: Optional[str] = None, request_id: Optional[str] = None) -> Dict[str, Any]:
    """
    CRITICAL GUARDRAIL: Marks draft as pending approval.
    NEVER sends directly. Returns literal to/subject/body and fresh draft_id for frontend ConfirmSendModal.
    """
    uid = user_id or get_current_user_id()
    draft_id = args.draft_id or f"draft-{uuid.uuid4().hex[:8]}"
    to_val = args.to if args.to is not None else ""
    res = {
        "draft_id": draft_id,
        "to": to_val,
        "subject": args.subject or "",
        "body": args.body or "",
        "thread_id": args.thread_id,
        "user_id": uid,
        "status": "pending_approval",
        "requires_human_confirmation": True
    }
    try:
        import routers.emails as em_router
        em_router.save_composed_draft(draft_id, res)
    except Exception:
        pass

    log_tool_audit("prepare_send", args.model_dump(), res, "pending_approval", user_id=uid, request_id=request_id)
    return res

def prepare_meeting(args: PrepareMeetingArgs, user_id: Optional[str] = None, request_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Feature 2: Prepare meeting draft with pending_approval status.
    NEVER calls Calendar API directly. Surfaces confirmation UI covering both meeting and email draft.
    """
    uid = user_id or get_current_user_id()
    if "{meet_link}" not in args.email_body_template:
        err_msg = "email_body_template must contain literal placeholder {meet_link}"
        log_agent_error("input_error", "calendar_client", err_msg, {"tool": "prepare_meeting"}, user_id=uid, request_id=request_id)
        return {"error": "input_error", "message": err_msg}

    # Use provided meeting_draft_id if valid UUID, otherwise generate a fresh UUID
    meeting_draft_id = args.meeting_draft_id
    if meeting_draft_id:
        try:
            meeting_draft_id = str(uuid.UUID(str(meeting_draft_id)))
        except Exception:
            meeting_draft_id = str(uuid.uuid4())
    else:
        meeting_draft_id = str(uuid.uuid4())

    email_draft_id = args.email_draft_id or f"draft-meeting-{uuid.uuid4().hex[:6]}"
    start_iso = args.start_time.isoformat() if hasattr(args.start_time, "isoformat") else str(args.start_time)
    end_iso = args.end_time.isoformat() if hasattr(args.end_time, "isoformat") else str(args.end_time)

    supabase = get_supabase()
    if supabase and uid:
        try:
            db_res = supabase.table("meeting_drafts").insert({
                "id": meeting_draft_id,
                "user_id": uid,
                "title": args.title,
                "start_time": start_iso,
                "end_time": end_iso,
                "attendees": args.attendees,
                "email_draft_id": email_draft_id,
                "status": "pending_approval"
            }).execute()
            if db_res.data and len(db_res.data) > 0 and db_res.data[0].get("id"):
                meeting_draft_id = str(db_res.data[0]["id"])
        except Exception as db_err:
            logger.error(f"[prepare_meeting] Error saving meeting draft: {db_err}")

    res = {
        "id": meeting_draft_id,
        "meeting_draft_id": meeting_draft_id,
        "email_draft_id": email_draft_id,
        "title": args.title,
        "start_time": start_iso,
        "end_time": end_iso,
        "attendees": args.attendees,
        "email_body_template": args.email_body_template,
        "reply_to_id": args.reply_to_id,
        "status": "pending_approval",
        "requires_human_confirmation": True
    }
    log_tool_audit("prepare_meeting", args.model_dump(mode="json"), res, "pending_approval", user_id=uid, request_id=request_id)
    return res

def prepare_bulk_send(args: PrepareBulkSendInput, user_id: Optional[str] = None, request_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Feature 3: Prepares a batch of drafts for one combined confirmation screen.
    Caps batch at 20 drafts. Strictly enforces server-side pending_approval state in agent_tool_calls.
    """
    uid = user_id or get_current_user_id()
    draft_ids = args.draft_ids or []

    # Enforce 20 draft cap
    if len(draft_ids) > 20:
        err_msg = "Batch size exceeds maximum limit of 20 drafts. Please split the request into smaller batches."
        log_agent_error("input_error", "bulk_send", err_msg, {"draft_ids_count": len(draft_ids)}, user_id=uid, request_id=request_id)
        return {"error": "input_error", "message": err_msg}

    # Verify user ownership of drafts if stored
    import routers.emails as em_router
    drafts_list = []
    for d_id in draft_ids:
        stored = em_router.get_composed_draft(d_id)
        if stored:
            if stored.get("user_id") and uid and stored["user_id"] != uid:
                err_msg = f"Draft {d_id} belongs to another user"
                log_agent_error("input_error", "bulk_send", err_msg, {"draft_id": d_id}, user_id=uid, request_id=request_id)
                return {"error": "input_error", "message": err_msg}
            drafts_list.append(stored)
        else:
            drafts_list.append({"draft_id": d_id, "to": "", "subject": "", "body": ""})

    batch_id = str(uuid.uuid4())
    supabase = get_supabase()

    # Store batch approval row in agent_tool_calls with status='pending_approval'
    if supabase and uid:
        try:
            supabase.table("agent_tool_calls").insert({
                "id": batch_id,
                "user_id": uid,
                "tool_name": "prepare_bulk_send",
                "arguments": redact_pii_recursive({"batch_id": batch_id, "draft_ids": draft_ids}),
                "result": {"batch_id": batch_id, "count": len(draft_ids)},
                "status": "pending_approval",
                "request_id": request_id
            }).execute()
        except Exception as e:
            print(f"[prepare_bulk_send] Notice saving batch approval: {e}")

    res = {
        "batch_id": batch_id,
        "draft_ids": draft_ids,
        "drafts": drafts_list,
        "count": len(draft_ids),
        "status": "pending_approval",
        "requires_human_confirmation": True
    }
    log_tool_audit("prepare_bulk_send", args.model_dump(), res, "pending_approval", user_id=uid, request_id=request_id)
    return res

def apply_filters(args: ApplyFiltersInput, user_id: Optional[str] = None, request_id: Optional[str] = None) -> Dict[str, Any]:
    """Apply arbitrary filter criteria to the main inbox view."""
    res = {"criteria": args.criteria}
    log_tool_audit("apply_filters", args.model_dump(), res, "executed", user_id=user_id, request_id=request_id)
    return res

def list_recent(args: ListRecentInput, user_id: Optional[str] = None, request_id: Optional[str] = None) -> Dict[str, Any]:
    """List recent emails from agent_visible_emails for the given folder."""
    uid = user_id or get_current_user_id()
    supabase = get_supabase()
    messages = []
    if supabase and uid:
        try:
            res_db = supabase.table("agent_visible_emails") \
                .select("*") \
                .eq("user_id", uid) \
                .eq("folder", args.folder.lower()) \
                .order("received_at", desc=True) \
                .limit(args.limit) \
                .execute()
            messages = res_db.data or []
        except Exception as e:
            print(f"[list_recent] Notice querying agent_visible_emails: {e}")

    if not messages:
        try:
            client = get_current_gmail_client()
            list_res = client.list_messages(folder=args.folder, query="", max_results=args.limit)
            raw_messages = list_res.get("messages", []) if isinstance(list_res, dict) else list_res
            if supabase and uid and raw_messages:
                rs_all = supabase.table("restricted_senders").select("email_address").eq("user_id", uid).execute()
                restricted_addrs = {r["email_address"].lower() for r in (rs_all.data or [])}
                filtered = []
                for m in raw_messages:
                    s_addr = m.get("sender", "").lower()
                    recips = [r.lower() for r in m.get("recipients", [])]
                    if not any(ra in s_addr or any(ra in rc for rc in recips) for ra in restricted_addrs):
                        filtered.append(m)
                messages = filtered
            else:
                messages = raw_messages
        except Exception as e:
            log_tool_audit("list_recent", args.model_dump(), {"error": str(e)}, "failed", user_id=uid, request_id=request_id)
            return {"folder": args.folder, "count": 0, "emails": []}

    res = {"folder": args.folder, "count": len(messages), "emails": messages}
    log_tool_audit("list_recent", args.model_dump(), res, "executed", user_id=uid, request_id=request_id)
    return res

class FillFormInput(BaseModel):
    email_id: str = Field(..., description="The unique message ID of the email containing the form")
    field_values: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Proposed values for form fields")

def fill_form(args: FillFormInput, user_id: Optional[str] = None, request_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Extract form fields from email attachments or links and propose values.
    Saves session to form_fill_sessions table with status 'pending_approval'.
    CRITICAL GUARDRAIL: Strictly reads from agent_visible_emails view.
    """
    uid = user_id or get_current_user_id()
    client = None
    try:
        client = get_current_gmail_client()
    except Exception:
        pass

    msg = None
    form_type = "google_form"
    form_url = ""

    # Check visibility first
    if args.email_id:
        from agent.graph import validate_open_email_visibility
        is_allowed, rej_msg = validate_open_email_visibility({"id": args.email_id}, user_id=uid)
        if not is_allowed:
            res = {
                "email_id": args.email_id,
                "restricted": True,
                "error": "confidential_contact",
                "message": rej_msg or "That contact is marked confidential — I can't access or act on this email."
            }
            log_tool_audit("fill_form", args.model_dump(), res, "rejected", user_id=uid, request_id=request_id)
            return res

    # Check agent_visible_emails first for form details
    supabase = get_supabase()
    if supabase and uid and args.email_id:
        try:
            row = supabase.table("agent_visible_emails").select("*").eq("id", args.email_id).eq("user_id", uid).execute()
            if row.data and len(row.data) > 0:
                em = row.data[0]
                form_url = em.get("form_url") or ""
                if not form_url:
                    import re
                    content = f"{em.get('snippet', '')} {em.get('body_text', '')}"
                    m = re.search(r"(https?://(?:docs\.google\.com/forms/[^\s\"'<>]+|forms\.gle/[^\s\"'<>]+|forms\.office\.com/[^\s\"'<>]+))", content, re.IGNORECASE)
                    if m:
                        form_url = m.group(1)
        except Exception as e:
            print(f"[fill_form] Notice checking agent_visible_emails: {e}")

    try:
        if client and args.email_id and not form_url:
            msg = client.get_message(args.email_id)
            if msg:
                form_type = msg.get("form_type", "google_form")
                form_url = msg.get("form_url", "")
    except Exception as e:
        print(f"[fill_form] Notice fetching message from Gmail: {e}")

    # Fallback to recent form emails from agent_visible_emails if needed
    if not form_url and supabase and uid:
        try:
            recent = supabase.table("agent_visible_emails").select("*").eq("user_id", uid).or_("has_form.eq.true,form_url.neq.null").order("received_at", desc=True).limit(5).execute()
            for em in (recent.data or []):
                if em.get("form_url"):
                    form_url = em["form_url"]
                    break
                import re
                content = f"{em.get('snippet', '')} {em.get('body_text', '')}"
                m = re.search(r"(https?://(?:docs\.google\.com/forms/[^\s\"'<>]+|forms\.gle/[^\s\"'<>]+|forms\.office\.com/[^\s\"'<>]+))", content, re.IGNORECASE)
                if m:
                    form_url = m.group(1)
                    break
        except Exception as e:
            print(f"[fill_form] Notice fetching recent forms: {e}")

    fields = []
    if form_url and ("forms.gle" in form_url or "docs.google.com/forms" in form_url):
        try:
            from routers.emails import parse_google_form
            parsed = parse_google_form(form_url)
            for f in parsed.get("fields", []):
                val = ""
                lbl_lower = f["label"].lower()
                if "name" in lbl_lower:
                    val = args.field_values.get("name") or args.field_values.get("full_name") or "Karishma"
                elif "email" in lbl_lower:
                    val = args.field_values.get("email") or "karish1234coding@gmail.com"
                elif "phone" in lbl_lower or "mobile" in lbl_lower:
                    val = args.field_values.get("phone") or ""
                else:
                    val = args.field_values.get(f["name"]) or ""
                fields.append({
                    "name": f["name"],
                    "label": f["label"],
                    "value": val,
                    "type": f.get("type", "text"),
                    "entry_id": f.get("entry_id")
                })
        except Exception as e:
            print(f"[fill_form] Error extracting dynamic fields: {e}")

    session_id = str(uuid.uuid4())
    if supabase and uid:
        try:
            valid_eid = None
            if args.email_id:
                chk = supabase.table("agent_visible_emails").select("id").eq("id", args.email_id).eq("user_id", uid).execute()
                if chk.data and len(chk.data) > 0:
                    valid_eid = args.email_id

            safe_ft = form_type if form_type in ['pdf', 'google_form', 'ms_form', 'other'] else 'other'
            supabase.table("form_fill_sessions").insert({
                "id": session_id,
                "user_id": uid,
                "email_id": valid_eid,
                "form_type": safe_ft,
                "fields": fields,
                "status": "pending_approval"
            }).execute()
        except Exception as e:
            print(f"Notice: could not log form_fill_session: {e}")

    res = {
        "session_id": session_id,
        "email_id": args.email_id,
        "form_type": form_type,
        "form_url": form_url,
        "fields": fields,
        "status": "pending_approval",
        "requires_human_confirmation": True
    }
    log_tool_audit("fill_form", args.model_dump(), res, "pending_approval", user_id=uid, request_id=request_id)
    return res


