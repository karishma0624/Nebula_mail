import json
import asyncio
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any, Optional
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import HumanMessage

from agent.graph import agent_graph
from agent.state import AgentState

router = APIRouter(tags=["chat"])

class ChatRequest(BaseModel):
    message: str
    ui_context: Dict[str, Any]

@router.post("/chat")
async def chat_endpoint(req: ChatRequest):
    async def event_generator():
        try:
            # 1. Prepare initial state for LangGraph
            initial_state: AgentState = {
                "messages": [HumanMessage(content=req.message)],
                "ui_context": req.ui_context,
                "tool_calls": [],
                "reflection": None,
                "retry_count": 0,
                "error": None,
                "final_response": None
            }

            # 2. Run graph asynchronously or through a thread pool
            loop = asyncio.get_event_loop()
            final_state = await loop.run_in_executor(None, agent_graph.invoke, initial_state)

            # 3. Stream tool call event immediately if decided
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
                # Brief pause for UI reaction
                await asyncio.sleep(0.05)

            # 4. Stream assistant text response
            final_resp = final_state.get("final_response") or "Done."
            # Stream in natural chunks
            words = final_resp.split(" ")
            for i, word in enumerate(words):
                chunk = word + (" " if i < len(words) - 1 else "")
                yield {
                    "event": "message",
                    "data": json.dumps({"delta": chunk})
                }
                await asyncio.sleep(0.03)

            # 5. Done event
            yield {
                "event": "message",
                "data": "[DONE]"
            }

        except Exception as e:
            print(f"Error in chat SSE streaming: {e}")
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)})
            }

    return EventSourceResponse(event_generator())
