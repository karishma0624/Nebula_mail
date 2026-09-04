'use client';

import React from 'react';
import { EmailListItem } from './EmailListItem';
import { useMailStore } from '../../lib/store';
import { Inbox, MailSearch, RefreshCw } from 'lucide-react';

export const EmailList: React.FC = () => {
  const { filteredEmails, isLoadingEmails, activeFilters, resetFilters } = useMailStore();

  const hasFilters = Object.values(activeFilters).some(
    (v) => v !== undefined && v !== '' && v !== false
  );

  if (isLoadingEmails) {
    return (
      <div className="flex-1 p-6 space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="animate-pulse flex items-start gap-4 p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <div className="w-9 h-9 bg-slate-800 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-slate-800 rounded w-1/4" />
              <div className="h-3 bg-slate-800/60 rounded w-1/2" />
              <div className="h-3 bg-slate-800/40 rounded w-5/6" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (filteredEmails.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center select-none">
        <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-slate-400 mb-4 shadow-inner">
          {hasFilters ? <MailSearch size={28} /> : <Inbox size={28} />}
        </div>
        <h3 className="text-base font-semibold text-slate-200 mb-1">
          {hasFilters ? 'No emails match your filter' : 'No messages in this folder'}
        </h3>
        <p className="text-xs text-slate-400 max-w-sm mb-4">
          {hasFilters
            ? 'Try adjusting your search criteria, dates, or clearing active filters.'
            : 'New emails received in your connected Gmail will appear here automatically.'}
        </p>
        {hasFilters && (
          <button
            onClick={resetFilters}
            className="px-3.5 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 text-xs font-medium transition"
          >
            Clear all filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
      {filteredEmails.map((email) => (
        <EmailListItem key={email.id} email={email} />
      ))}
    </div>
  );
};
