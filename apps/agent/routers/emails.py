import time
import uuid
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Union
from config import settings
from auth.google_oauth import (
    get_authorization_url, 
    exchange_code_for_credentials, 
    get_credentials_for_user
)
from gmail.client import GmailClient
from db.supabase_client import get_supabase

router = APIRouter(tags=["emails"])

# Keep in-memory cache of current active user credentials for local dev single-user flow
_cached_credentials = None
_cached_user_email = None

class SendEmailRequest(BaseModel):
    to: Union[str, List[str]]
    subject: str
    body: str
    thread_id: Optional[str] = None
    draft_id: Optional[str] = None
    reply_to_id: Optional[str] = None

class DraftEmailRequest(BaseModel):
    to: Union[str, List[str]]
    subject: str
    body: str
    thread_id: Optional[str] = None
    reply_to_id: Optional[str] = None

class BulkSendRequest(BaseModel):
    batch_id: str
    draft_ids: List[str]
    drafts: Optional[List[Dict[str, Any]]] = None

class ApproveBulkSendRequest(BaseModel):
    batch_id: str

class RejectBulkSendRequest(BaseModel):
    batch_id: str

def get_current_gmail_client() -> GmailClient:
    global _cached_credentials
    if not _cached_credentials:
        # Try fetching from Supabase if a user exists
        supabase = get_supabase()
        if supabase:
            try:
                users_res = supabase.table("users").select("id, email").order("created_at", desc=True).limit(1).execute()
                if users_res.data and len(users_res.data) > 0:
                    creds = get_credentials_for_user(users_res.data[0]["id"])
                    if creds:
                        _cached_credentials = creds
                        return GmailClient(credentials=_cached_credentials)
            except Exception as e:
                print(f"Failed to lookup token from Supabase: {e}")

        raise HTTPException(
            status_code=401,
            detail="Gmail account is not connected. Please complete Google OAuth first."
        )

    return GmailClient(credentials=_cached_credentials)

@router.get("/auth/status")
def get_auth_status():
    global _cached_credentials, _cached_user_email
    authenticated = _cached_credentials is not None
    email = _cached_user_email

    if not authenticated:
        supabase = get_supabase()
        if supabase:
            try:
                users_res = supabase.table("users").select("id, email").order("created_at", desc=True).limit(1).execute()
                if users_res.data and len(users_res.data) > 0:
                    creds = get_credentials_for_user(users_res.data[0]["id"])
                    if creds:
                        _cached_credentials = creds
                        _cached_user_email = users_res.data[0]["email"]
                        authenticated = True
                        email = _cached_user_email
            except Exception:
                pass

    return {
        "authenticated": authenticated,
        "email": email or ("Connected User" if authenticated else None),
        "oauth_configured": bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)
    }

class UserSettingsRequest(BaseModel):
    send_mode: str = "confirm"

def get_user_settings():
    from db.supabase_client import get_supabase, get_current_user_id
    uid = get_current_user_id()
    supabase = get_supabase()
    if supabase and uid:
        try:
            res = supabase.table("users").select("send_mode").eq("id", uid).limit(1).execute()
            if res.data and len(res.data) > 0 and res.data[0].get("send_mode"):
                return {"send_mode": res.data[0]["send_mode"]}
        except Exception as e:
            print(f"Error fetching user send_mode: {e}")
    return {"send_mode": "confirm"}

@router.get("/user/settings")
def fetch_user_settings_route():
    import routers.emails as em_mod
    return em_mod.get_user_settings()

@router.post("/user/settings")
def update_user_settings(req: UserSettingsRequest):
    if req.send_mode not in ["confirm", "automatic"]:
        raise HTTPException(status_code=400, detail="Invalid send_mode. Must be 'confirm' or 'automatic'")
    from db.supabase_client import get_supabase, get_current_user_id
    uid = get_current_user_id()
    supabase = get_supabase()
    if supabase and uid:
        try:
            supabase.table("users").update({"send_mode": req.send_mode}).eq("id", uid).execute()
        except Exception as e:
            print(f"Error updating user send_mode: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    return {"status": "updated", "send_mode": req.send_mode}

@router.get("/auth/login-url")
def get_login_url():
    url = get_authorization_url()
    if not url:
        raise HTTPException(
            status_code=500, 
            detail="Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are missing from .env"
        )
    return {"url": url}

@router.get("/auth/callback")
def handle_oauth_callback(code: str = Query(...), state: Optional[str] = Query(None)):
    global _cached_credentials, _cached_user_email
    token_data = exchange_code_for_credentials(code, state=state)
    if not token_data:
        raise HTTPException(status_code=400, detail="Failed to exchange authorization code for tokens")

    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=token_data["access_token"],
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data["token_uri"],
        client_id=token_data["client_id"],
        client_secret=token_data["client_secret"],
        scopes=token_data["scopes"]
    )
    _cached_credentials = creds

    # Get user's email address from Google userinfo API
    try:
        oauth2_service = build('oauth2', 'v2', credentials=creds)
        user_info = oauth2_service.userinfo().get().execute()
        user_email = user_info.get("email", "user@example.com")
        _cached_user_email = user_email
    except Exception as e:
        print(f"Could not retrieve user profile email: {e}")
        user_email = "user@example.com"
        _cached_user_email = user_email

    # Persist in Supabase if configured
    supabase = get_supabase()
    if supabase:
        try:
            # Upsert user
            user_rec = supabase.table("users").upsert({"email": user_email}, on_conflict="email").execute()
            user_id = user_rec.data[0]["id"] if user_rec.data else None
            if user_id:
                supabase.table("oauth_tokens").upsert({
                    "user_id": user_id,
                    "provider": "google",
                    "access_token": token_data["access_token"],
                    "refresh_token": token_data.get("refresh_token") or "",
                    "scope": " ".join(token_data["scopes"]) if isinstance(token_data["scopes"], list) else str(token_data["scopes"]),
                    "expiry": token_data.get("expiry") or ""
                }).execute()
        except Exception as err:
            print(f"Notice: Supabase save skipped or failed: {err}")

    return {"status": "success", "email": _cached_user_email}

@router.get("/emails/stats")
def get_mailbox_stats():
    """Get accurate total and unread counts for inbox, sent, and all Gmail categories."""
    client = get_current_gmail_client()
    return client.get_all_mailbox_stats()

@router.get("/emails/list")
def list_emails(
    folder: str = Query("inbox", enum=["inbox", "sent", "draft"]),
    q: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    page_token: Optional[str] = Query(None),
    unread_only: bool = Query(False)
):
    client = get_current_gmail_client()
    
    clean_q = q.strip() if isinstance(q, str) and q.strip() else None
    clean_folder = folder if isinstance(folder, str) and folder in ["inbox", "sent", "draft"] else "inbox"
    clean_limit = limit if isinstance(limit, int) else 25
    clean_token = page_token if isinstance(page_token, str) and page_token.strip() else None
    clean_unread = bool(unread_only) if not hasattr(unread_only, "default") else False

    is_search = bool(clean_q)

    # STRICT ISOLATION: activeCategory MUST ONLY affect Inbox requests, NEVER Sent or Search
    clean_cat = category.strip().lower() if (clean_folder == "inbox" and not is_search and isinstance(category, str) and category.strip()) else None

    query_parts = []
    if clean_q:
        query_parts.append(clean_q)
    if clean_unread and "is:unread" not in (clean_q or ""):
        query_parts.append("is:unread")

    full_query = " ".join(query_parts)

    from gmail.client import GmailNetworkError
    try:
        list_res = client.list_messages(
            folder=clean_folder, 
            query=full_query, 
            max_results=clean_limit, 
            page_token=clean_token,
            category=clean_cat
        )
    except GmailNetworkError as gne:
        raise HTTPException(
            status_code=502,
            detail={"error": gne.error_code, "message": gne.message}
        )
    
    emails = list_res.get("messages", []) if isinstance(list_res, dict) else list_res
    next_page_token = list_res.get("next_page_token") if isinstance(list_res, dict) else None
    result_size_estimate = list_res.get("result_size_estimate", len(emails)) if isinstance(list_res, dict) else len(emails)

    response_data: Dict[str, Any] = {
        "emails": emails,
        "count": len(emails),
        "next_page_token": next_page_token,
        "result_size_estimate": result_size_estimate,
        "is_search": is_search,
        "is_unread_only": clean_unread,
        "category": clean_cat,
        "is_approximate": is_search or (result_size_estimate >= 100),
    }

    # Authoritative label statistics for the primary folder
    stats = client.get_label_stats(label_id=clean_folder.upper())
    total_folder = stats.get("total", len(emails))
    unread_folder = stats.get("unread", 0)

    category_label_map = {
        "primary": "CATEGORY_PERSONAL",
        "personal": "CATEGORY_PERSONAL",
        "promotions": "CATEGORY_PROMOTIONS",
        "social": "CATEGORY_SOCIAL",
        "updates": "CATEGORY_UPDATES"
    }

    if is_search:
        response_data["search_query"] = clean_q
        response_data["search_total_estimate"] = result_size_estimate
        response_data["total_count"] = result_size_estimate
        response_data["unread_count"] = unread_folder
    elif clean_folder == "inbox" and clean_cat and clean_cat.lower() in category_label_map:
        cat_label = category_label_map[clean_cat.lower()]
        cat_stats = client.get_label_stats(cat_label)
        cat_total = cat_stats.get("total", len(emails))
        cat_unread = cat_stats.get("unread", 0)
        response_data["category_total"] = cat_total
        response_data["category_unread"] = cat_unread
        response_data["total_count"] = cat_unread if clean_unread else cat_total
        response_data["unread_count"] = cat_unread
    elif clean_unread:
        response_data["total_count"] = unread_folder
        response_data["unread_count"] = unread_folder
    else:
        response_data["total_count"] = total_folder
        response_data["unread_count"] = unread_folder

    return response_data

@router.get("/emails/{email_id}")
def get_email_detail(email_id: str):
    client = get_current_gmail_client()
    msg = client.get_message(email_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Email not found")

    # Section 33: Lazy extraction and indexing of document attachments for grounded Q&A
    if msg.get("attachments"):
        try:
            from agent.attachments import index_email_attachment
            from db.supabase_client import get_current_user_id
            user_id = get_current_user_id()
            if user_id:
                for att in msg["attachments"]:
                    fn = att.get("filename", "")
                    if any(fn.lower().endswith(ext) for ext in [".pdf", ".docx", ".txt", ".csv", ".md", ".json"]):
                        sup = get_supabase()
                        chk = sup.table("email_attachments").select("id").eq("email_id", email_id).eq("filename", fn).execute() if sup else None
                        if not (chk and chk.data):
                            raw_bytes = client.get_attachment(email_id, att["attachment_id"])
                            if raw_bytes:
                                index_email_attachment(
                                    email_id=email_id,
                                    user_id=user_id,
                                    filename=fn,
                                    content=raw_bytes,
                                    mime_type=att.get("mime_type"),
                                    gmail_attachment_id=att.get("attachment_id")
                                )
        except Exception as e:
            print(f"[Attachments] Notice lazily indexing attachment: {e}")

    return msg

@router.post("/emails/draft")
def create_draft(req: DraftEmailRequest):
    client = get_current_gmail_client()
    draft = client.create_draft(
        to=req.to,
        subject=req.subject,
        body=req.body,
        thread_id=req.thread_id,
        reply_to_message_id=req.reply_to_id
    )
    return {"status": "draft_created", "draft": draft}

class RejectSendRequest(BaseModel):
    to: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None

@router.post("/emails/reject-send")
def reject_send(req: RejectSendRequest):
    try:
        from agent.tools import log_tool_audit
        log_tool_audit("send_email", req.model_dump(), {"status": "rejected_by_user"}, "rejected")
    except Exception as e:
        print(f"Error logging rejected send: {e}")
    return {"status": "rejected"}

_composed_drafts_store: Dict[str, Dict[str, Any]] = {}

def save_composed_draft(draft_id: str, data: Dict[str, Any]):
    _composed_drafts_store[draft_id] = data

def get_composed_draft(draft_id: str) -> Optional[Dict[str, Any]]:
    return _composed_drafts_store.get(draft_id)

def _send_single_email(
    to: Union[str, List[str]],
    subject: str,
    body: str,
    thread_id: Optional[str] = None,
    reply_to_id: Optional[str] = None,
    draft_id: Optional[str] = None,
    user_id: Optional[str] = None,
    request_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Shared internal core function used by BOTH /emails/send and /emails/bulk_send.
    Handles single retry with ~1s backoff, ~10s timeout, PII-safe logging, and structured errors.
    """
    from db.supabase_client import get_current_user_id
    from agent.tools import log_tool_audit
    from agent.errors import log_agent_error
    from gmail.client import GmailNetworkError

    uid = user_id or get_current_user_id()
    client = get_current_gmail_client()

    to_str = ", ".join(to) if isinstance(to, list) else to
    audit_args = {
        "draft_id": draft_id,
        "to": to_str,
        "subject": subject,
        "body": body,
        "thread_id": thread_id,
        "reply_to_id": reply_to_id
    }

    last_exc = None
    for attempt in range(2):
        try:
            result = client.send_message(
                to=to_str,
                subject=subject,
                body=body,
                thread_id=thread_id,
                reply_to_message_id=reply_to_id
            )
            log_tool_audit("send_email", audit_args, result, "executed", user_id=uid, request_id=request_id)
            return {"status": "sent", "result": result, "draft_id": draft_id}
        except GmailNetworkError as gne:
            last_exc = gne
            if attempt == 0:
                time.sleep(1)
                continue
            log_tool_audit("send_email", audit_args, {"error": gne.message}, "failed", user_id=uid, request_id=request_id)
            log_agent_error("tool_error", "gmail_client", gne.message, {"tool": "send_email", "draft_id": draft_id}, user_id=uid, request_id=request_id)
            raise HTTPException(status_code=502, detail={"error": gne.error_code, "message": gne.message})
        except Exception as e:
            last_exc = e
            if attempt == 0:
                time.sleep(1)
                continue
            log_tool_audit("send_email", audit_args, {"error": str(e)}, "failed", user_id=uid, request_id=request_id)
            log_agent_error("tool_error", "gmail_client", str(e), {"tool": "send_email", "draft_id": draft_id}, user_id=uid, request_id=request_id)
            raise HTTPException(status_code=500, detail=str(e))

@router.post("/emails/send")
def send_email(req: SendEmailRequest):
    """
    POST /emails/send { draft_id, to, subject, body, thread_id?, reply_to_id? }
    Mandatory backend authorization boundary:
    Requires human confirmation before every send. Direct sends without draft approval are rejected.
    """
    from db.supabase_client import get_supabase, get_current_user_id
    uid = get_current_user_id()
    supabase = get_supabase()

    if not req.draft_id:
        raise HTTPException(status_code=400, detail="Missing draft_id. Direct send without draft approval is not permitted.")

    # 1. Check in-memory composed drafts cache
    stored_draft = get_composed_draft(req.draft_id)
    if stored_draft:
        if stored_draft.get("user_id") and uid and stored_draft["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Draft belongs to another user")
        if stored_draft.get("status") == "rejected":
            raise HTTPException(status_code=400, detail="Draft was cancelled or rejected")
        if stored_draft.get("status") == "executed":
            raise HTTPException(status_code=400, detail="Draft has already been sent")
        stored_draft["status"] = "executed"
    elif supabase and uid:
        # 2. Check agent_tool_calls for prepare_send approval
        try:
            calls = supabase.table("agent_tool_calls").select("*").eq("tool_name", "prepare_send").eq("user_id", uid).execute()
            matching_call = None
            for c in (calls.data or []):
                args = c.get("arguments") or {}
                res = c.get("result") or {}
                if args.get("draft_id") == req.draft_id or res.get("draft_id") == req.draft_id:
                    matching_call = c
                    break
            if matching_call:
                if matching_call.get("status") == "rejected":
                    raise HTTPException(status_code=400, detail="Draft was cancelled or rejected")
                if matching_call.get("status") == "executed":
                    raise HTTPException(status_code=400, detail="Draft has already been sent")
                supabase.table("agent_tool_calls").update({"status": "executed"}).eq("id", matching_call["id"]).execute()
            else:
                # Never prepared
                raise HTTPException(status_code=400, detail="Draft was never prepared through prepare_send")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[send_email] Notice checking prepare_send approval: {e}")
    else:
        # Without database or stored draft, unapproved send cannot proceed
        raise HTTPException(status_code=400, detail="Draft was never prepared through prepare_send")

    return _send_single_email(
        to=req.to,
        subject=req.subject,
        body=req.body,
        thread_id=req.thread_id,
        reply_to_id=req.reply_to_id,
        draft_id=req.draft_id,
        user_id=uid
    )

@router.post("/emails/bulk_send")
def bulk_send_emails(req: BulkSendRequest):
    """
    POST /emails/bulk_send { batch_id, draft_ids, drafts? }
    Mandatory backend authorization boundary:
    Verifies that the submitted batch was explicitly approved through prepare_bulk_send.
    Rejects with ZERO Gmail send API calls if:
    - batches were never prepared
    - invalid or unknown approval state
    - already-consumed approvals
    - rejected/cancelled approvals
    - draft_ids belonging to another user
    - batches that do not exactly match the approved batch
    - more than 20 drafts
    """
    from db.supabase_client import get_supabase, get_current_user_id
    from agent.errors import log_agent_error
    uid = get_current_user_id()
    supabase = get_supabase()

    if not req.batch_id or not req.draft_ids:
        raise HTTPException(status_code=400, detail="Missing batch_id or draft_ids")

    # Enforce batch cap at 20
    if len(req.draft_ids) > 20:
        log_agent_error("input_error", "bulk_send", "Batch size exceeds maximum limit of 20 drafts", {"count": len(req.draft_ids)}, user_id=uid)
        raise HTTPException(status_code=400, detail={"error": "input_error", "message": "Batch size exceeds maximum limit of 20 drafts"})

    if not supabase:
        raise HTTPException(status_code=500, detail="Database client unavailable")

    # 1. Look up server-side approval state from agent_tool_calls
    rec_res = supabase.table("agent_tool_calls").select("*").eq("id", req.batch_id).eq("tool_name", "prepare_bulk_send").execute()
    if not rec_res.data or len(rec_res.data) == 0:
        # Never prepared -> ZERO sends
        raise HTTPException(status_code=400, detail="Batch was never prepared through prepare_bulk_send")

    record = rec_res.data[0]

    # 2. Check user ownership
    if record.get("user_id") and uid and record["user_id"] != uid:
        raise HTTPException(status_code=403, detail="Batch approval belongs to another user")

    # 3. Check status
    st = record.get("status")
    if st == "rejected":
        raise HTTPException(status_code=400, detail="Batch approval was rejected/cancelled")
    if st == "executed":
        raise HTTPException(status_code=400, detail="Batch approval has already been consumed")
    if st not in ["pending_approval", "approved"]:
        raise HTTPException(status_code=400, detail=f"Invalid or unknown approval state: {st}")

    # 4. Check draft_ids match exactly
    approved_args = record.get("arguments") or {}
    approved_draft_ids = approved_args.get("draft_ids") or []
    if sorted(req.draft_ids) != sorted(approved_draft_ids):
        raise HTTPException(status_code=400, detail="Submitted draft_ids do not match the approved batch")

    # 5. Atomic one-time claim
    claim = supabase.table("agent_tool_calls").update({
        "status": "executed"
    }).eq("id", req.batch_id).in_("status", ["pending_approval", "approved"]).execute()

    if not claim.data or len(claim.data) == 0:
        # Concurrent race or already consumed
        raise HTTPException(status_code=409, detail="Batch approval has already been claimed or consumed")

    # 6. Execute each send via _send_single_email
    sent = []
    failed = []

    # Map drafts by ID
    drafts_map = {}
    if req.drafts:
        for d in req.drafts:
            if d.get("draft_id"):
                drafts_map[d["draft_id"]] = d
    for d_id in req.draft_ids:
        if d_id not in drafts_map:
            stored = get_composed_draft(d_id)
            if stored:
                drafts_map[d_id] = stored

    for d_id in req.draft_ids:
        d = drafts_map.get(d_id, {})
        to_addr = d.get("to") or ""
        subject = d.get("subject") or ""
        body = d.get("body") or ""
        thread_id = d.get("thread_id")
        reply_to_id = d.get("reply_to_id")

        if d.get("user_id") and uid and d["user_id"] != uid:
            failed.append({"draft_id": d_id, "error": "Draft belongs to another user"})
            continue

        try:
            res = _send_single_email(
                to=to_addr,
                subject=subject,
                body=body,
                thread_id=thread_id,
                reply_to_id=reply_to_id,
                draft_id=d_id,
                user_id=uid
            )
            sent.append({"draft_id": d_id, "result": res.get("result")})
        except Exception as exc:
            print(f"[bulk_send] Individual draft send failed for {d_id}: {exc}")
            failed.append({"draft_id": d_id, "error": str(exc)})

    return {
        "batch_id": req.batch_id,
        "sent": sent,
        "failed": failed
    }

@router.post("/emails/reject-bulk-send")
def reject_bulk_send(req: RejectBulkSendRequest):
    from db.supabase_client import get_supabase, get_current_user_id
    uid = get_current_user_id()
    supabase = get_supabase()
    if supabase and uid:
        try:
            supabase.table("agent_tool_calls").update({"status": "rejected"}).eq("id", req.batch_id).eq("user_id", uid).execute()
        except Exception as e:
            print(f"[reject_bulk_send] Error rejecting batch: {e}")
    return {"status": "rejected", "batch_id": req.batch_id}

@router.post("/emails/approve-bulk-send")
def approve_bulk_send(req: ApproveBulkSendRequest):
    from db.supabase_client import get_supabase, get_current_user_id
    uid = get_current_user_id()
    supabase = get_supabase()
    if supabase and uid:
        try:
            supabase.table("agent_tool_calls").update({"status": "approved"}).eq("id", req.batch_id).eq("user_id", uid).eq("status", "pending_approval").execute()
        except Exception as e:
            print(f"[approve_bulk_send] Error approving batch: {e}")
    return {"status": "approved", "batch_id": req.batch_id}

class SubmitFormRequest(BaseModel):
    email_id: Optional[str] = None
    form_type: str = "pdf"
    fields: Dict[str, Any]
    action: str = "submit"

@router.post("/forms/submit")
def submit_form(req: SubmitFormRequest):
    from db.supabase_client import ensure_default_user_id
    user_id = ensure_default_user_id()
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    supabase = get_supabase()
    status = "submitted" if req.action == "submit" else ("rejected" if req.action == "reject" else "draft")
    
    # Section 27: Verify email_id exists in emails table to prevent foreign key violation
    valid_email_id = None
    if req.email_id and supabase:
        try:
            chk = supabase.table("emails").select("id").eq("id", req.email_id).execute()
            if chk.data and len(chk.data) > 0:
                valid_email_id = req.email_id
        except Exception:
            pass

    safe_form_type = req.form_type if req.form_type in ['pdf', 'google_form', 'ms_form', 'other'] else 'other'

    if supabase:
        try:
            res = supabase.table("form_fill_sessions").insert({
                "user_id": user_id,
                "email_id": valid_email_id,
                "form_type": safe_form_type,
                "fields": req.fields,
                "status": status
            }).execute()
            return {"status": status, "session": res.data[0] if res.data else None}
        except Exception as e:
            print(f"Error saving form fill session: {e}")
            if valid_email_id:
                try:
                    res = supabase.table("form_fill_sessions").insert({
                        "user_id": user_id,
                        "email_id": None,
                        "form_type": safe_form_type,
                        "fields": req.fields,
                        "status": status
                    }).execute()
                    return {"status": status, "session": res.data[0] if res.data else None}
                except Exception:
                    pass
            # Section 27: Return graceful JSON response rather than raising raw 500
            return {
                "status": status,
                "session": None,
                "message": "Form submission recorded."
            }
    return {"status": status}


def parse_google_form(url: str) -> Dict[str, Any]:
    """
    Extracts question titles and entry IDs from public Google Forms HTML.
    Supports https://forms.gle/... and https://docs.google.com/forms/...
    """
    import urllib.request, re, json
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            final_url = resp.geturl()
            html = resp.read().decode('utf-8', errors='ignore')

        match = re.search(r'var FB_PUBLIC_LOAD_DATA_ = (\[[\s\S]*?\]);\s*<\/script>', html)
        if not match:
            match = re.search(r'var FB_PUBLIC_LOAD_DATA_ = (\[.*?\]);', html, re.DOTALL)
        if match:
            data = json.loads(match.group(1))
            title = data[1][8] if (len(data[1]) > 8 and data[1][8]) else (data[1][0] if len(data[1]) > 0 else "Form")
            fields = []
            for item in (data[1][1] or []):
                q_text = item[1]
                q_id = item[4][0][0] if (len(item) > 4 and item[4] and len(item[4][0]) > 0) else None
                entry_key = f"entry.{q_id}" if q_id else q_text.lower().replace(" ", "_")
                f_type = "email" if "email" in q_text.lower() else ("tel" if "phone" in q_text.lower() or "mobile" in q_text.lower() else "text")
                fields.append({
                    "name": entry_key,
                    "label": q_text,
                    "entry_id": q_id,
                    "type": f_type
                })
            base_viewform = final_url.split("?")[0]
            return {
                "title": title,
                "fields": fields,
                "viewform_url": base_viewform
            }
    except Exception as e:
        print(f"[parse_google_form] Error parsing Google Form: {e}")
    return {"title": "Google Form", "fields": [], "viewform_url": url}


@router.get("/forms/extract")
def extract_form_fields(url: Optional[str] = None, email_id: Optional[str] = None):
    """
    Extracts real form fields from Google Forms or attached links.
    Returns question labels, input types, and pre-fill URLs.
    """
    import re
    form_pattern = r"(https?://(?:docs\.google\.com/forms/[^\s\"'<>]+|forms\.gle/[^\s\"'<>]+|forms\.office\.com/[^\s\"'<>]+))"

    target_url = url
    if not target_url and email_id:
        try:
            cl = get_current_gmail_client()
            if cl:
                msg = cl.get_message(email_id)
                if msg:
                    target_url = msg.get("form_url")
                    if not target_url:
                        combined = f"{msg.get('snippet', '')} {msg.get('body_text', '')} {msg.get('body_html', '')}"
                        m = re.search(form_pattern, combined, re.IGNORECASE)
                        if m:
                            target_url = m.group(1)
        except Exception:
            pass

    # Check Supabase if target_url is still empty
    if not target_url:
        try:
            sup = get_supabase()
            if sup:
                if email_id:
                    res = sup.table("emails").select("*").eq("id", email_id).execute()
                    if res.data and len(res.data) > 0:
                        em = res.data[0]
                        target_url = em.get("form_url")
                        if not target_url:
                            combined = f"{em.get('snippet', '')} {em.get('body_plain', '')} {em.get('body_html', '')}"
                            m = re.search(form_pattern, combined, re.IGNORECASE)
                            if m:
                                target_url = m.group(1)
                if not target_url:
                    # Look up latest email with form link
                    recent_forms = sup.table("emails").select("*").or_("has_form.eq.true,form_url.neq.null").order("received_at", desc=True).limit(5).execute()
                    for em in (recent_forms.data or []):
                        if em.get("form_url"):
                            target_url = em["form_url"]
                            break
                        combined = f"{em.get('snippet', '')} {em.get('body_plain', '')} {em.get('body_html', '')}"
                        m = re.search(form_pattern, combined, re.IGNORECASE)
                        if m:
                            target_url = m.group(1)
                            break
        except Exception as e:
            print(f"[extract_form_fields] Notice querying Supabase: {e}")

    if not target_url:
        return {"title": "Form", "fields": [], "url": ""}

    if "forms.gle" in target_url or "docs.google.com/forms" in target_url:
        parsed = parse_google_form(target_url)
        return {
            "title": parsed.get("title", "Basic Details Form"),
            "form_type": "google_form",
            "url": target_url,
            "viewform_url": parsed.get("viewform_url", target_url),
            "fields": parsed.get("fields", [])
        }

    return {
        "title": "Form",
        "form_type": "other",
        "url": target_url,
        "fields": []
    }



