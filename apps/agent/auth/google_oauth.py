import os
import datetime
from typing import Optional, Dict, Any
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
import httpx
from config import settings
from db.supabase_client import get_supabase

# Allow non-HTTPS for local development
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

# Exact scopes requested in the specification
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email"
]

_pending_code_verifiers: Dict[str, str] = {}
_latest_code_verifier: Optional[str] = None

def get_client_config() -> Dict[str, Any]:
    return {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID or "",
            "client_secret": settings.GOOGLE_CLIENT_SECRET or "",
            "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
        }
    }

def get_oauth_flow() -> Optional[Flow]:
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        return None
    
    flow = Flow.from_client_config(
        get_client_config(),
        scopes=SCOPES,
        redirect_uri=settings.GOOGLE_REDIRECT_URI
    )
    return flow

def get_authorization_url() -> Optional[str]:
    flow = get_oauth_flow()
    if not flow:
        return None
    flow.autogenerate_code_verifier = False
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        prompt="select_account consent"
    )
    return authorization_url

def exchange_code_for_credentials(code: str, state: Optional[str] = None) -> Optional[Dict[str, Any]]:
    global _latest_code_verifier
    flow = get_oauth_flow()
    if not flow:
        return None

    code_verifier = None
    if state and state in _pending_code_verifiers:
        code_verifier = _pending_code_verifiers.pop(state)
    elif _latest_code_verifier:
        code_verifier = _latest_code_verifier

    try:
        if code_verifier:
            flow.code_verifier = code_verifier
            flow.fetch_token(code=code, code_verifier=code_verifier)
        else:
            flow.fetch_token(code=code)
    except Exception as e:
        print(f"Notice: Flow.fetch_token raised ({e}), attempting direct token POST with client credentials...")
        token_payload = {
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code"
        }
        if code_verifier:
            token_payload["code_verifier"] = code_verifier

        resp = httpx.post("https://oauth2.googleapis.com/token", data=token_payload)
        if resp.status_code == 200:
            data = resp.json()
            expires_in = data.get("expires_in", 3600)
            expiry_dt = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=expires_in)
            return {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token", ""),
                "token_uri": "https://oauth2.googleapis.com/token",
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "scopes": data.get("scope", "").split(" "),
                "expiry": expiry_dt.isoformat()
            }
        else:
            print(f"Direct token exchange error {resp.status_code}: {resp.text}")
            return None

    creds = flow.credentials
    token_data = {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
        "expiry": creds.expiry.isoformat() if creds.expiry else None
    }
    return token_data

def get_credentials_for_user(user_id: str) -> Optional[Credentials]:
    supabase = get_supabase()
    if not supabase:
        return None
    
    response = supabase.table("oauth_tokens").select("*").eq("user_id", user_id).eq("provider", "google").execute()
    if not response.data or len(response.data) == 0:
        return None
    
    token_record = response.data[0]
    creds = Credentials(
        token=token_record["access_token"],
        refresh_token=token_record.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=token_record.get("scope", "").split(" ")
    )
    
    # Refresh if expired
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            # Update token in DB
            supabase.table("oauth_tokens").update({
                "access_token": creds.token,
                "expiry": creds.expiry.isoformat() if creds.expiry else datetime.datetime.now(datetime.timezone.utc).isoformat()
            }).eq("user_id", user_id).eq("provider", "google").execute()
        except Exception as e:
            print(f"Failed to refresh Google OAuth token: {e}")
            return None
            
    return creds
