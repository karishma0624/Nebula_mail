import { supabase } from './supabaseClient';
import { useMailStore } from './store';

const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';

export async function performLogout(): Promise<boolean> {
  try {
    const res = await fetch(`${AGENT_API_URL}/auth/logout`, {
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
