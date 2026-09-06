'use client';

import React, { useState } from 'react';
import { useMailStore } from '../../lib/store';
import { ShieldAlert, Calendar, Clock, Users, Video, X, Check, AlertCircle, ExternalLink } from 'lucide-react';

const isValidUUID = (id?: string | null): boolean => {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

export const ConfirmMeetingModal: React.FC = () => {
  const { 
    isMeetingModalOpen, 
    closeMeetingModal, 
    meetingDraft, 
    setView 
  } = useMailStore();

  const [isConfirming, setIsConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [enableUrl, setEnableUrl] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ meetLink?: string; calendarEventId?: string } | null>(null);

  if (!isMeetingModalOpen || !meetingDraft) return null;

  const isIdReady = isValidUUID(meetingDraft.id);

  const formatDateTime = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  const handleConfirmMeeting = async () => {
    const activeMeeting = useMailStore.getState().meetingDraft;
    if (!activeMeeting || !isValidUUID(activeMeeting.id)) return;

    setIsConfirming(true);
    setErrorMsg(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/calendar/confirm_meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_draft_id: activeMeeting.id,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (data.enable_url) {
        setEnableUrl(data.enable_url);
      }
      if (!response.ok) {
        throw new Error(data.error || data.detail?.error || data.detail?.message || data.detail || data.message || 'Failed to schedule Google Meet');
      }

      if (data.status === 'failed') {
        throw new Error(data.error || 'Failed to schedule Google Meet');
      }

      setSuccessInfo({
        meetLink: data.meet_link || data.data?.meet_link,
        calendarEventId: data.calendar_event_id || data.data?.calendar_event_id,
      });

      // Automatically dismiss after brief celebration or allow user to click Done
      setTimeout(() => {
        closeMeetingModal();
        setView('sent');
      }, 2500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while scheduling Google Meet');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancel = () => {
    const activeMeeting = useMailStore.getState().meetingDraft;
    if (activeMeeting?.id && isValidUUID(activeMeeting.id)) {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
        fetch(`${apiUrl}/calendar/reject_meeting`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meeting_draft_id: activeMeeting.id,
          }),
        }).catch(() => {});
      } catch {}
    }
    closeMeetingModal();
  };

  // Render body template with {meet_link} visually marked as "link added on confirm"
  const renderTemplatePreview = (template: string) => {
    if (!template) return <span className="italic text-slate-400">No email body template provided</span>;
    const parts = template.split(/(\{meet_link\})/gi);
    return parts.map((part, i) => {
      if (part.toLowerCase() === '{meet_link}') {
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-semibold text-[11px]"
            title="A real Google Meet video link will be automatically generated and inserted upon your confirmation"
          >
            <Video size={12} />
            <span>[Meet Link — added on confirm]</span>
          </span>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="max-w-lg w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-violet-600 dark:text-violet-400">
              <Calendar size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Confirm Google Meet & Invitation
                </h3>
                <span className="text-[10px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full">
                  Calendar Event
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Human-in-the-loop safety boundary
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
        <div className="p-3 rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-500/30 text-xs text-violet-900 dark:text-violet-200 leading-relaxed">
          Creating a Google Calendar event with attendees automatically notifies them. As an intentional safety guardrail, no calendar event is created or email sent without your explicit authorization.
        </div>

        {/* Meeting Details Card */}
        <div className="space-y-3 bg-slate-50 dark:bg-slate-900/80 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs">
          <div>
            <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              Meeting Title:
            </span>
            <p className="text-slate-900 dark:text-slate-100 font-bold text-sm mt-0.5">
              {meetingDraft.title}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <Clock size={11} /> Start Time:
              </span>
              <p className="text-slate-800 dark:text-slate-200 font-medium mt-0.5 text-[11px]">
                {formatDateTime(meetingDraft.start_time)}
              </p>
            </div>
            <div>
              <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <Clock size={11} /> End Time:
              </span>
              <p className="text-slate-800 dark:text-slate-200 font-medium mt-0.5 text-[11px]">
                {formatDateTime(meetingDraft.end_time)}
              </p>
            </div>
          </div>

          <div>
            <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              <Users size={11} /> Attendees ({meetingDraft.attendees.length}):
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {meetingDraft.attendees.map((att, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-full bg-slate-200/80 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium text-[11px]"
                >
                  {att}
                </span>
              ))}
            </div>
          </div>

          {/* Email Draft Body Preview */}
          <div>
            <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              Email Invitation Body:
            </span>
            <div className="text-slate-800 dark:text-slate-200 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] bg-white dark:bg-slate-950 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800/80 leading-relaxed">
              {renderTemplatePreview(meetingDraft.email_body_template || '')}
            </div>
          </div>
        </div>

        {/* Success Banner */}
        {successInfo && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs space-y-1 animate-in fade-in">
            <div className="flex items-center gap-2 font-bold">
              <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span>Meeting scheduled & invitation dispatched!</span>
            </div>
            {successInfo.meetLink && (
              <a
                href={successInfo.meetLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 underline font-mono"
              >
                {successInfo.meetLink}
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}

        {/* Error Banner */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-rose-500 dark:text-rose-400" />
              <span>{errorMsg}</span>
            </div>
            {enableUrl || errorMsg.toLowerCase().includes('google cloud') || errorMsg.toLowerCase().includes('enable') ? (
              <div className="pt-1">
                <a
                  href={enableUrl || "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=381385847886"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs transition shadow-sm inline-flex items-center gap-1.5"
                >
                  Enable Google Calendar API in Cloud Console &rarr;
                </a>
              </div>
            ) : (errorMsg.toLowerCase().includes('oauth') || errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('calendar') || errorMsg.toLowerCase().includes('fetch')) ? (
              <div className="pt-1">
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
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs transition shadow-sm inline-flex items-center gap-1.5"
                >
                  Reconnect Google Account to Grant Calendar Permission &rarr;
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={handleCancel}
            disabled={isConfirming}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmMeeting}
            disabled={!isIdReady || isConfirming || !!successInfo}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 active:scale-95 transition shadow-lg shadow-violet-500/25 disabled:opacity-50"
          >
            {!isIdReady ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Preparing meeting...</span>
              </>
            ) : isConfirming ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Scheduling Meeting...</span>
              </>
            ) : successInfo ? (
              <>
                <Check size={14} />
                <span>Confirmed</span>
              </>
            ) : (
              <>
                <Video size={14} />
                <span>Confirm & Schedule</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
