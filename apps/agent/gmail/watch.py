from typing import Dict, Any, Optional
from config import settings
from routers.emails import get_current_gmail_client

def setup_gmail_watch() -> Optional[Dict[str, Any]]:
    """
    Registers Gmail users.watch() push notifications to Google Cloud Pub/Sub topic.
    Topic name from config: GMAIL_PUBSUB_TOPIC (e.g. projects/my-proj/topics/gmail-notifications)
    """
    if not settings.GMAIL_PUBSUB_TOPIC:
        print("[GmailWatch] Pub/Sub topic not configured in environment. 15-second polling fallback will be active.")
        return None

    try:
        client = get_current_gmail_client()
        request_body = {
            "topicName": settings.GMAIL_PUBSUB_TOPIC,
            "labelIds": ["INBOX"]
        }
        res = client.service.users().watch(userId="me", body=request_body).execute()
        print(f"[GmailWatch] Successfully registered watch: {res}")
        return res
    except Exception as e:
        print(f"[GmailWatch] Failed to register watch (will rely on 15s poll fallback): {e}")
        return None

def stop_gmail_watch():
    """Stops watch notifications."""
    try:
        client = get_current_gmail_client()
        client.service.users().stop(userId="me").execute()
    except Exception as e:
        print(f"[GmailWatch] Error stopping watch: {e}")
