from typing import Optional
from config import settings

_supabase_client = None

def get_supabase():
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client
    
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        return None

    try:
        from supabase import create_client, Client
        _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
        return _supabase_client
    except Exception as e:
        print(f"Warning: Failed to initialize Supabase client: {e}")
        return None

def get_current_user_id() -> Optional[str]:
    """Retrieve the current authenticated user's ID from Supabase."""
    supabase = get_supabase()
    if not supabase:
        return None
    try:
        users_res = supabase.table("users").select("id, email").order("created_at", desc=True).limit(1).execute()
        if users_res.data and len(users_res.data) > 0:
            return users_res.data[0]["id"]
    except Exception as e:
        print(f"Error fetching current user id: {e}")
    return None

def ensure_default_user_id() -> Optional[str]:
    """Ensure at least one authenticated user exists for local single-user workflow."""
    uid = get_current_user_id()
    if uid:
        return uid
    supabase = get_supabase()
    if supabase:
        try:
            res = supabase.table("users").upsert({"email": "user@nebula.local"}, on_conflict="email").execute()
            if res.data:
                return res.data[0]["id"]
        except Exception as e:
            print(f"Error creating default user: {e}")
    return None
