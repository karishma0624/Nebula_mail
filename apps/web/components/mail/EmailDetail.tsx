'use client';

import React from 'react';
import { useMailStore } from '../../lib/store';
import { 
  ArrowLeft, 
  Reply, 
  Share2, 
  Clock, 
  ShieldAlert, 
  UserCheck, 
  Mail 
} from 'lucide-react';

export const EmailDetail: React.FC = () => {
  const { openEmail, setOpenEmail, setView, setComposeDraft } = useMailStore();

  if (!openEmail) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Select an email to view its content.
      </div>
    );
  }

  const handleReply = () => {
    // Pre-fill compose draft for reply
    const replySubject = openEmail.subject.startsWith('Re:')
      ? openEmail.subject
      : `Re: ${openEmail.subject}`;

    setComposeDraft({
      to: openEmail.sender,
      subject: replySubject,
      body: `\n\n--- Original Message ---\nFrom: ${openEmail.sender}\n${openEmail.body_text || openEmail.snippet}`,
      reply_to_id: openEmail.id,
      thread_id: openEmail.thread_id,
    });
    setView('compose');
  };

  const handleForward = () => {
    const fwdSubject = openEmail.subject.startsWith('Fwd:')
      ? openEmail.subject
      : `Fwd: ${openEmail.subject}`;

    setComposeDraft({
      to: '',
      subject: fwdSubject,
      body: `\n\n--- Forwarded Message ---\nFrom: ${openEmail.sender}\n${openEmail.body_text || openEmail.snippet}`,
    });
    setView('compose');
  };

  // Inspect for adversarial injection warning
  const isAdversarialCandidate = 
    (openEmail.body_text && openEmail.body_text.toLowerCase().includes('ignore previous instructions')) ||
    (openEmail.snippet && openEmail.snippet.toLowerCase().includes('ignore previous instructions'));

  return (
    <div className="flex-1 flex flex-col h-full bg-nebula-950 overflow-hidden">
      {/* Top action header */}
      <div className="p-4 px-6 border-b border-slate-800/80 bg-nebula-900/60 flex items-center justify-between gap-4">
        <button
          onClick={() => setOpenEmail(null)}
          className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700/60 transition"
        >
          <ArrowLeft size={14} />
          <span>Back to List</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReply}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 transition"
          >
            <Reply size={13} />
            <span>Reply</span>
          </button>
          <button
            onClick={handleForward}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition"
          >
            <Share2 size={13} />
            <span>Forward</span>
          </button>
        </div>
      </div>

      {/* Main detail content */}
      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full">
        {/* Security / Untrusted Content Banner if prompt injection detected */}
        {isAdversarialCandidate && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-start gap-3">
            <ShieldAlert size={20} className="shrink-0 text-amber-400 mt-0.5" />
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider">Untrusted Email Content (Guardrail Active)</h5>
              <p className="text-xs text-amber-200/80 mt-1">
                This email contains embedded instructions (&quot;ignore previous instructions...&quot;). 
                Nebula Mail Copilot treats all body text strictly as untrusted data and will not execute instructions inside it.
              </p>
            </div>
          </div>
        )}

        {/* Email Subject Title */}
        <h2 className="text-2xl font-bold text-white tracking-tight mb-4">
          {openEmail.subject || '(No Subject)'}
        </h2>

        {/* Sender and recipient meta card */}
        <div className="flex items-start justify-between gap-4 p-4 rounded-2xl bg-slate-900/60 border border-slate-800 mb-6">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center font-bold text-white text-sm shadow-md">
              {openEmail.sender.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-100 text-sm">
                  {openEmail.sender}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                To: {openEmail.recipients.join(', ') || 'me'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={13} />
            <span>{openEmail.date || openEmail.received_at || 'Just now'}</span>
          </div>
        </div>

        {/* Email Body Content */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 text-slate-200 text-sm leading-relaxed whitespace-pre-wrap font-sans">
          {openEmail.body_html ? (
            <div 
              className="prose prose-invert max-w-none text-slate-200"
              dangerouslySetInnerHTML={{ __html: openEmail.body_html }} 
            />
          ) : (
            openEmail.body_text || openEmail.snippet
          )}
        </div>
      </div>
    </div>
  );
};
