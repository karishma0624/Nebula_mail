'use client';

import React, { useState } from 'react';
import { useMailStore } from '../../lib/store';
import { authFetch, AGENT_API_URL } from '../../lib/api';
import { ShieldAlert, Send, X, Check, AlertCircle, Mail, Layers, CheckCircle2, XCircle } from 'lucide-react';

export const BulkSendConfirmModal: React.FC = () => {
  const { 
    isBulkSendModalOpen, 
    closeBulkSendModal, 
    bulkSendBatch, 
    setView 
  } = useMailStore();

  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [results, setResults] = useState<{
    sent: Array<{ draft_id: string; result?: any }>;
    failed: Array<{ draft_id: string; error?: string }>;
  } | null>(null);

  if (!isBulkSendModalOpen || !bulkSendBatch) return null;

  const { batchId, draftIds, drafts } = bulkSendBatch;

  const handleConfirmSend = async () => {
    setIsSending(true);
    setErrorMsg(null);
    try {
      const response = await authFetch(`${AGENT_API_URL}/emails/bulk_send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: batchId,
          draft_ids: draftIds,
          drafts: drafts,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail?.message || data.detail || data.message || 'Failed to dispatch email batch');
      }

      setResults({
        sent: data.sent || [],
        failed: data.failed || [],
      });

      // If all sent successfully, switch to sent folder
      if ((data.sent || []).length > 0 && (data.failed || []).length === 0) {
        setTimeout(() => {
          closeBulkSendModal();
          setView('sent');
        }, 2000);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while executing bulk email dispatch');
    } finally {
      setIsSending(false);
    }
  };

  const handleCancel = () => {
    try {
      authFetch(`${AGENT_API_URL}/emails/reject-bulk-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: batchId,
          draft_ids: draftIds,
        }),
      }).catch(() => {});
    } catch {}
    closeBulkSendModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="max-w-2xl w-full max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Layers size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Confirm Batch Email Dispatch
                </h3>
                <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                  {drafts.length} {drafts.length === 1 ? 'Email' : 'Emails'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Human-in-the-loop batch authorization boundary
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Warning Banner */}
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-indigo-950/40 border border-blue-200 dark:border-indigo-500/30 text-xs text-blue-900 dark:text-indigo-200 leading-relaxed shrink-0">
          Nebula Copilot has prepared <span className="font-semibold">{drafts.length} distinct drafts</span> for transmission. As an intentional safety guardrail, no emails are dispatched without your explicit authorization.
        </div>

        {/* Results Summary if completed */}
        {results && (
          <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2 shrink-0">
            <div className="flex items-center gap-4 text-xs font-semibold">
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={16} />
                <span>{results.sent.length} Dispatched</span>
              </div>
              {results.failed.length > 0 && (
                <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                  <XCircle size={16} />
                  <span>{results.failed.length} Failed</span>
                </div>
              )}
            </div>
            {results.failed.length > 0 && (
              <div className="text-[11px] text-rose-700 dark:text-rose-300 font-mono bg-rose-500/10 p-2 rounded-lg">
                {results.failed.map((f, i) => (
                  <div key={i}>Draft {f.draft_id}: {f.error}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Drafts List (Scrollable) */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-3 min-h-[160px]">
          {drafts.map((draft, idx) => (
            <div
              key={draft.draft_id || idx}
              className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs space-y-2 hover:border-blue-500/40 transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100 font-semibold">
                  <Mail size={13} className="text-blue-500" />
                  <span>#{idx + 1}: {Array.isArray(draft.to) ? draft.to.join(', ') : draft.to || '(No recipient)'}</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  {draft.draft_id}
                </span>
              </div>

              <div>
                <span className="text-slate-500 dark:text-slate-400 font-medium text-[11px]">Subject: </span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{draft.subject || '(No subject)'}</span>
              </div>

              <div className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono text-[11px] bg-white dark:bg-slate-950 p-2 rounded-xl border border-slate-200 dark:border-slate-800/80 max-h-24 overflow-y-auto">
                {draft.body || '(Empty body)'}
              </div>
            </div>
          ))}
        </div>

        {/* Error Banner */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle size={15} className="shrink-0 text-rose-500 dark:text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <button
            onClick={handleCancel}
            disabled={isSending}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
          >
            {results ? 'Close' : 'Cancel'}
          </button>
          {!results ? (
            <button
              onClick={handleConfirmSend}
              disabled={isSending}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition shadow-lg shadow-blue-500/25 disabled:opacity-50"
            >
              {isSending ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Dispatching Batch ({drafts.length})...</span>
                </>
              ) : (
                <>
                  <Send size={14} />
                  <span>Confirm & Send Batch ({drafts.length})</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={() => {
                closeBulkSendModal();
                setView('sent');
              }}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition"
            >
              <Check size={14} />
              <span>Done</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
