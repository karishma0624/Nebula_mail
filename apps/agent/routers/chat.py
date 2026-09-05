import json
import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import HumanMessage, AIMessage

from agent.graph import agent_graph
from agent.state import AgentState
from db.supabase_client import get_supabase, ensure_default_user_id

router = APIRouter(tags=["chat"])

class ChatRequest(BaseModel):
    message: str
    ui_context: Dict[str, Any] = {}
    conversation_id: Optional[str] = None

@router.post("/chat")
async def chat_endpoint(req: ChatRequest):
    user_id = ensure_default_user_id()
    supabase = get_supabase()

    # 1. Resolve conversation_id and verify user-scoped ownership
    conversation_id = req.conversation_id
    title = req.message[:50].strip() or "New Conversation"

    if supabase and user_id:
        if conversation_id:
            try:
                conv_res = supabase.table("conversations").select("*").eq("id", conversation_id).eq("user_id", user_id).execute()
                if not conv_res.data or len(conv_res.data) == 0:
                    # Not found or unauthorized - create a new conversation for this user
                    new_conv = supabase.table("conversations").insert({"user_id": user_id, "title": title}).execute()
                    conversation_id = new_conv.data[0]["id"] if new_conv.data else None
            except Exception as e:
                print(f"Error checking conversation: {e}")
                conversation_id = None
        else:
            try:
                new_conv = supabase.table("conversations").insert({"user_id": user_id, "title": title}).execute()
                conversation_id = new_conv.data[0]["id"] if new_conv.data else None
            except Exception as e:
                print(f"Error creating conversation: {e}")
                conversation_id = None

    # 2. Load bounded message history (most recent 20 messages)
    history_messages = []
    if supabase and user_id and conversation_id:
        try:
            past_msgs_res = supabase.table("messages").select("*").eq("conversation_id", conversation_id).eq("user_id", user_id).order("created_at", desc=True).limit(20).execute()
            raw_rows = list(reversed(past_msgs_res.data or []))
            for m in raw_rows:
                role = m.get("role")
                content = m.get("content", "")
                if role == "user":
                    history_messages.append(HumanMessage(content=content))
                elif role == "assistant":
                    history_messages.append(AIMessage(content=content))
        except Exception as e:
            print(f"Error loading conversation history: {e}")


    # 3. Persist user message
    if supabase and user_id and conversation_id:
        try:
            supabase.table("messages").insert({
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "user",
                "content": req.message
            }).execute()
        except Exception as e:
            print(f"Error saving user message: {e}")

    async def event_generator():
        try:
            # Send conversation metadata immediately
            if conversation_id:
                yield {
                    "event": "conversation",
                    "data": json.dumps({"conversation_id": conversation_id, "title": title})
                }

            # 4. Prepare initial state for LangGraph
            initial_state: AgentState = {
                "messages": history_messages + [HumanMessage(content=req.message)],
                "ui_context": req.ui_context,
                "tool_calls": [],
                "reflection": None,
                "retry_count": 0,
                "error": None,
                "final_response": None,
                "citations": []
            }

            # 5. Run graph asynchronously or through a thread pool
            loop = asyncio.get_event_loop()
            final_state = await loop.run_in_executor(None, agent_graph.invoke, initial_state)

            # 6. Stream tool call event immediately if decided
            tool_calls = final_state.get("tool_calls", [])
            for tc in tool_calls:
                tool_data = {
                    "event": "tool_call",
                    "name": tc.get("name"),
                    "arguments": tc.get("arguments", {}),
                    "result": tc.get("result")
                }
                yield {
                    "event": "tool_call",
                    "data": json.dumps(tool_data)
                }
                await asyncio.sleep(0.05)

            # 7. Stream citations if present
            citations = final_state.get("citations") or []
            if citations:
                yield {
                    "event": "citations",
                    "data": json.dumps({"citations": citations})
                }
                await asyncio.sleep(0.03)

            # 8. Stream assistant text response
            final_resp = final_state.get("final_response") or "Done."
            words = final_resp.split(" ")
            for i, word in enumerate(words):
                chunk = word + (" " if i < len(words) - 1 else "")
                yield {
                    "event": "message",
                    "data": json.dumps({"delta": chunk})
                }
                await asyncio.sleep(0.03)

            # 9. Done event
            yield {
                "event": "message",
                "data": "[DONE]"
            }

            # 10. Persist assistant message to database
            if supabase and user_id and conversation_id:
                try:
                    supabase.table("messages").insert({
                        "conversation_id": conversation_id,
                        "user_id": user_id,
                        "role": "assistant",
                        "content": final_resp,
                        "tool_calls": tool_calls if tool_calls else None,
                        "citations": citations if citations else None
                    }).execute()
                    # Update conversation timestamp
                    supabase.table("conversations").update({
                        "updated_at": "now()"
                    }).eq("id", conversation_id).eq("user_id", user_id).execute()
                except Exception as db_err:
                    print(f"Error persisting assistant message: {db_err}")

        except Exception as e:
            import traceback
            traceback.print_exc()
            from gmail.client import GmailNetworkError
            msg = "Couldn't reach Gmail. Check your internet connection and try again." if (isinstance(e, GmailNetworkError) or "ServerNotFoundError" in str(e) or "gmail" in str(e).lower()) else "Something went wrong, please try again."
            yield {
                "event": "message",
                "data": json.dumps({"delta": msg})
            }
            yield {
                "event": "message",
                "data": "[DONE]"
            }

    return EventSourceResponse(event_generator())


@router.get("/conversations")
def list_conversations():
    user_id = ensure_default_user_id()
    if not user_id:
        return []
    supabase = get_supabase()
    if not supabase:
        return []
    try:
        res = supabase.table("conversations").select("id, title, created_at, updated_at").eq("user_id", user_id).order("updated_at", desc=True).limit(50).execute()
        return res.data or []
    except Exception as e:
        print(f"Error listing conversations: {e}")
        return []


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str):
    user_id = ensure_default_user_id()
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Database unavailable")

    conv_res = supabase.table("conversations").select("*").eq("id", conversation_id).eq("user_id", user_id).execute()
    if not conv_res.data or len(conv_res.data) == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msgs_res = supabase.table("messages").select("*").eq("conversation_id", conversation_id).eq("user_id", user_id).order("created_at", desc=False).execute()
    return {
        "conversation": conv_res.data[0],
        "messages": msgs_res.data or []
    }


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str):
    user_id = ensure_default_user_id()
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Database unavailable")

    conv_res = supabase.table("conversations").select("id").eq("id", conversation_id).eq("user_id", user_id).execute()
    if not conv_res.data:
        raise HTTPException(status_code=404, detail="Conversation not found")

    supabase.table("conversations").delete().eq("id", conversation_id).eq("user_id", user_id).execute()
    return {"status": "deleted", "id": conversation_id}


@router.delete("/conversations")
def clear_conversations():
    user_id = ensure_default_user_id()
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Database unavailable")

    supabase.table("conversations").delete().eq("user_id", user_id).execute()
    return {"status": "cleared"}


class FeedbackRequest(BaseModel):
    message: str
    rating: Optional[str] = None
    conversation_id: Optional[str] = None

@router.post("/feedback")
def submit_feedback(req: FeedbackRequest):
    user_id = ensure_default_user_id()
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Database unavailable")

    feedback_text = req.message
    if req.rating:
        feedback_text = f"[{req.rating.upper()}] {feedback_text}"

    supabase.table("feedback").insert({
        "user_id": user_id,
        "message": feedback_text
    }).execute()
    return {"status": "success", "message": "Feedback submitted"}


class EditMessageRequest(BaseModel):
    message_id: str
    new_content: str

@router.post("/conversations/{conversation_id}/edit-message")
def edit_conversation_message(conversation_id: str, req: EditMessageRequest):
    """
    Section 24: Edit a user message in a conversation.
    Replaces that message's stored content and discards/deletes all subsequent messages,
    so re-running produces a fresh continuation without duplicates.
    """
    user_id = ensure_default_user_id()
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Database unavailable")

    # Verify conversation ownership
    conv_res = supabase.table("conversations").select("id").eq("id", conversation_id).eq("user_id", user_id).execute()
    if not conv_res.data:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Find target message
    msg_res = supabase.table("messages").select("*").eq("id", req.message_id).eq("conversation_id", conversation_id).eq("user_id", user_id).execute()
    if not msg_res.data:
        # If ID is temporary client-side uuid or not yet in DB, we still allow truncation based on latest
        return {"status": "success", "message_id": req.message_id, "new_content": req.new_content}

    target_msg = msg_res.data[0]
    created_at = target_msg.get("created_at")

    # Delete all subsequent messages in this conversation
    if created_at:
        supabase.table("messages").delete().eq("conversation_id", conversation_id).eq("user_id", user_id).gt("created_at", created_at).execute()

    # Update target message content
    supabase.table("messages").update({"content": req.new_content}).eq("id", req.message_id).execute()

    return {"status": "success", "message_id": req.message_id, "new_content": req.new_content}
