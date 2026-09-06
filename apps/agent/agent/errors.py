import uuid
from typing import Optional, Dict, Any, Literal
from db.supabase_client import get_supabase, ensure_default_user_id
from agent.pii import sanitize_error_context

VALID_ERROR_TYPES = {
    "input_error",
    "intent_error",
    "planner_error",
    "tool_error",
    "retriever_error",
    "memory_error",
    "prompt_error",
    "reasoning_error",
    "output_error",
    "deployment_error"
}

ErrorType = Literal[
    "input_error", "intent_error", "planner_error", "tool_error",
    "retriever_error", "memory_error", "prompt_error", "reasoning_error",
    "output_error", "deployment_error"
]

def log_agent_error(
    error_type: str,
    component: str,
    message: str,
    raw_context: Optional[Dict[str, Any]] = None,
    user_id: Optional[str] = None,
    request_id: Optional[str] = None
) -> Optional[str]:
    """
    Classify and persist a structured error into agent_errors table.
    Enforces strict taxonomy check and PII-safe sanitized context.
    """
    if error_type not in VALID_ERROR_TYPES:
        print(f"[ErrorTaxonomy] Warning: unknown error_type '{error_type}', falling back to 'tool_error'")
        error_type = "tool_error"

    supabase = get_supabase()
    if not supabase:
        return None

    uid = user_id or ensure_default_user_id()
    if not uid:
        return None

    req_id = request_id or str(uuid.uuid4())
    error_id = str(uuid.uuid4())
    safe_ctx = sanitize_error_context(raw_context or {})

    try:
        supabase.table("agent_errors").insert({
            "id": error_id,
            "user_id": uid,
            "request_id": req_id,
            "error_type": error_type,
            "component": component,
            "message": str(message)[:500],
            "raw_context": safe_ctx
        }).execute()
        return error_id
    except Exception as e:
        print(f"[ErrorTaxonomy] Notice inserting agent_error: {e}")
        return None
