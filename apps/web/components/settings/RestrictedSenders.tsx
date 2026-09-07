'use client';

import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, Plus, Trash2, Check, AlertCircle, Lock, RefreshCw } from 'lucide-react';
import { authFetch, AGENT_API_URL } from '../../lib/api';

interface RestrictedSender {
  id: string;
  user_id: string;
  email_address: string;
  label?: string | null;
  created_at: string;
}

interface RestrictedSendersProps {
  onClose?: () => void;
}

export const RestrictedSenders: React.FC<RestrictedSendersProps> = ({ onClose }) => {
  const [senders, setSenders] = useState<RestrictedSender[]>([]);
  const [emailAddress, setEmailAddress] = useState('');
  const [label, setLabel] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchSenders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${AGENT_API_URL}/settings/restricted-senders`);
      if (!res.ok) {
        throw new Error('Failed to load confidential contacts');
      }
      const data = await res.json();
      setSenders(data || []);
    } catch (err: any) {
      setError(err.message || 'Error fetching restricted senders');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSenders();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailAddress.trim()) {
      setError('Please provide an email address');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await authFetch(`${AGENT_API_URL}/settings/restricted-senders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_address: emailAddress.trim(),
          label: label.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to add confidential contact');
      }

      setEmailAddress('');
      setLabel('');
      setSuccess('Contact marked confidential');
      setTimeout(() => setSuccess(null), 3000);
      await fetchSenders();
    } catch (err: any) {
      setError(err.message || 'Error adding confidential contact');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, email: string) => {
    if (!confirm(`Remove confidentiality restriction for ${email}? The assistant will regain access to these emails.`)) {
      return;
    }

    try {
      const res = await authFetch(`${AGENT_API_URL}/settings/restricted-senders/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to remove restricted contact');
      }

      setSenders((prev) => prev.filter((s) => s.id !== id));
      setSuccess(`Confidentiality removed for ${email}`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Error removing contact');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30">
        <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
          <Lock size={18} />
        </div>
        <div className="text-xs space-y-1">
          <h4 className="font-semibold text-slate-900 dark:text-slate-100">
            Confidential Contacts & Structural Isolation
          </h4>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Emails to or from these contacts are structurally hidden from the AI assistant at the database view level. 
            They remain fully accessible in your own mail inbox view.
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleAdd} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 space-y-3">
        <h5 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
          Add Confidential Address
        </h5>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            type="email"
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.target.value)}
            placeholder="e.g. secret@confidential.com"
            required
            className="px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional label (e.g. Legal, VIP)"
            className="px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <Check size={14} />
            <span>{success}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || !emailAddress.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium transition-all shadow-sm shadow-indigo-500/20"
          >
            <Plus size={14} />
            <span>{isSubmitting ? 'Adding...' : 'Mark Confidential'}</span>
          </button>
        </div>
      </form>

      {/* List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Protected Contacts ({senders.length})
          </h5>
          <button
            onClick={fetchSenders}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
            title="Refresh list"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {senders.length === 0 ? (
          <div className="py-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            <Shield size={24} className="mx-auto text-slate-300 dark:text-slate-600 mb-1.5" />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              No contacts currently marked confidential.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {senders.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                    <ShieldAlert size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                        {s.email_address}
                      </span>
                      {s.label && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                          {s.label}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400">
                      Added {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(s.id, s.email_address)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                  title="Remove restriction"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
