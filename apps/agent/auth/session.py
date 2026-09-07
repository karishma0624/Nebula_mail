import hmac
import hashlib
import json
import base64
import time
from typing import Optional, Dict, Any
from fastapi import Request
from google.oauth2.credentials import Credentials
from config import settings
from db.supabase_client import get_supabase

def _get_signing_key() -> bytes:
    key_str = settings.GOOGLE_CLIENT_SECRET or settings.SUPABASE_SERVICE_ROLE_KEY or "nebula-mail-secure-session-key-2026"
    return key_str.encode("utf-8")

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")

def _b64url_decode(s: str) -> bytes:
    padding = 4 - (len(s) % 4)
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s.encode("utf-8"))

def create_session_token(user_id: str, email: str, expiry_days: int = 30) -> str:
    """Generate a signed, tamper-proof session token for a specific user."""
    payload = {
        "user_id": str(user_id),
        "email": str(email),
        "iat": int(time.time()),
        "exp": int(time.time()) + (expiry_days * 86400)
    }
    payload_bytes = json.dumps(payload, separators=(',', ':')).encode("utf-8")
    payload_b64 = _b64url_encode(payload_bytes)
    
    sig = _b64url_encode(hmac.new(_get_signing_key(), payload_b64.encode("utf-8"), hashlib.sha256).digest())
    return f"{payload_b64}.{sig}"

def verify_session_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify session token signature and expiration. Returns payload if valid, None otherwise."""
    if not token or not isinstance(token, str) or "." not in token:
        return None
    try:
        parts = token.strip().split(".")
        if len(parts) != 2:
            return None
        payload_b64, sig = parts[0], parts[1]
        
        expected_sig = _b64url_encode(hmac.new(_get_signing_key(), payload_b64.encode("utf-8"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected_sig):
            return None
            
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
        if not isinstance(payload, dict):
            return None
            
        if payload.get("exp", 0) < time.time():
            return None # Expired
            
        return payload
    except Exception as e:
        print(f"[Session] Token verification error: {e}")
        return None

def get_session_from_request(request: Optional[Request]) -> Optional[Dict[str, Any]]:
    """Extract and verify user session from Request headers, cookies, or query params."""
    if request is None:
        return None
        
    token = None
    # 1. Authorization: Bearer <token>
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        
    # 2. X-Session-Token header
    if not token:
        token = request.headers.get("x-session-token") or request.headers.get("X-Session-Token")
        
    # 3. Cookie nebula_session_token
    if not token and hasattr(request, "cookies"):
        token = request.cookies.get("nebula_session_token")
        
    # 4. Query param session_token or token
    if not token and hasattr(request, "query_params"):
        token = request.query_params.get("session_token") or request.query_params.get("token")
        
    if token:
        return verify_session_token(token)
    return None

# ==============================================================================
# Isolated Credentials Cache (Per User ID)
# ==============================================================================
_user_credentials_cache: Dict[str, Credentials] = {}

def get_user_credentials(user_id: str) -> Optional[Credentials]:
    """Retrieve Google OAuth Credentials for a specific user ID."""
    if not user_id:
        return None
        
    global _user_credentials_cache
    if user_id in _user_credentials_cache:
        creds = _user_credentials_cache[user_id]
        if creds and not creds.expired:
            return creds
            
    # Lookup from Supabase oauth_tokens table
    from auth.google_oauth import get_credentials_for_user
    creds = get_credentials_for_user(user_id)
    if creds:
        _user_credentials_cache[user_id] = creds
        return creds
        
    return None

def set_user_credentials(user_id: str, creds: Credentials) -> None:
    """Store credentials in per-user cache."""
    if user_id and creds:
        global _user_credentials_cache
        _user_credentials_cache[user_id] = creds

def clear_user_session(user_id: str) -> None:
    """Remove user's cached credentials and revoke/delete ONLY this user's tokens in Supabase."""
    if not user_id:
        return
    global _user_credentials_cache
    _user_credentials_cache.pop(user_id, None)
    
    supabase = get_supabase()
    if supabase:
        try:
            supabase.table("oauth_tokens").delete().eq("user_id", user_id).execute()
        except Exception as err:
            print(f"[Session] Failed to delete user {user_id} tokens: {err}")
