import io
import re
from typing import Tuple, Optional, Dict, Any, List
from config import settings
from db.supabase_client import get_supabase

def extract_text_from_bytes(content: bytes, filename: str, mime_type: Optional[str] = None) -> Tuple[Optional[str], str]:
    """
    Extracts plain text from document attachments (PDF, DOCX, plain text/markdown/csv).
    Returns (extracted_text, status) where status is 'extracted', 'unsupported', or 'failed'.
    Caps extracted text at 20,000 characters and up to 10 pages for PDFs.
    """
    fn_lower = filename.lower()
    m_lower = (mime_type or "").lower()

    # 1. Plain Text / Markdown / CSV / JSON
    if fn_lower.endswith((".txt", ".md", ".csv", ".json", ".log")) or "text/" in m_lower:
        try:
            text = content.decode("utf-8", errors="ignore").strip()
            if len(text) > 20000:
                text = text[:20000] + "\n[Content truncated]"
            return (text, "extracted") if text else (None, "failed")
        except Exception as e:
            print(f"[Attachment] Text decode error: {e}")
            return (None, "failed")

    # 2. PDF extraction via pypdf
    if fn_lower.endswith(".pdf") or "pdf" in m_lower:
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            pages_text = []
            max_pages = min(len(reader.pages), 10)
            for i in range(max_pages):
                page_t = reader.pages[i].extract_text() or ""
                if page_t.strip():
                    pages_text.append(page_t)
            extracted = "\n".join(pages_text).strip()
            if len(extracted) > 20000:
                extracted = extracted[:20000] + "\n[Content truncated]"
            return (extracted, "extracted") if extracted else (None, "failed")
        except Exception as e:
            print(f"[Attachment] PDF extraction error: {e}")
            return (None, "failed")

    # 3. DOCX extraction via python-docx
    if fn_lower.endswith(".docx") or "wordprocessingml" in m_lower:
        try:
            import docx
            doc = docx.Document(io.BytesIO(content))
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            extracted = "\n".join(paragraphs).strip()
            if len(extracted) > 20000:
                extracted = extracted[:20000] + "\n[Content truncated]"
            return (extracted, "extracted") if extracted else (None, "failed")
        except Exception as e:
            print(f"[Attachment] DOCX extraction error: {e}")
            return (None, "failed")

    # Unsupported types (Images without OCR, binaries, archives)
    return (None, "unsupported")


def index_email_attachment(
    email_id: str,
    user_id: str,
    filename: str,
    content: bytes,
    mime_type: Optional[str] = None,
    gmail_attachment_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Extracts text, generates embeddings, and persists to email_attachments table.
    """
    extracted_text, status = extract_text_from_bytes(content, filename, mime_type)
    embedding = None

    if status == "extracted" and extracted_text:
        try:
            from agent.rag import get_embedding
            embedding = get_embedding(extracted_text[:1500])
        except Exception as e:
            print(f"[Attachment] Embedding error: {e}")

    supabase = get_supabase()
    record = {
        "email_id": email_id,
        "user_id": user_id,
        "filename": filename,
        "mime_type": mime_type,
        "gmail_attachment_id": gmail_attachment_id,
        "extracted_text": extracted_text,
        "extraction_status": status,
        "embedding": embedding
    }

    if supabase and email_id and user_id:
        try:
            import datetime
            chk = supabase.table("emails").select("id").eq("id", email_id).execute()
            if not (chk and chk.data):
                supabase.table("emails").upsert({
                    "id": email_id,
                    "user_id": user_id,
                    "sender": "Mailbox User",
                    "recipients": ["me"],
                    "subject": filename,
                    "folder": "inbox",
                    "received_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                }).execute()
        except Exception as ex:
            print(f"[Attachment] Notice creating email stub: {ex}")

    if supabase:
        try:
            res = supabase.table("email_attachments").insert(record).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
        except Exception as e:
            if "1536" in str(e) and embedding:
                try:
                    padded = list(embedding) + [0.0] * (1536 - len(embedding))
                    record["embedding"] = padded
                    res = supabase.table("email_attachments").insert(record).execute()
                    if res.data and len(res.data) > 0:
                        return res.data[0]
                except Exception:
                    try:
                        record["embedding"] = None
                        res = supabase.table("email_attachments").insert(record).execute()
                        if res.data and len(res.data) > 0:
                            return res.data[0]
                    except Exception:
                        pass
            print(f"[Attachment] Notice inserting attachment: {e}")

    return record


def search_semantic_attachments(query: str, user_id: str, limit: int = 3) -> List[Dict[str, Any]]:
    """
    Searches user's extracted document attachments using semantic matching and keyword filtering.
    """
    supabase = get_supabase()
    if not supabase or not user_id:
        return []

    results = []
    # 1. Text search across user's attachments
    try:
        stopwords = {"what", "which", "where", "how", "when", "why", "is", "are", "does", "the", "a", "an", "in", "on", "about", "say", "does", "pdf", "attachment", "document"}
        words = [w.lower() for w in re.findall(r"[a-zA-Z0-9_-]+", query) if w.lower() not in stopwords and len(w) > 2]

        query_builder = supabase.table("agent_visible_attachments").select("id, email_id, filename, mime_type, extracted_text, created_at").eq("user_id", user_id).eq("extraction_status", "extracted")
        res = query_builder.order("created_at", desc=True).limit(20).execute()

        candidates = res.data or []
        for att in candidates:
            text = (att.get("extracted_text") or "").lower()
            fname = (att.get("filename") or "").lower()
            score = 0
            for w in words:
                if w in fname:
                    score += 5
                if w in text:
                    score += 2
            if score > 0 or not words:
                results.append({
                    "id": att["id"],
                    "email_id": att["email_id"],
                    "filename": att["filename"],
                    "extracted_text": att.get("extracted_text", ""),
                    "score": score
                })
        results.sort(key=lambda x: x["score"], reverse=True)
    except Exception as e:
        print(f"[Attachment] Error querying attachments: {e}")

    return results[:limit]
