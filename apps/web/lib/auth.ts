import { supabase } from './supabaseClient';
import { useMailStore } from './store';
import { authFetch, setSessionToken, AGENT_API_URL } from './api';

export async function performLogout(): Promise<boolean> {
  try {
    const res = await authFetch(`${AGENT_API_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      console.warn(`Logout endpoint returned status ${res.status}`);
    }
  } catch (err) {
    console.warn('Backend logout call failed or offline:', err);
  }

  // Clear local session token and cookies
  setSessionToken(null);

  // Clear Supabase session if initialized
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Supabase sign out error:', err);
    }
  }

  // Reset Zustand state
  useMailStore.getState().logout();
  return true;
}
