'use client';

import React, { useState } from 'react';
import { useMailStore } from '../../lib/store';
import { ShieldAlert, Send, X, Check, AlertCircle } from 'lucide-react';

export const ConfirmSendModal: React.FC = () => {
  const { 
    isConfirmModalOpen, 
    closeConfirmModal, 
    draftToSend, 
    resetComposeDraft, 
    setView 
  } = useMailStore();

  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isConfirmModalOpen || !draftToSend) return null;

  const handleConfirmSend = async () => {
    setIsSending(true);
    setErrorMsg(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/emails/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: draftToSend.to,
          subject: draftToSend.subject,
          body: draftToSend.body,
          thread_id: draftToSend.thread_id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to transmit message via Gmail API');
      }

      // Success
      closeConfirmModal();
      resetComposeDraft();
      setView('sent');
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while sending');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="max-w-lg w-full glass-panel border border-slate-700/80 rounded-3xl p-6 shadow-2xl shadow-indigo-950/80 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <ShieldAlert size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Confirm Email Transmission</h3>
              <p className="text-[11px] text-slate-400">Human-in-the-loop safety boundary</p>
            </div>
          </div>
          <button
            onClick={closeConfirmModal}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Warning banner */}
        <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-200 leading-relaxed">
          Nebula Copilot has prepared this message for dispatch. As an intentional safety guardrail, emails are never dispatched autonomously without your explicit authorization.
        </div>

        {/* Preview of the draft */}
        <div className="space-y-2.5 bg-slate-900/80 p-4 rounded-2xl border border-slate-800 text-xs">
          <div>
            <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">Recipient:</span>
            <p className="text-slate-200 font-medium mt-0.5">{draftToSend.to}</p>
          </div>
          <div>
            <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">Subject:</span>
            <p className="text-slate-200 font-medium mt-0.5">{draftToSend.subject}</p>
          </div>
          <div>
            <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">Body Preview:</span>
            <div className="text-slate-300 mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
              {draftToSend.body}
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
            {errorMsg.toLowerCase().includes('oauth') && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
                    const res = await fetch(`${apiUrl}/auth/login-url`);
                    const data = await res.json();
                    if (data.url) window.location.href = data.url;
                  } catch (e) {
                    console.error('Failed to get OAuth URL:', e);
                  }
                }}
                className="w-full mt-2 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-2 px-4 rounded-xl text-xs font-semibold shadow-md transition"
              >
                <span>Sign in with Google now</span>
              </button>
            )}
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={closeConfirmModal}
            disabled={isSending}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            Back to Edit
          </button>
          <button
            type="button"
            onClick={handleConfirmSend}
            disabled={isSending}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-xs font-semibold py-2.5 px-5 rounded-xl shadow-lg shadow-emerald-600/30 transition disabled:opacity-50"
          >
            {isSending ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Sending via Gmail...</span>
              </>
            ) : (
              <>
                <Send size={13} />
                <span>Authorize & Send</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
