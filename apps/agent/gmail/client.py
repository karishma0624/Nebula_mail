import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Dict, Any, Optional
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials

class GmailClient:
    def __init__(self, credentials: Optional[Credentials] = None):
        self.credentials = credentials
        self.service = build('gmail', 'v1', credentials=credentials) if credentials else None

    def list_messages(
        self, 
        folder: str = "inbox", 
        query: str = "", 
        max_results: int = 25,
        page_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """List messages from Gmail, filtering by folder and search query with native page-token pagination."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        # Build query string
        q_parts = []
        if folder == "inbox":
            q_parts.append("in:inbox")
        elif folder == "sent":
            q_parts.append("in:sent")
        elif folder == "draft":
            q_parts.append("in:draft")

        if query:
            q_parts.append(query)

        full_query = " ".join(q_parts)

        try:
            list_params: Dict[str, Any] = {
                "userId": "me",
                "q": full_query,
                "maxResults": max_results,
            }
            if page_token:
                list_params["pageToken"] = page_token

            results = self.service.users().messages().list(**list_params).execute()

            messages = results.get("messages", [])
            next_page_token = results.get("nextPageToken")
            result_size_estimate = results.get("resultSizeEstimate", len(messages))

            detailed_messages = []
            for msg_meta in messages:
                try:
                    msg = self.get_message(msg_meta["id"])
                    if msg:
                        detailed_messages.append(msg)
                except Exception as e:
                    print(f"Error fetching message {msg_meta['id']}: {e}")

            return {
                "messages": detailed_messages,
                "next_page_token": next_page_token,
                "result_size_estimate": result_size_estimate,
            }
        except HttpError as error:
            print(f"Gmail API error in list_messages: {error}")
            raise error

    def get_label_stats(self, label_id: str = "INBOX") -> Dict[str, int]:
        """Get total and unread message counts for a Gmail label (e.g. INBOX, SENT)."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        normalized_label = label_id.upper() if label_id.lower() in ["inbox", "sent", "draft", "trash", "spam"] else label_id

        try:
            label_info = self.service.users().labels().get(userId="me", id=normalized_label).execute()
            return {
                "total": int(label_info.get("messagesTotal", 0)),
                "unread": int(label_info.get("messagesUnread", 0)),
            }
        except HttpError as error:
            print(f"Gmail API error in get_label_stats: {error}")
            return {"total": 0, "unread": 0}

    def get_message(self, message_id: str) -> Optional[Dict[str, Any]]:
        """Fetch full details for a message by ID."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        try:
            msg = self.service.users().messages().get(
                userId="me",
                id=message_id,
                format="full"
            ).execute()

            headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
            
            # Parse body
            body_text, body_html = self._parse_body(msg.get("payload", {}))
            
            # Determine folder/labels
            label_ids = msg.get("labelIds", [])
            folder = "inbox"
            if "SENT" in label_ids:
                folder = "sent"
            elif "DRAFT" in label_ids:
                folder = "draft"

            is_unread = "UNREAD" in label_ids

            return {
                "id": msg.get("id"),
                "thread_id": msg.get("threadId"),
                "sender": headers.get("from", "Unknown"),
                "recipients": [r.strip() for r in headers.get("to", "").split(",") if r.strip()],
                "subject": headers.get("subject", "(No Subject)"),
                "date": headers.get("date", ""),
                "snippet": msg.get("snippet", ""),
                "body_text": body_text,
                "body_html": body_html,
                "folder": folder,
                "is_unread": is_unread,
                "label_ids": label_ids,
            }
        except HttpError as error:
            print(f"Gmail API error in get_message: {error}")
            raise error

    def _parse_body(self, payload: Dict[str, Any]) -> tuple[str, str]:
        """Extract text and HTML content from email payload parts."""
        body_text = ""
        body_html = ""

        if "parts" in payload:
            for part in payload["parts"]:
                mime_type = part.get("mimeType", "")
                data = part.get("body", {}).get("data", "")
                if data:
                    decoded = base64.urlsafe_b64decode(data.encode("ASCII")).decode("utf-8", errors="replace")
                    if mime_type == "text/plain" and not body_text:
                        body_text = decoded
                    elif mime_type == "text/html" and not body_html:
                        body_html = decoded
                
                # Nested parts (e.g. multipart/related inside multipart/alternative)
                if "parts" in part:
                    sub_text, sub_html = self._parse_body(part)
                    if sub_text and not body_text:
                        body_text = sub_text
                    if sub_html and not body_html:
                        body_html = sub_html
        else:
            data = payload.get("body", {}).get("data", "")
            if data:
                decoded = base64.urlsafe_b64decode(data.encode("ASCII")).decode("utf-8", errors="replace")
                if payload.get("mimeType") == "text/html":
                    body_html = decoded
                else:
                    body_text = decoded

        return body_text, body_html

    def create_draft(self, to: str, subject: str, body: str, thread_id: Optional[str] = None) -> Dict[str, Any]:
        """Create an email draft in Gmail."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        message = MIMEText(body)
        message["to"] = to
        message["subject"] = subject

        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
        draft_body: Dict[str, Any] = {"message": {"raw": raw_message}}
        if thread_id:
            draft_body["message"]["threadId"] = thread_id

        draft = self.service.users().drafts().create(userId="me", body=draft_body).execute()
        return draft

    def send_message(self, to: str, subject: str, body: str, thread_id: Optional[str] = None) -> Dict[str, Any]:
        """Send an email via Gmail API."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        message = MIMEText(body)
        message["to"] = to
        message["subject"] = subject

        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
        send_body: Dict[str, Any] = {"raw": raw_message}
        if thread_id:
            send_body["threadId"] = thread_id

        sent = self.service.users().messages().send(userId="me", body=send_body).execute()
        return sent
