'use client';

import React from 'react';
import { useMailStore } from '../../lib/store';
import { Send, X, Sparkles, ShieldCheck } from 'lucide-react';

export const ComposeForm: React.FC = () => {
  const { 
    composeDraft, 
    setComposeDraft, 
    resetComposeDraft, 
    setView, 
    openConfirmModal,
    isTypingCompose 
  } = useMailStore();

  const handleSendClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeDraft.to || !composeDraft.subject) {
      alert('Please provide recipient and subject');
      return;
    }
    // Strict Guardrail: Always open confirmation modal, never send instantly without approval
    openConfirmModal(composeDraft);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-nebula-950 overflow-hidden">
      {/* Compose header */}
      <div className="p-4 px-6 border-b border-slate-800/80 bg-nebula-900/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-white">New Message</h3>
          {isTypingCompose && (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 animate-pulse">
              <Sparkles size={12} className="text-cyan-400" />
              <span>Copilot is typing...</span>
            </div>
          )}
        </div>
        <button
          onClick={() => {
            resetComposeDraft();
            setView('inbox');
          }}
          className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition"
        >
          <X size={18} />
        </button>
      </div>

      {/* Form body */}
      <form onSubmit={handleSendClick} className="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full gap-4 overflow-y-auto">
        {/* Recipient */}
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-3">
          <label className="text-xs font-semibold text-slate-400 w-16">To:</label>
          <input
            type="email"
            value={composeDraft.to}
            onChange={(e) => setComposeDraft({ to: e.target.value })}
            placeholder="recipient@example.com"
            required
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
          />
        </div>

        {/* Subject */}
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-3">
          <label className="text-xs font-semibold text-slate-400 w-16">Subject:</label>
          <input
            type="text"
            value={composeDraft.subject}
            onChange={(e) => setComposeDraft({ subject: e.target.value })}
            placeholder="Subject of your email"
            required
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none font-medium"
          />
        </div>

        {/* Body TextArea */}
        <div className="flex-1 flex flex-col min-h-[280px]">
          <textarea
            value={composeDraft.body}
            onChange={(e) => setComposeDraft({ body: e.target.value })}
            placeholder="Write your email here, or ask Nebula Copilot to draft it for you..."
            required
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none resize-none leading-relaxed p-2 font-sans"
          />
        </div>

        {/* Action Bar */}
        <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck size={14} className="text-indigo-400" />
            <span>Human-in-the-loop review required before final transmission</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                resetComposeDraft();
                setView('inbox');
              }}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            >
              Discard
            </button>
            <button
              type="submit"
              disabled={isTypingCompose}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs font-semibold py-2.5 px-5 rounded-xl shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
            >
              <Send size={14} />
              <span>Review & Send</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
