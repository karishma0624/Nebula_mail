'use client';

import React, { useState } from 'react';
import { Mail, Shield, KeyRound, ArrowRight, Sparkles, AlertTriangle } from 'lucide-react';

interface ConnectGmailBannerProps {
  onSimulateConnect?: () => void;
}

export const ConnectGmailBanner: React.FC<ConnectGmailBannerProps> = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConnectGmail = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/auth/login-url`);
      if (!response.ok) {
        throw new Error('OAuth service not configured yet. Check backend .env settings.');
      }
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Did not receive a valid authorization URL.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initiate Google OAuth flow.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-[#f6f8fc] dark:bg-nebula-950 select-none transition-colors">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-xl text-center relative overflow-hidden">
        {/* Glow ambient background */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 dark:bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-cyan-500/10 dark:bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Icon Header */}
        <div className="relative mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/25 mb-6">
          <Mail className="text-white" size={32} />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-xs">
            <KeyRound size={12} className="text-blue-600 dark:text-cyan-400" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mb-2">
          Connect your Gmail
        </h2>
        
        <p className="text-slate-600 dark:text-slate-400 text-sm mb-6 leading-relaxed">
          Nebula Mail connects directly to your real Gmail account via secure Google OAuth2. 
          Zero fake data — all inbox items, search, and AI copilot actions execute against live mail.
        </p>

        {/* Security badges */}
        <div className="grid grid-cols-2 gap-2.5 mb-6 text-left">
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <Shield size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">Readonly + Send</span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <Sparkles size={16} className="text-blue-600 dark:text-cyan-400 shrink-0" />
            <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">AI Guardrails</span>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 text-xs flex items-start gap-2 text-left">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Primary Connect Button */}
        <button
          onClick={handleConnectGmail}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-indigo-600/30 transition duration-150 ease-in-out disabled:opacity-60"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              {/* Google G icon */}
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>Sign in with Google</span>
              <ArrowRight size={16} className="ml-1" />
            </>
          )}
        </button>

        <p className="text-[11px] text-slate-500 mt-4">
          Tokens are stored securely in Supabase with user-level Row Level Security policies.
        </p>
      </div>
    </div>
  );
};
