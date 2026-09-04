'use client';

import React from 'react';
import { EmailListItem } from './EmailListItem';
import { PaginationBar } from './PaginationBar';
import { useMailStore } from '../../lib/store';
import { Inbox, MailSearch, Sparkles, ArrowLeft } from 'lucide-react';

interface EmailListProps {
  onNextPage?: () => void;
  onPrevPage?: () => void;
  onClearSearch?: () => void;
}

export const EmailList: React.FC<EmailListProps> = ({
  onNextPage,
  onPrevPage,
  onClearSearch
}) => {
  const { 
    filteredEmails, 
    isLoadingEmails, 
    activeFilters, 
    resetFilters,
    currentPage,
    nextPageToken,
    totalMessages,
    isSearchActive,
    searchQueryDescription,
    searchResultEstimate,
    clearSearch
  } = useMailStore();

  const hasFilters = Object.values(activeFilters).some(
    (v) => v !== undefined && v !== '' && v !== false
  );

  const handleClear = () => {
    clearSearch();
    if (onClearSearch) {
      onClearSearch();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Active Search Banner */}
      {isSearchActive && (
        <div className="bg-indigo-950/40 border-b border-indigo-500/30 px-6 py-2.5 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <Sparkles size={15} className="text-cyan-400 shrink-0 animate-pulse" />
            <span className="text-xs font-semibold text-indigo-200 shrink-0">Active Gmail Search:</span>
            <span className="text-xs text-indigo-300 font-mono bg-indigo-900/60 px-2 py-0.5 rounded border border-indigo-500/30 truncate max-w-md">
              {searchQueryDescription || 'Mailbox Search'}
            </span>
            {searchResultEstimate !== null && (
              <span className="text-xs text-slate-400 shrink-0">
                ({searchResultEstimate.toLocaleString()} {searchResultEstimate === 1 ? 'match' : 'matches'})
              </span>
            )}
          </div>
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition shrink-0"
          >
            <ArrowLeft size={13} />
            <span>Back to Inbox</span>
          </button>
        </div>
      )}

      {/* Main Email Scroll Area */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingEmails ? (
          <div className="p-6 space-y-4">
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
        ) : filteredEmails.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-12 text-center select-none">
            <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-slate-400 mb-4 shadow-inner">
              {isSearchActive || hasFilters ? <MailSearch size={28} /> : <Inbox size={28} />}
            </div>
            <h3 className="text-base font-semibold text-slate-200 mb-1">
              {isSearchActive
                ? 'No emails found in Gmail matching your search'
                : hasFilters
                ? 'No emails match your filter'
                : 'No messages in this folder'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mb-4">
              {isSearchActive
                ? 'Try searching with different keywords, sender addresses, or check for typos.'
                : hasFilters
                ? 'Try adjusting your filter criteria, dates, or clearing active filters.'
                : 'New emails received in your connected Gmail will appear here automatically.'}
            </p>
            {isSearchActive ? (
              <button
                onClick={handleClear}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 text-xs font-medium transition"
              >
                Back to Inbox
              </button>
            ) : hasFilters ? (
              <button
                onClick={resetFilters}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 text-xs font-medium transition"
              >
                Clear all filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {filteredEmails.map((email) => (
              <EmailListItem key={email.id} email={email} />
            ))}
          </div>
        )}
      </div>

      {/* Reusable Bottom Pagination Bar */}
      <PaginationBar
        currentPage={currentPage}
        pageSize={25}
        totalCount={totalMessages}
        currentCount={filteredEmails.length}
        hasNextPage={Boolean(nextPageToken)}
        isLoading={isLoadingEmails}
        isSearchActive={isSearchActive}
        isUnreadFilter={Boolean(activeFilters.unread_only)}
        searchEstimate={searchResultEstimate}
        onNextPage={() => onNextPage?.()}
        onPrevPage={() => onPrevPage?.()}
      />
    </div>
  );
};
