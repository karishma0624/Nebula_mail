import { NextRequest, NextResponse } from 'next/server';

const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    console.error('Google OAuth error from query param:', error);
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?auth_error=no_code_provided', request.url));
  }

  try {
    const state = searchParams.get('state');
    const backendUrl = new URL(`${AGENT_API_URL}/auth/callback`);
    backendUrl.searchParams.set('code', code);
    if (state) {
      backendUrl.searchParams.set('state', state);
    }

    // Exchange code with FastAPI backend
    const response = await fetch(backendUrl.toString(), {
      method: 'GET',
    });

    if (!response.ok) {
      const errorDetail = await response.text();
      console.error('Backend OAuth token exchange failed:', errorDetail);
      return NextResponse.redirect(new URL(`/?auth_error=token_exchange_failed`, request.url));
    }

    const data = await response.json();
    const sessionToken = data.session_token || '';
    const email = data.email || '';

    // Success! Redirect to home / inbox with session token
    const redirectUrl = new URL('/?auth_success=true', request.url);
    if (sessionToken) {
      redirectUrl.searchParams.set('session_token', sessionToken);
    }
    if (email) {
      redirectUrl.searchParams.set('email', email);
    }

    const res = NextResponse.redirect(redirectUrl);
    if (sessionToken) {
      res.cookies.set('nebula_session_token', sessionToken, {
        path: '/',
        maxAge: 30 * 86400,
        sameSite: 'lax',
      });
    }
    return res;
  } catch (err: any) {
    console.error('Callback handling error:', err);
    return NextResponse.redirect(new URL(`/?auth_error=server_error`, request.url));
  }
}
