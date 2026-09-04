import base64
import json
from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, Dict, Any
from config import settings
from routers.emails import get_current_gmail_client
from db.supabase_client import get_supabase

router = APIRouter(tags=["webhooks"])

class PubSubMessage(BaseModel):
    data: str
    messageId: str
    publishTime: str

class PubSubPushBody(BaseModel):
    message: PubSubMessage
    subscription: str

@router.post("/webhooks/gmail-pubsub")
async def gmail_pubsub_webhook(
    body: PubSubPushBody, 
    token: Optional[str] = Query(None)
):
    # Optional shared secret verification
    if settings.GMAIL_PUBSUB_VERIFICATION_TOKEN and token != settings.GMAIL_PUBSUB_VERIFICATION_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid webhook verification token")

    try:
        decoded_data = base64.b64decode(body.message.data).decode("utf-8")
        event = json.loads(decoded_data)
        email_address = event.get("emailAddress")
        history_id = event.get("historyId")
        print(f"[Webhook] Received Pub/Sub push notification for {email_address}, historyId: {history_id}")

        # Fetch latest inbox emails to sync into Supabase
        client = get_current_gmail_client()
        recent_messages = client.list_messages(folder="inbox", max_results=10)

        supabase = get_supabase()
        if supabase and recent_messages:
            for msg in recent_messages:
                try:
                    supabase.table("emails").upsert({
                        "id": msg["id"],
                        "thread_id": msg.get("thread_id"),
                        "sender": msg["sender"],
                        "recipients": msg["recipients"],
                        "subject": msg["subject"],
                        "body_text": msg.get("body_text", ""),
                        "body_html": msg.get("body_html", ""),
                        "snippet": msg.get("snippet", ""),
                        "folder": msg.get("folder", "inbox"),
                        "is_unread": msg.get("is_unread", True),
                        "received_at": msg.get("date") or "now()"
                    }, on_conflict="id").execute()
                except Exception as ex:
                    print(f"[Webhook] Sync error on message {msg['id']}: {ex}")

        return {"status": "processed", "history_id": history_id}

    except Exception as e:
        print(f"[Webhook] Error processing notification: {e}")
        return {"status": "error", "detail": str(e)}
