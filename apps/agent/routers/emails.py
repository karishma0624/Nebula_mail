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

class DraftEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    thread_id: Optional[str] = None

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
    """Get accurate total and unread counts for inbox and sent folders from Gmail labels."""
    client = get_current_gmail_client()
    inbox_stats = client.get_label_stats("INBOX")
    sent_stats = client.get_label_stats("SENT")
    return {
        "inbox": inbox_stats,
        "sent": sent_stats
    }

@router.get("/emails/list")
def list_emails(
    folder: str = Query("inbox", enum=["inbox", "sent", "draft"]),
    q: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    page_token: Optional[str] = Query(None),
    unread_only: bool = Query(False)
):
    client = get_current_gmail_client()
    
    query_parts = []
    if q and q.strip():
        query_parts.append(q.strip())
    if unread_only:
        query_parts.append("is:unread")

    full_query = " ".join(query_parts)

    list_res = client.list_messages(
        folder=folder, 
        query=full_query, 
        max_results=limit, 
        page_token=page_token
    )
    
    emails = list_res.get("messages", []) if isinstance(list_res, dict) else list_res
    next_page_token = list_res.get("next_page_token") if isinstance(list_res, dict) else None
    result_size_estimate = list_res.get("result_size_estimate", len(emails)) if isinstance(list_res, dict) else len(emails)

    is_search = bool(q and q.strip())
    response_data: Dict[str, Any] = {
        "emails": emails,
        "count": len(emails),
        "next_page_token": next_page_token,
        "result_size_estimate": result_size_estimate,
        "is_search": is_search,
        "is_unread_only": unread_only,
    }

    stats = client.get_label_stats(label_id=folder.upper())
    total_folder = stats.get("total", len(emails))
    unread_folder = stats.get("unread", 0)

    if is_search:
        response_data["search_query"] = q.strip()
        response_data["search_total_estimate"] = result_size_estimate
        response_data["total_count"] = result_size_estimate
        response_data["unread_count"] = unread_folder
    elif unread_only:
        # In unread-only mode, total count represents total unread messages in the folder
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
        thread_id=req.thread_id
    )
    return {"status": "draft_created", "draft": draft}

@router.post("/emails/send")
def send_email(req: SendEmailRequest):
    client = get_current_gmail_client()
    result = client.send_message(
        to=req.to,
        subject=req.subject,
        body=req.body,
        thread_id=req.thread_id
    )
    return {"status": "sent", "result": result}
