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

    // Success! Redirect to home / inbox
    return NextResponse.redirect(new URL('/?auth_success=true', request.url));
  } catch (err: any) {
    console.error('Callback handling error:', err);
    return NextResponse.redirect(new URL(`/?auth_error=server_error`, request.url));
  }
}
