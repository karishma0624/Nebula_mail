'use client';

import React, { useState } from 'react';
import { Email } from '../../lib/types';
import { useMailStore } from '../../lib/store';
import { Star, Paperclip } from 'lucide-react';
import { HighlightedText } from '../ui/HighlightedText';

interface EmailListItemProps {
  email: Email;
  isSelectedItem?: boolean;
  onToggleSelect?: (id: string) => void;
}

export const EmailListItem: React.FC<EmailListItemProps> = ({ 
  email, 
  isSelectedItem = false,
  onToggleSelect 
}) => {
  const { 
    setOpenEmail, 
    openEmail, 
    highlightedEmailId,
    activeFilters,
    searchQueryDescription,
    isSearchActive
  } = useMailStore();
  const [isStarred, setIsStarred] = useState(email.label_ids?.includes('STARRED') || false);

  const isCurrentOpen = openEmail?.id === email.id;
  const isHighlighted = highlightedEmailId === email.id;

  // Extract active search & filter keywords to highlight in the list
  const highlightTerms: string[] = [];
  if (activeFilters.sender) highlightTerms.push(activeFilters.sender);
  if (activeFilters.keyword) highlightTerms.push(activeFilters.keyword);
  if (isSearchActive && searchQueryDescription) {
    const rawTokens = searchQueryDescription.split(/\s+/);
    rawTokens.forEach(token => {
      const clean = token.replace(/^(from|to|subject|label|after|before):/i, '').trim();
      if (clean && !clean.includes(':')) {
        highlightTerms.push(clean);
      }
    });
  }

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
    const match = rawSender.match(/^([^<]+)/);
    return match ? match[1].trim().replace(/"/g, '') : rawSender;
  };

  const senderName = getSenderName(email.sender);

  return (
    <div
      onClick={() => setOpenEmail(email)}
      className={`group flex items-center gap-3 px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-800/60 cursor-pointer transition-colors duration-150 select-none text-sm ${
        isHighlighted
          ? 'highlight-citation ring-2 ring-blue-500 dark:ring-indigo-400 bg-blue-50/80 dark:bg-indigo-950/60'
          : isCurrentOpen
          ? 'bg-blue-100/70 dark:bg-indigo-950/60 border-l-[3px] border-l-blue-600 dark:border-l-indigo-500'
          : email.is_unread
          ? 'bg-white dark:bg-slate-900/90 hover:bg-[#e8eef6] dark:hover:bg-slate-800/80 border-l-[3px] border-l-blue-600 dark:border-l-indigo-400 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.04)]'
          : 'bg-[#f2f6fc]/70 dark:bg-slate-950/40 hover:bg-[#e8eef6] dark:hover:bg-slate-900/60 border-l-[3px] border-l-transparent'
      }`}
    >
      {/* Selection Checkbox */}
      <div 
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect?.(email.id);
        }}
        className="flex items-center justify-center shrink-0"
      >
        <input
          type="checkbox"
          checked={isSelectedItem}
          onChange={() => {}}
          className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer transition"
        />
      </div>

      {/* Star Icon Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsStarred(!isStarred);
        }}
        className="p-0.5 rounded text-slate-400 dark:text-slate-500 hover:text-amber-400 transition shrink-0"
        title={isStarred ? "Starred" : "Not starred"}
      >
        <Star
          size={16}
          className={isStarred ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors"}
        />
      </button>

      {/* Unread dot indicator */}
      <div className="w-1.5 shrink-0 flex items-center justify-center">
        {email.is_unread && (
          <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-indigo-400 shadow-sm shadow-blue-500/50" />
        )}
      </div>

      {/* Sender Column */}
      <div className="w-44 md:w-52 shrink-0 truncate pr-2">
        <span
          className={`truncate block ${
            email.is_unread
              ? 'font-bold text-slate-900 dark:text-white tracking-tight'
              : 'font-normal text-slate-700 dark:text-slate-300'
          }`}
        >
          <HighlightedText text={senderName} terms={highlightTerms} />
        </span>
      </div>

      {/* Subject & Snippet (Single Line Gmail Density) */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
        {(email.has_form || email.form_url) && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
            Form
          </span>
        )}
        {email.attachments && email.attachments.length > 0 && (
          <span className="shrink-0 text-slate-400 dark:text-slate-500 hover:text-indigo-400 transition" title={`${email.attachments.length} attachment(s)`}>
            <Paperclip size={13} />
          </span>
        )}
        <span
          className={`truncate shrink-0 max-w-[55%] ${
            email.is_unread
              ? 'font-bold text-slate-900 dark:text-slate-100'
              : 'font-normal text-slate-700 dark:text-slate-300'
          }`}
        >
          <HighlightedText text={email.subject || '(No Subject)'} terms={highlightTerms} />
        </span>
        <span className="text-slate-400 dark:text-slate-600 shrink-0 select-none">-</span>
        <span className="text-slate-600 dark:text-slate-400 text-xs truncate flex-1">
          <HighlightedText text={email.snippet || ''} terms={highlightTerms} />
        </span>
      </div>

      {/* Timestamp on Far Right */}
      <div className="w-20 text-right shrink-0">
        <span
          className={`text-xs whitespace-nowrap ${
            email.is_unread
              ? 'font-bold text-slate-900 dark:text-slate-200'
              : 'font-medium text-slate-600 dark:text-slate-400'
          }`}
        >
          {formatDate(email.date || email.received_at)}
        </span>
      </div>
    </div>
  );
};
