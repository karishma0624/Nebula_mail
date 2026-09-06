import time
import threading
from typing import Callable, Any, Optional, Dict
from agent.errors import log_agent_error

class GeminiRateLimitExhausted(Exception):
    """Raised when Gemini 429 retries are exhausted."""
    def __init__(self, message: str = "Assistant is busy right now. Please try again shortly."):
        self.message = message
        super().__init__(self.message)

class SharedGeminiRateLimiter:
    """
    In-process token bucket and retry controller shared by ALL THREE Gemini consumers:
    1. Chat completions
    2. Email embeddings
    3. Attachment embeddings
    No Redis or external service needed.
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(SharedGeminiRateLimiter, cls).__new__(cls)
                cls._instance._init_bucket()
            return cls._instance

    def _init_bucket(self, capacity: int = 60, refill_rate_per_sec: float = 1.0):
        self.capacity = capacity
        self.tokens = capacity
        self.refill_rate = refill_rate_per_sec
        self.last_refill = time.time()
        self.bucket_lock = threading.Lock()

    def _consume_token(self) -> bool:
        with self.bucket_lock:
            now = time.time()
            elapsed = now - self.last_refill
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
            self.last_refill = now
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return True
            return False

    def execute_with_guard(
        self,
        fn: Callable[[], Any],
        consumer_name: str = "chat_completion",
        user_id: Optional[str] = None,
        request_id: Optional[str] = None
    ) -> Any:
        """
        Executes fn() with bounded exponential backoff on 429:
        Attempt 1 waits ~1s, Attempt 2 waits ~2s, Attempt 3 waits ~4s, then fails gracefully.
        Logs exhausted failure as error_type='tool_error', component='gemini_client' without PII.
        """
        # Best-effort bucket consumption; short throttle if bucket drained
        if not self._consume_token():
            time.sleep(0.2)

        delays = [1.0, 2.0, 4.0]
        last_exception = None

        for attempt, delay in enumerate(delays):
            try:
                return fn()
            except Exception as e:
                err_str = str(e).lower()
                is_429 = "429" in err_str or "resource_exhausted" in err_str or "quota" in err_str or "rate" in err_str
                last_exception = e
                if not is_429:
                    # Non-rate-limit exception; propagate immediately
                    raise e

                print(f"[GeminiRateLimiter] 429 detected for {consumer_name} (attempt {attempt + 1}/3). Waiting {delay}s...")
                time.sleep(delay)

        # Final 4th attempt after 4s backoff
        try:
            return fn()
        except Exception as final_e:
            last_exception = final_e

        # Exhausted: log structured error and raise graceful message
        log_agent_error(
            error_type="tool_error",
            component="gemini_client",
            message="Assistant is busy right now. Please try again shortly.",
            raw_context={"consumer": consumer_name, "attempts": 3, "status": "rate_limited"},
            user_id=user_id,
            request_id=request_id
        )
        raise GeminiRateLimitExhausted("Assistant is busy right now. Please try again shortly.")

# Global shared instance
gemini_rate_limiter = SharedGeminiRateLimiter()
