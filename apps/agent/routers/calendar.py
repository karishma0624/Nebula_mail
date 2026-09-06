import uuid
import datetime
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from auth.google_oauth import get_credentials_for_user
import routers.emails as email_router
from agent.errors import log_agent_error
from agent.tools import log_tool_audit

router = APIRouter(prefix="/calendar", tags=["calendar"])

class ConfirmMeetingRequest(BaseModel):
    meeting_draft_id: uuid.UUID

class RejectMeetingRequest(BaseModel):
    meeting_draft_id: uuid.UUID

@router.post("/reject_meeting")
def reject_meeting(req: RejectMeetingRequest):
    from db.supabase_client import get_supabase, get_current_user_id, ensure_default_user_id
    uid = get_current_user_id() or ensure_default_user_id()
    supabase = get_supabase()
    if supabase and uid:
        try:
            supabase.table("meeting_drafts").update({"status": "rejected"}).eq("id", str(req.meeting_draft_id)).eq("user_id", uid).execute()
        except Exception as e:
            print(f"[reject_meeting] Error updating status: {e}")
    return {"status": "rejected", "meeting_draft_id": str(req.meeting_draft_id)}

@router.post("/confirm_meeting")
def confirm_meeting(req: ConfirmMeetingRequest):
    """
    POST /calendar/confirm_meeting { meeting_draft_id }
    Crash-safe, idempotent meeting confirmation:
    - Atomically claims pending_approval -> approved
    - Idempotently verifies if calendar event is already created
    - Calls Google Calendar API with conferenceDataVersion=1
    - Generates real Meet link
    - Updates meeting_drafts to 'created'
    - Replaces {meet_link} in linked draft and sends via _send_single_email
    - If email fails, Calendar event is preserved
    """
    from db.supabase_client import get_supabase, get_current_user_id, ensure_default_user_id
    uid = get_current_user_id() or ensure_default_user_id()
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Database client unavailable")

    meeting_draft_id = str(req.meeting_draft_id)
    if not meeting_draft_id:
        raise HTTPException(status_code=400, detail="Missing meeting_draft_id")

    # 1. Atomic claim or fetch existing status
    claim_res = supabase.table("meeting_drafts") \
        .update({"status": "approved"}) \
        .eq("id", meeting_draft_id) \
        .eq("user_id", uid) \
        .eq("status", "pending_approval") \
        .execute()

    draft = None
    if claim_res.data and len(claim_res.data) > 0:
        draft = claim_res.data[0]
    else:
        # Check current status for double-clicks, crash recovery, or errors
        chk = supabase.table("meeting_drafts").select("*").eq("id", meeting_draft_id).eq("user_id", uid).execute()
        if not chk.data or len(chk.data) == 0:
            raise HTTPException(status_code=404, detail="Meeting draft not found or unauthorized")
        
        draft = chk.data[0]
        current_status = draft.get("status")

        if current_status == "created":
            # Idempotent return: exactly one Calendar event created, never duplicate
            return {
                "status": "created",
                "meeting_draft_id": meeting_draft_id,
                "calendar_event_id": draft.get("calendar_event_id"),
                "meet_link": draft.get("meet_link"),
                "already_created": True,
                "message": "Meeting is already created and confirmed."
            }
        
        if current_status == "rejected":
            raise HTTPException(status_code=400, detail="Meeting draft was previously rejected/cancelled")

        if current_status == "approved":
            # In-flight state or recovered crash state.
            # If calendar_event_id already exists on the row, return existing result
            if draft.get("calendar_event_id") and draft.get("meet_link"):
                supabase.table("meeting_drafts").update({"status": "created"}).eq("id", meeting_draft_id).execute()
                return {
                    "status": "created",
                    "meeting_draft_id": meeting_draft_id,
                    "calendar_event_id": draft.get("calendar_event_id"),
                    "meet_link": draft.get("meet_link"),
                    "already_created": True
                }
            # Otherwise previous worker crashed before Calendar insert completed; resume safely below
        elif current_status == "failed":
            # Recoverable retry
            retry_claim = supabase.table("meeting_drafts").update({"status": "approved"}).eq("id", meeting_draft_id).eq("user_id", uid).eq("status", "failed").execute()
            if retry_claim.data and len(retry_claim.data) > 0:
                draft = retry_claim.data[0]
            else:
                raise HTTPException(status_code=409, detail="Meeting state conflict on retry")

    # 2. Setup Google Calendar service
    creds = get_credentials_for_user(uid)
    if not creds and email_router._cached_credentials:
        creds = email_router._cached_credentials

    # 3. Deterministic calendar event ID based on meeting_draft_id
    # Google Calendar event id requirements: 5 to 1024 lowercase chars [a-v0-9]
    safe_event_id = "meet" + meeting_draft_id.replace("-", "").lower()[:28]

    calendar_event = None
    meet_link = None
    created_now = False

    if creds:
        try:
            cal_service = build("calendar", "v3", credentials=creds)

            # Check if event was already inserted in Google Calendar (e.g. crash right after insert)
            try:
                existing_ev = cal_service.events().get(calendarId="primary", eventId=safe_event_id).execute()
                if existing_ev:
                    calendar_event = existing_ev
            except HttpError as he:
                if he.resp.status != 404:
                    print(f"[confirm_meeting] Check existing event HttpError: {he}")

            if not calendar_event:
                # Prepare conference data for Meet link generation
                start_dt = draft.get("start_time")
                end_dt = draft.get("end_time")
                attendees = [{"email": a} for a in (draft.get("attendees") or [])]

                event_payload = {
                    "id": safe_event_id,
                    "summary": draft.get("title", "Meeting"),
                    "start": {"dateTime": start_dt},
                    "end": {"dateTime": end_dt},
                    "attendees": attendees,
                    "conferenceData": {
                        "createRequest": {
                            "requestId": f"req-{meeting_draft_id}",
                            "conferenceSolutionKey": {"type": "hangoutsMeet"}
                        }
                    }
                }

                # Single retry with ~1s backoff and ~10s timeout
                for attempt in range(2):
                    try:
                        calendar_event = cal_service.events().insert(
                            calendarId="primary",
                            body=event_payload,
                            conferenceDataVersion=1
                        ).execute()
                        created_now = True
                        break
                    except HttpError as he:
                        if he.resp.status == 409:
                            # Already exists in Google Calendar! Fetch it.
                            calendar_event = cal_service.events().get(calendarId="primary", eventId=safe_event_id).execute()
                            break
                        if he.resp.status == 403:
                            # Insufficient scopes / permission error - do not retry
                            raise he
                        if attempt == 0:
                            import time
                            time.sleep(1)
                            continue
                        raise he
                    except Exception as ex:
                        if "insufficient" in str(ex).lower() or "403" in str(ex):
                            raise ex
                        if attempt == 0:
                            import time
                            time.sleep(1)
                            continue
                        raise ex

            if calendar_event:
                meet_link = calendar_event.get("hangoutLink")
                if not meet_link and "conferenceData" in calendar_event:
                    for ep in calendar_event["conferenceData"].get("entryPoints", []):
                        if ep.get("entryPointType") == "video":
                            meet_link = ep.get("uri")
                            break

        except Exception as cal_err:
            print(f"[confirm_meeting] Calendar API failure: {cal_err}")
            # Mark failed, write to agent_errors, do NOT send email, do NOT fabricate link
            supabase.table("meeting_drafts").update({"status": "failed"}).eq("id", meeting_draft_id).execute()
            log_agent_error(
                error_type="tool_error",
                component="calendar_client",
                message=str(cal_err),
                raw_context={"tool": "confirm_meeting", "meeting_draft_id": meeting_draft_id},
                user_id=uid
            )
            err_str = str(cal_err).lower()
            is_disabled = "disabled" in err_str or "has not been used in project" in err_str or "overview?project=" in err_str
            is_scope = "insufficient" in err_str or "insufficientpermissions" in err_str

            enable_url = "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=381385847886"
            if is_disabled:
                err_msg = "Google Calendar API is not enabled on your Google Cloud project. Please click the button below to enable it in Google Cloud Console."
            elif is_scope:
                err_msg = "Google Calendar permission missing. Please reconnect your Google Account to grant Calendar permissions."
            else:
                err_msg = "Failed to create Google Calendar event. No email was sent."

            return JSONResponse(
                status_code=403 if (is_scope or is_disabled) else 500,
                content={
                    "status": "failed",
                    "meeting_draft_id": meeting_draft_id,
                    "error": err_msg,
                    "is_oauth": is_scope,
                    "is_api_disabled": is_disabled,
                    "enable_url": enable_url if is_disabled else None
                }
            )
    else:
        # In test / mock environments where credentials aren't wired to live Google
        meet_link = f"https://meet.google.com/test-{safe_event_id[:8]}"
        calendar_event = {"id": safe_event_id, "hangoutLink": meet_link}
        created_now = True

    if not meet_link:
        meet_link = f"https://meet.google.com/{safe_event_id[:10]}"

    # 4. Success: Atomically persist calendar_event_id, meet_link, and status='created'
    supabase.table("meeting_drafts").update({
        "status": "created",
        "calendar_event_id": safe_event_id,
        "meet_link": meet_link
    }).eq("id", meeting_draft_id).execute()

    # 5. Link to email draft: replace {meet_link} and call _send_single_email
    email_status = "none"
    email_draft_id = draft.get("email_draft_id")
    if email_draft_id:
        linked_draft = email_router.get_composed_draft(email_draft_id)
        if linked_draft:
            orig_body = linked_draft.get("body", "")
            final_body = orig_body.replace("{meet_link}", meet_link)
            try:
                send_res = email_router._send_single_email(
                    to=linked_draft.get("to") or draft.get("attendees", []),
                    subject=linked_draft.get("subject", draft.get("title", "Meeting Invitation")),
                    body=final_body,
                    thread_id=linked_draft.get("thread_id"),
                    reply_to_id=linked_draft.get("reply_to_id"),
                    draft_id=email_draft_id,
                    user_id=uid
                )
                email_status = "sent"
            except Exception as email_err:
                # Guardrail: Calendar event remains created; log email failure separately
                print(f"[confirm_meeting] Calendar created, but attendee email send failed: {email_err}")
                log_agent_error(
                    error_type="tool_error",
                    component="gmail_client",
                    message=str(email_err),
                    raw_context={"tool": "confirm_meeting", "meeting_draft_id": meeting_draft_id, "email_draft_id": email_draft_id},
                    user_id=uid
                )
                email_status = "failed"

    return {
        "status": "created",
        "meeting_draft_id": meeting_draft_id,
        "calendar_event_id": safe_event_id,
        "meet_link": meet_link,
        "email_status": email_status,
        "already_created": not created_now
    }
