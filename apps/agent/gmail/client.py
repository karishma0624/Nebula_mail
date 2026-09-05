import base64
import time
import socket
from urllib.error import URLError
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Dict, Any, Optional
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials

try:
    import httplib2
    HTTP_NETWORK_ERRORS = (
        httplib2.error.ServerNotFoundError,
        httplib2.error.HttpLib2Error,
        socket.gaierror,
        socket.timeout,
        ConnectionError,
        TimeoutError,
        URLError,
    )
except Exception:
    HTTP_NETWORK_ERRORS = (
        socket.gaierror,
        socket.timeout,
        ConnectionError,
        TimeoutError,
        URLError,
    )

class GmailNetworkError(Exception):
    """Raised when Gmail API cannot be reached due to network or DNS failures."""
    def __init__(self, message: str = "Couldn't reach Gmail. Check your internet connection and try again."):
        self.message = message
        self.error_code = "gmail_unreachable"
        super().__init__(self.message)

# In-memory caches to prevent rate-limit 403 errors during rapid tab switching
_label_cache: Dict[str, tuple[float, Dict[str, int]]] = {}
_message_cache: Dict[str, Dict[str, Any]] = {}

class GmailClient:
    def __init__(self, credentials: Optional[Credentials] = None):
        self.credentials = credentials
        self.service = build('gmail', 'v1', credentials=credentials) if credentials else None

    def _exec_with_retry(self, fn, max_retries: int = 1):
        """Execute a Gmail API call with 1 retry on transient network-level errors."""
        for attempt in range(max_retries + 1):
            try:
                return fn()
            except HTTP_NETWORK_ERRORS as net_err:
                print(f"[GmailClient] Network failure on attempt {attempt+1}/{max_retries+1}: {net_err}")
                if attempt < max_retries:
                    time.sleep(0.5)
                    continue
                raise GmailNetworkError() from net_err

    def list_messages(
        self, 
        folder: str = "inbox", 
        query: str = "", 
        max_results: int = 25,
        page_token: Optional[str] = None,
        category: Optional[str] = None
    ) -> Dict[str, Any]:
        """List messages from Gmail, filtering by folder, category, and search query with native page-token pagination."""
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

        if category and folder == "inbox":
            cat_norm = category.strip().lower()
            if cat_norm in ["primary", "personal"]:
                q_parts.append("category:primary")
            elif cat_norm in ["promotions", "promotion"]:
                q_parts.append("category:promotions")
            elif cat_norm in ["social"]:
                q_parts.append("category:social")
            elif cat_norm in ["updates", "update"]:
                q_parts.append("category:updates")

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

            results = self._exec_with_retry(lambda: self.service.users().messages().list(**list_params).execute())

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
        """Get total and unread message counts for a Gmail label with 15s cache to avoid rate limits."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        normalized_label = label_id.upper() if label_id.lower() in ["inbox", "sent", "draft", "trash", "spam"] else label_id
        now = time.time()

        if normalized_label in _label_cache:
            cache_time, cached_stats = _label_cache[normalized_label]
            if now - cache_time < 15:
                return cached_stats

        try:
            label_info = self._exec_with_retry(lambda: self.service.users().labels().get(userId="me", id=normalized_label).execute())
            res = {
                "total": int(label_info.get("messagesTotal", 0)),
                "unread": int(label_info.get("messagesUnread", 0)),
            }
            _label_cache[normalized_label] = (now, res)
            return res
        except HttpError as error:
            print(f"Gmail API error in get_label_stats: {error}")
            if normalized_label in _label_cache:
                return _label_cache[normalized_label][1]
            return {"total": 0, "unread": 0}

    def get_all_mailbox_stats(self) -> Dict[str, Any]:
        """Get total and unread counts for inbox, sent, and all Gmail categories (Primary, Promotions, Social, Updates)."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        inbox_stats = self.get_label_stats("INBOX")
        sent_stats = self.get_label_stats("SENT")
        primary_stats = self.get_label_stats("CATEGORY_PERSONAL")
        promotions_stats = self.get_label_stats("CATEGORY_PROMOTIONS")
        social_stats = self.get_label_stats("CATEGORY_SOCIAL")
        updates_stats = self.get_label_stats("CATEGORY_UPDATES")

        return {
            "inbox": inbox_stats,
            "sent": sent_stats,
            "categories": {
                "primary": primary_stats,
                "promotions": promotions_stats,
                "social": social_stats,
                "updates": updates_stats,
            }
        }

    def get_message(self, message_id: str) -> Optional[Dict[str, Any]]:
        """Fetch full details for a message by ID with in-memory caching."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        if message_id in _message_cache:
            return _message_cache[message_id]

        try:
            msg = self._exec_with_retry(lambda: self.service.users().messages().get(
                userId="me",
                id=message_id,
                format="full"
            ).execute())

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

            import re
            has_form = False
            form_url = None
            form_type = "other"

            form_pattern = r"(https?://(?:docs\.google\.com/forms/[^\s\"'>]+|forms\.gle/[^\s\"'>]+|forms\.office\.com/[^\s\"'>]+))"
            combined_content = f"{body_text} {body_html} {msg.get('snippet', '')}"
            match = re.search(form_pattern, combined_content, re.IGNORECASE)
            if match:
                has_form = True
                form_url = match.group(1)
                if "google" in form_url:
                    form_type = "google_form"
                elif "office" in form_url:
                    form_type = "ms_form"
            elif ".pdf" in combined_content.lower() or "form" in headers.get("subject", "").lower():
                has_form = True
                form_type = "pdf"

            # Extract attachments metadata
            attachments = []
            def _extract_attachments(payload_part):
                fn = payload_part.get("filename")
                att_id = payload_part.get("body", {}).get("attachmentId")
                if fn and att_id:
                    attachments.append({
                        "filename": fn,
                        "attachment_id": att_id,
                        "mime_type": payload_part.get("mimeType", ""),
                        "size": payload_part.get("body", {}).get("size", 0)
                    })
                for sub_part in payload_part.get("parts", []):
                    _extract_attachments(sub_part)

            _extract_attachments(msg.get("payload", {}))

            parsed_msg = {
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
                "has_form": has_form,
                "form_url": form_url,
                "form_type": form_type,
                "attachments": attachments,
            }

            if len(_message_cache) > 500:
                _message_cache.clear()
            _message_cache[message_id] = parsed_msg

            return parsed_msg
        except HttpError as error:
            print(f"Gmail API error in get_message: {error}")
            raise error

    def get_attachment(self, message_id: str, attachment_id: str) -> bytes:
        """Fetch raw attachment bytes from Gmail API."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")
        res = self._exec_with_retry(lambda: self.service.users().messages().attachments().get(
            userId="me", messageId=message_id, id=attachment_id
        ).execute())
        data = res.get("data", "")
        if not data:
            return b""
        return base64.urlsafe_b64decode(data.encode("ASCII"))

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

    def create_draft(self, to: str, subject: str, body: str, thread_id: Optional[str] = None, reply_to_message_id: Optional[str] = None) -> Dict[str, Any]:
        """Create an email draft in Gmail with proper RFC-compliant MIME headers and threading support."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        from email.mime.text import MIMEText
        from email.utils import make_msgid, formatdate

        message = MIMEText(body, "plain", "utf-8")
        message["To"] = to
        message["Subject"] = subject
        message["Date"] = formatdate(localtime=True)
        message["Message-ID"] = make_msgid()
        message["MIME-Version"] = "1.0"

        if reply_to_message_id:
            try:
                orig = self.get_message(reply_to_message_id)
                if orig:
                    thread_id = thread_id or orig.get("thread_id")
                orig_ref = f"<{reply_to_message_id}@mail.gmail.com>"
                message["In-Reply-To"] = orig_ref
                message["References"] = orig_ref
            except Exception as e:
                print(f"Notice setting In-Reply-To in draft: {e}")

        try:
            profile = self.service.users().getProfile(userId="me").execute()
            user_addr = profile.get("emailAddress")
            if user_addr:
                message["From"] = user_addr
        except Exception:
            pass

        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
        draft_body: Dict[str, Any] = {"message": {"raw": raw_message}}
        if thread_id:
            draft_body["message"]["threadId"] = thread_id

        draft = self._exec_with_retry(lambda: self.service.users().drafts().create(userId="me", body=draft_body).execute())
        return draft

    def send_message(self, to: str, subject: str, body: str, thread_id: Optional[str] = None, reply_to_message_id: Optional[str] = None) -> Dict[str, Any]:
        """Send an email via Gmail API with proper RFC-compliant MIME headers and threading support."""
        if not self.service:
            raise ValueError("Gmail client not initialized with valid credentials")

        from email.mime.text import MIMEText
        from email.utils import make_msgid, formatdate

        message = MIMEText(body, "plain", "utf-8")
        message["To"] = to
        message["Subject"] = subject
        message["Date"] = formatdate(localtime=True)
        message["Message-ID"] = make_msgid()
        message["MIME-Version"] = "1.0"

        if reply_to_message_id:
            try:
                orig = self.get_message(reply_to_message_id)
                if orig:
                    thread_id = thread_id or orig.get("thread_id")
                orig_ref = f"<{reply_to_message_id}@mail.gmail.com>"
                message["In-Reply-To"] = orig_ref
                message["References"] = orig_ref
            except Exception as e:
                print(f"Notice setting In-Reply-To in send: {e}")

        try:
            profile = self.service.users().getProfile(userId="me").execute()
            user_addr = profile.get("emailAddress")
            if user_addr:
                message["From"] = user_addr
        except Exception:
            pass

        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
        send_body: Dict[str, Any] = {"raw": raw_message}
        if thread_id:
            send_body["threadId"] = thread_id

        sent = self._exec_with_retry(lambda: self.service.users().messages().send(userId="me", body=send_body).execute())
        return sent
