'use client';

import React, { useState } from 'react';
import { useMailStore } from '../../lib/store';
import { Send, X, Sparkles, ShieldCheck, Zap } from 'lucide-react';

export const ComposeForm: React.FC = () => {
  const { 
    composeDraft, 
    setComposeDraft, 
    resetComposeDraft, 
    setView, 
    openConfirmModal,
    isTypingCompose,
    sendMode
  } = useMailStore();

  const [isSending, setIsSending] = useState(false);

  const handleSendClick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeDraft.to || !composeDraft.subject) {
      alert('Please provide recipient and subject');
      return;
    }

    // Human-in-the-loop confirmation is mandatory for all sends
    openConfirmModal(composeDraft);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-nebula-950 overflow-hidden transition-colors">
      {/* Compose header */}
      <div className="p-4 px-6 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/80 dark:bg-nebula-900/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {composeDraft.reply_to_id ? 'Reply to Message' : 'New Message'}
          </h3>
          {isTypingCompose && (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs bg-blue-50 dark:bg-indigo-500/20 text-blue-700 dark:text-indigo-300 border border-blue-200 dark:border-indigo-500/40 animate-pulse">
              <Sparkles size={12} className="text-blue-600 dark:text-cyan-400" />
              <span>Copilot is typing...</span>
            </div>
          )}
        </div>
        <button
          onClick={() => {
            resetComposeDraft();
            setView('inbox');
          }}
          className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-200/70 dark:hover:bg-slate-800 transition"
        >
          <X size={18} />
        </button>
      </div>

      {/* Form body */}
      <form onSubmit={handleSendClick} className="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full gap-4 overflow-y-auto">
        {/* Recipient */}
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-3">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 w-16">To:</label>
          <input
            type="email"
            value={composeDraft.to}
            onChange={(e) => setComposeDraft({ to: e.target.value })}
            placeholder="recipient@example.com"
            required
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
          />
        </div>

        {/* Subject */}
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-3">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 w-16">Subject:</label>
          <input
            type="text"
            value={composeDraft.subject}
            onChange={(e) => setComposeDraft({ subject: e.target.value })}
            placeholder="Subject of your email"
            required
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none font-medium"
          />
        </div>

        {/* Body TextArea */}
        <div className="flex-1 flex flex-col min-h-[280px]">
          <textarea
            value={composeDraft.body}
            onChange={(e) => setComposeDraft({ body: e.target.value })}
            placeholder="Write your email here, or ask Nebula Copilot to draft it for you..."
            required
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none resize-none leading-relaxed p-2 font-sans"
          />
        </div>

        {/* Action Bar */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            {sendMode === 'automatic' ? (
              <>
                <Zap size={14} className="text-amber-500 shrink-0" />
                <span className="text-amber-700 dark:text-amber-400 font-medium">Automatic send active: message will be dispatched immediately without confirmation modal.</span>
              </>
            ) : (
              <>
                <ShieldCheck size={14} className="text-blue-600 dark:text-indigo-400 shrink-0" />
                <span className="text-slate-500 dark:text-slate-400">Human-in-the-loop review required before final transmission</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                resetComposeDraft();
                setView('inbox');
              }}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Discard
            </button>
            <button
              type="submit"
              disabled={isTypingCompose || isSending}
              className={`flex items-center gap-2 text-white text-xs font-semibold py-2.5 px-5 rounded-xl shadow-lg transition disabled:opacity-50 ${
                sendMode === 'automatic'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/30'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-blue-600/25'
              }`}
            >
              {isSending ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send size={14} />
                  <span>{sendMode === 'automatic' ? 'Send Automatically' : 'Review & Send'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
