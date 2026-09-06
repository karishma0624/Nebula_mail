from typing import Any, Dict, List, Union

REDACT_KEYS = {
    "body",
    "subject",
    "email_body_template",
    "body_text",
    "body_html",
    "snippet",
    "extracted_text"
}

def redact_pii_recursive(data: Any) -> Any:
    """
    Recursively redact sensitive text fields (body, subject, email_body_template, etc.)
    wherever persisted into agent_tool_calls or messages tables.
    Format: {"length": <character_count>, "preview": "<first 40 characters>..."}
    Recipient / attendee addresses stay unredacted for debugging send issues.
    """
    if isinstance(data, dict):
        redacted = {}
        for k, v in data.items():
            if str(k).lower() in REDACT_KEYS and isinstance(v, str):
                preview_text = f"{v[:40]}..." if len(v) > 40 else v
                redacted[k] = {
                    "length": len(v),
                    "preview": preview_text
                }
            else:
                redacted[k] = redact_pii_recursive(v)
        return redacted
    elif isinstance(data, list):
        return [redact_pii_recursive(item) for item in data]
    else:
        return data

def sanitize_error_context(ctx: Any) -> Dict[str, Any]:
    """
    Sanitize raw_context for agent_errors table.
    Must NEVER contain email body, subject, attachment contents, full prompts,
    or raw conversation history. Only safe references (ids, enums, counts).
    """
    if not isinstance(ctx, dict):
        return {"value_type": type(ctx).__name__}

    safe = {}
    safe_keys = {
        "tool", "tool_name", "email_id", "draft_id", "status", "action",
        "error_code", "batch_id", "count", "component", "attendees_count",
        "draft_ids_count", "meeting_draft_id", "request_id"
    }
    for k, v in ctx.items():
        k_lower = str(k).lower()
        if k_lower in safe_keys:
            safe[k] = v
        elif "id" in k_lower and isinstance(v, (str, int)):
            safe[k] = v
        elif isinstance(v, (int, float, bool)):
            safe[k] = v
        elif isinstance(v, str) and len(v) <= 50 and not any(s in v.lower() for s in ["from:", "subject:", "<html", "dear "]):
            safe[k] = v
        elif isinstance(v, list):
            safe[f"{k}_count"] = len(v)
        elif isinstance(v, str):
            safe[f"{k}_length"] = len(v)
    return safe
