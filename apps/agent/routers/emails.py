from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
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
    to: str
    subject: str
    body: str
    thread_id: Optional[str] = None
    draft_id: Optional[str] = None
    reply_to_id: Optional[str] = None

class DraftEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    thread_id: Optional[str] = None
    reply_to_id: Optional[str] = None

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

@router.get("/user/settings")
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

@router.post("/emails/send")
def send_email(req: SendEmailRequest):
    client = get_current_gmail_client()
    print(f"[SendEmail] Transmitting: draft_id={req.draft_id}, to={req.to}, subject='{req.subject}', body='{req.body[:60]}...'")
    try:
        result = client.send_message(
            to=req.to,
            subject=req.subject,
            body=req.body,
            thread_id=req.thread_id,
            reply_to_message_id=req.reply_to_id
        )
        try:
            from agent.tools import log_tool_audit
            log_tool_audit("send_email", req.model_dump(), result, "executed")
        except Exception as err:
            print(f"Error logging send_email audit: {err}")
        return {"status": "sent", "result": result, "draft_id": req.draft_id}
    except Exception as e:
        from gmail.client import GmailNetworkError
        if isinstance(e, GmailNetworkError):
            try:
                from agent.tools import log_tool_audit
                log_tool_audit("send_email", req.model_dump(), {"error": e.message}, "failed")
            except Exception:
                pass
            raise HTTPException(
                status_code=502,
                detail={"error": e.error_code, "message": e.message}
            )
        try:
            from agent.tools import log_tool_audit
            log_tool_audit("send_email", req.model_dump(), {"error": str(e)}, "failed")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e))

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
    if supabase:
        try:
            res = supabase.table("form_fill_sessions").insert({
                "user_id": user_id,
                "email_id": req.email_id,
                "form_type": req.form_type if req.form_type in ['pdf', 'google_form', 'ms_form', 'other'] else 'other',
                "fields": req.fields,
                "status": status
            }).execute()
            return {"status": status, "session": res.data[0] if res.data else None}
        except Exception as e:
            print(f"Error saving form fill session: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    return {"status": status}

