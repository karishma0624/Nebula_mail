from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from db.supabase_client import get_supabase, ensure_default_user_id

router = APIRouter(prefix="/settings", tags=["settings"])

class AddRestrictedSenderRequest(BaseModel):
    email_address: str
    label: Optional[str] = None

@router.get("/restricted-senders")
def list_restricted_senders():
    """List all restricted senders for the currently authenticated user."""
    user_id = ensure_default_user_id()
    supabase = get_supabase()
    if not supabase or not user_id:
        return []
    
    try:
        res = supabase.table("restricted_senders") \
            .select("id, user_id, email_address, label, created_at") \
            .eq("user_id", user_id) \
            .order("created_at", desc=True) \
            .execute()
        return res.data or []
    except Exception as e:
        print(f"[Settings] Error listing restricted senders: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/restricted-senders")
def add_restricted_sender(req: AddRestrictedSenderRequest):
    """Add a new restricted confidential email address for the authenticated user."""
    user_id = ensure_default_user_id()
    supabase = get_supabase()
    if not supabase or not user_id:
        raise HTTPException(status_code=500, detail="Database or user context unavailable")

    cleaned_email = req.email_address.strip().lower()
    if not cleaned_email or "@" not in cleaned_email:
        raise HTTPException(status_code=400, detail="Invalid email address format")

    try:
        res = supabase.table("restricted_senders").insert({
            "user_id": user_id,
            "email_address": cleaned_email,
            "label": req.label.strip() if req.label else None
        }).execute()

        if res.data and len(res.data) > 0:
            return res.data[0]
        return {"status": "created", "email_address": cleaned_email}
    except Exception as e:
        err_msg = str(e)
        if "restricted_senders_unique" in err_msg or "duplicate key" in err_msg:
            raise HTTPException(status_code=409, detail="This email address is already marked confidential")
        print(f"[Settings] Error adding restricted sender: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/restricted-senders/{sender_id}")
def delete_restricted_sender(sender_id: str):
    """Remove a restricted confidential email address, strictly scoped to the authenticated user."""
    user_id = ensure_default_user_id()
    supabase = get_supabase()
    if not supabase or not user_id:
        raise HTTPException(status_code=500, detail="Database or user context unavailable")

    try:
        res = supabase.table("restricted_senders") \
            .delete() \
            .eq("id", sender_id) \
            .eq("user_id", user_id) \
            .execute()
        return {"status": "deleted", "id": sender_id}
    except Exception as e:
        print(f"[Settings] Error deleting restricted sender {sender_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
