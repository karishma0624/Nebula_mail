'use client';

import React, { useState, useEffect } from 'react';
import { useMailStore } from '../../lib/store';
import { 
  X, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  Send, 
  ExternalLink,
  Loader2 
} from 'lucide-react';

const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';

export const FormFillModal: React.FC = () => {
  const { 
    isFormModalOpen, 
    closeFormModal, 
    formModalEmail, 
    userEmail 
  } = useMailStore();

  const [formType, setFormType] = useState<'pdf' | 'google_form' | 'ms_form' | 'other'>('pdf');
  const [fields, setFields] = useState<Record<string, string>>({
    fullName: 'Karishma',
    email: userEmail || 'user@example.com',
    subject: '',
    purpose: 'Quarterly Project Assessment',
    comments: 'All milestones on track.'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (formModalEmail) {
      const url = formModalEmail.form_url || '';
      let detectedType: 'pdf' | 'google_form' | 'ms_form' | 'other' = 'pdf';
      if (url.includes('forms.gle') || url.includes('google.com/forms')) {
        detectedType = 'google_form';
      } else if (url.includes('forms.office.com')) {
        detectedType = 'ms_form';
      } else if (formModalEmail.snippet?.toLowerCase().includes('pdf')) {
        detectedType = 'pdf';
      }

      setFormType(detectedType);
      setFields({
        fullName: 'Karishma',
        email: userEmail || 'user@nebula.local',
        referenceSubject: formModalEmail.subject || '',
        purpose: 'Form submission for: ' + (formModalEmail.subject || 'Application'),
        additionalNotes: 'Pre-filled with verified context from your inbox.'
      });
      setStatusMessage(null);
    }
  }, [formModalEmail, userEmail]);

  if (!isFormModalOpen || !formModalEmail) return null;

  const handleFieldChange = (key: string, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleConfirmSubmit = async () => {
    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`${AGENT_API_URL}/forms/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_id: formModalEmail.id,
          form_type: formType,
          fields,
          action: 'submit'
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      setStatusMessage({
        type: 'success',
        text: 'Form submitted successfully! Recorded in audit log.'
      });

      setTimeout(() => {
        setIsSubmitting(false);
        closeFormModal();
      }, 1400);
    } catch (err: any) {
      setIsSubmitting(false);
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to submit form'
      });
    }
  };

  const handleReject = async () => {
    try {
      await fetch(`${AGENT_API_URL}/forms/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_id: formModalEmail.id,
          form_type: formType,
          fields,
          action: 'reject'
        }),
      });
    } catch (e) {
      console.warn('Error rejecting form fill:', e);
    }
    closeFormModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-nebula-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 px-6 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-cyan-500 flex items-center justify-center text-white shadow-md">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Form Auto-Fill Preview</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 uppercase tracking-wider">
                  {formType.replace('_', ' ')}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">Review and edit fields before submitting</p>
            </div>
          </div>
          <button
            onClick={closeFormModal}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Source notice */}
          <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300 flex items-start gap-2.5">
            <FileText size={16} className="text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white">Source Email: </span>
              <span className="text-slate-300">{formModalEmail.subject}</span>
              {formModalEmail.form_url && (
                <a
                  href={formModalEmail.form_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
                >
                  <span>Open Form Target</span>
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>

          {/* Status Feedback */}
          {statusMessage && (
            <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
            }`}>
              {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Editable Field Groups */}
          <div className="space-y-3">
            {Object.entries(fields).map(([key, val]) => (
              <div key={key}>
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </label>
                <input
                  type="text"
                  value={val}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition disabled:opacity-50"
                />
              </div>
            ))}
          </div>

          {/* Guardrail Note */}
          <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/20 text-[11px] text-indigo-300">
            <strong>Human Confirmation:</strong> Nebula Copilot prepares form data but will never submit external forms without your explicit confirmation.
          </div>
        </div>

        {/* Modal Actions */}
        <div className="p-4 px-6 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
          <button
            onClick={handleReject}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-40"
          >
            Dismiss
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={closeFormModal}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 transition disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition disabled:opacity-40 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} />
                  <span>Confirm & Submit</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
