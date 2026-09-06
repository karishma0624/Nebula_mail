from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings

from routers.emails import router as emails_router
from routers.chat import router as chat_router
from routers.webhooks import router as webhooks_router
from routers.settings import router as settings_router
from routers.calendar import router as calendar_router

app = FastAPI(
    title="Nebula Mail API",
    description="Backend service for Nebula Mail with Gmail API, LangGraph agent, and Supabase integration",
    version="1.0.0"
)

# CORS configuration for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.responses import JSONResponse
from gmail.client import GmailNetworkError

# Register routers
app.include_router(emails_router)
app.include_router(chat_router)
app.include_router(webhooks_router)
app.include_router(settings_router)
app.include_router(calendar_router)

@app.exception_handler(GmailNetworkError)
async def gmail_network_error_handler(request, exc: GmailNetworkError):
    return JSONResponse(
        status_code=502,
        content={"error": exc.error_code, "message": exc.message}
    )

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "nebula-mail-agent",
        "oauth_configured": bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET),
        "supabase_configured": bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY),
        "llm_configured": bool(settings.GEMINI_API_KEY or settings.GROQ_API_KEY),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
