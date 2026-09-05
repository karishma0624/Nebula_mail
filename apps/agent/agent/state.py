from typing import TypedDict, List, Dict, Any, Optional
from langchain_core.messages import BaseMessage

class UIContextState(TypedDict, total=False):
    current_view: str
    open_email: Optional[Dict[str, Any]]
    active_filters: Dict[str, Any]

class AgentState(TypedDict):
    messages: List[BaseMessage]
    ui_context: UIContextState
    tool_calls: List[Dict[str, Any]]
    reflection: Optional[str]
    retry_count: int
    error: Optional[str]
    final_response: Optional[str]
    citations: Optional[List[Dict[str, Any]]]
