from typing import List, Dict, Any, Optional
from config import settings
from db.supabase_client import get_supabase

# Model name for Gemini embeddings
GEMINI_EMBEDDING_MODEL = "models/text-embedding-004"

def get_embedding(text: str) -> Optional[List[float]]:
    """
    Generate embedding vector using Gemini.
    text-embedding-004 returns a 768-dimensional vector.
    """
    if not settings.GEMINI_API_KEY:
        return None

    try:
        import google.generativeai as genai
        genai.configure(api_key=settings.GEMINI_API_KEY)
        result = genai.embed_content(
            model=GEMINI_EMBEDDING_MODEL,
            content=text,
            task_type="retrieval_document"
        )
        return result.get("embedding")
    except Exception as e:
        print(f"[RAG] Error generating embedding with Gemini: {e}")
        return None

def verify_embedding_dimension() -> int:
    """Verifies actual dimensionality returned by the model."""
    vec = get_embedding("test text")
    if vec:
        dim = len(vec)
        print(f"[RAG] Verified Gemini embedding dimension: {dim}")
        return dim
    return 768

def search_semantic_emails(query: str, user_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Semantic search over email subject + snippet using pgvector cosine distance.
    Always returns source attribution for each email.
    """
    supabase = get_supabase()
    if not supabase:
        return []

    query_embedding = get_embedding(query)
    if not query_embedding:
        return []

    try:
        # Call Supabase RPC match_emails or direct vector query
        response = supabase.rpc("match_emails", {
            "query_embedding": query_embedding,
            "match_threshold": 0.5,
            "match_count": limit,
            "p_user_id": user_id
        }).execute()

        results = []
        for item in response.data or []:
            results.append({
                "id": item.get("id"),
                "sender": item.get("sender"),
                "subject": item.get("subject"),
                "snippet": item.get("snippet"),
                "similarity": item.get("similarity"),
                "source": f"Email from {item.get('sender')} - '{item.get('subject')}'"
            })
        return results
    except Exception as e:
        print(f"[RAG] Semantic search error: {e}")
        return []
