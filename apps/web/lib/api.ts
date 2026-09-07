export const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';

const TOKEN_KEY = 'nebula_session_token';

/**
 * Retrieve the active user's session token from localStorage (or fallback cookie).
 */
export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) return token;

    // Fallback: check document.cookie
    const match = document.cookie.match(new RegExp('(^|;\\s*)' + TOKEN_KEY + '=([^;]*)'));
    if (match && match[2]) {
      const cookieToken = decodeURIComponent(match[2]);
      localStorage.setItem(TOKEN_KEY, cookieToken);
      return cookieToken;
    }
  } catch (e) {
    console.warn('[Session] Could not access localStorage/cookies:', e);
  }
  return null;
}

/**
 * Store or clear the active user's session token.
 */
export function setSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${30 * 86400}; SameSite=Lax`;
    } else {
      localStorage.removeItem(TOKEN_KEY);
      document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
    }
  } catch (e) {
    console.warn('[Session] Error setting session token:', e);
  }
}

/**
 * Generate standard authorization headers for outgoing API requests.
 */
export function getAuthHeaders(customHeaders: HeadersInit = {}): Record<string, string> {
  const headersObj: Record<string, string> = {};
  
  if (customHeaders instanceof Headers) {
    customHeaders.forEach((value, key) => {
      headersObj[key] = value;
    });
  } else if (Array.isArray(customHeaders)) {
    customHeaders.forEach(([key, value]) => {
      headersObj[key] = value;
    });
  } else if (customHeaders) {
    Object.assign(headersObj, customHeaders);
  }

  const token = getSessionToken();
  if (token) {
    headersObj['Authorization'] = `Bearer ${token}`;
    headersObj['X-Session-Token'] = token;
  }
  return headersObj;
}

/**
 * Authenticated fetch wrapper that automatically attaches the user's session token.
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = getAuthHeaders(options.headers || {});
  return fetch(url, {
    ...options,
    headers,
  });
}
