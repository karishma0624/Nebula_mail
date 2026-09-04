'use client';

import React from 'react';
import { Email } from '../../lib/types';
import { useMailStore } from '../../lib/store';
import { Mail, Clock } from 'lucide-react';

interface EmailListItemProps {
  email: Email;
}

export const EmailListItem: React.FC<EmailListItemProps> = ({ email }) => {
  const { setOpenEmail, openEmail } = useMailStore();

  const isSelected = openEmail?.id === email.id;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    return isToday
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getSenderName = (rawSender: string) => {
    // E.g. "Sarah Jenkins <sarah@example.com>" -> "Sarah Jenkins"
    const match = rawSender.match(/^([^<]+)/);
    return match ? match[1].trim().replace(/"/g, '') : rawSender;
  };

  const senderName = getSenderName(email.sender);
  const initial = senderName ? senderName.charAt(0).toUpperCase() : '?';

  return (
    <div
      onClick={() => setOpenEmail(email)}
      className={`group px-6 py-4 border-b border-slate-800/80 cursor-pointer transition duration-150 flex items-start gap-4 ${
        isSelected
          ? 'bg-indigo-950/40 border-indigo-500/40'
          : email.is_unread
          ? 'bg-slate-900/90 hover:bg-slate-800/60'
          : 'bg-nebula-950/60 hover:bg-slate-900/50'
      }`}
    >
      {/* Unread indicator dot */}
      <div className="pt-2">
        <span
          className={`block w-2.5 h-2.5 rounded-full ${
            email.is_unread ? 'bg-indigo-500 shadow-sm shadow-indigo-500/50' : 'bg-transparent'
          }`}
        />
      </div>

      {/* Avatar */}
      <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700/80 flex items-center justify-center text-sm font-semibold text-indigo-300 shrink-0 shadow-inner">
        {initial}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={`text-sm truncate ${email.is_unread ? 'font-bold text-white' : 'font-medium text-slate-300'}`}>
            {senderName}
          </span>
          <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0">
            <Clock size={11} />
            {formatDate(email.date || email.received_at)}
          </span>
        </div>

        <h4 className={`text-xs truncate mb-1 ${email.is_unread ? 'font-semibold text-slate-200' : 'text-slate-400'}`}>
          {email.subject || '(No Subject)'}
        </h4>

        <p className="text-xs text-slate-500 truncate leading-relaxed">
          {email.snippet}
        </p>
      </div>
    </div>
  );
};
