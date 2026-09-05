'use client';

import React, { useState } from 'react';
import { EmailListItem } from './EmailListItem';
import { PaginationBar } from './PaginationBar';
import { CategoryTabs } from './CategoryTabs';
import { useMailStore } from '../../lib/store';
import { 
  Inbox, 
  MailSearch, 
  Sparkles, 
  ArrowLeft, 
  RotateCw, 
  ChevronLeft, 
  ChevronRight,
  CheckSquare,
  Square
} from 'lucide-react';
import { EmailCategory } from '../../lib/types';

interface EmailListProps {
  onNextPage?: () => void;
  onPrevPage?: () => void;
  onClearSearch?: () => void;
  onCategoryChange?: (category: EmailCategory) => void;
  onRefresh?: () => void;
}

export const EmailList: React.FC<EmailListProps> = ({
  onNextPage,
  onPrevPage,
  onClearSearch,
  onCategoryChange,
  onRefresh
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
    clearSearch,
    currentView,
    activeCategory
  } = useMailStore();

  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set());

  const hasFilters = Object.values(activeFilters).some(
    (v) => v !== undefined && v !== '' && v !== false
  );

  const handleClear = () => {
    clearSearch();
    if (onClearSearch) {
      onClearSearch();
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedEmailIds.size === filteredEmails.length && filteredEmails.length > 0) {
      setSelectedEmailIds(new Set());
    } else {
      setSelectedEmailIds(new Set(filteredEmails.map(e => e.id)));
    }
  };

  const handleToggleSelectOne = (id: string) => {
    const updated = new Set(selectedEmailIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedEmailIds(updated);
  };

  const start = filteredEmails.length > 0 ? (currentPage - 1) * 25 + 1 : 0;
  const end = filteredEmails.length > 0 ? (currentPage - 1) * 25 + filteredEmails.length : 0;
  const allSelected = filteredEmails.length > 0 && selectedEmailIds.size === filteredEmails.length;
  const someSelected = selectedEmailIds.size > 0 && !allSelected;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-slate-950 transition-colors">
      {/* 1. Active Search Banner */}
      {isSearchActive && (
        <div className="bg-blue-50/80 dark:bg-indigo-950/40 border-b border-blue-200/80 dark:border-indigo-500/30 px-6 py-2 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <Sparkles size={15} className="text-blue-600 dark:text-cyan-400 shrink-0 animate-pulse" />
            <span className="text-xs font-semibold text-blue-900 dark:text-indigo-200 shrink-0">Active Gmail Search:</span>
            <span className="text-xs text-blue-800 dark:text-indigo-300 font-mono bg-blue-100 dark:bg-indigo-900/60 px-2 py-0.5 rounded border border-blue-200 dark:border-indigo-500/30 truncate max-w-md">
              {searchQueryDescription || 'Mailbox Search'}
            </span>
            {searchResultEstimate !== null && (
              <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                ({searchResultEstimate.toLocaleString()} {searchResultEstimate === 1 ? 'match' : 'matches'})
              </span>
            )}
          </div>
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-700 dark:bg-indigo-600/20 dark:hover:bg-indigo-600/35 dark:text-indigo-300 border border-blue-300 dark:border-indigo-500/30 text-xs font-semibold transition shrink-0"
          >
            <ArrowLeft size={13} />
            <span>Back to Inbox</span>
          </button>
        </div>
      )}

      {/* 2. Horizontal Gmail Category Tabs (Inbox mode only) */}
      {currentView === 'inbox' && !isSearchActive && (
        <CategoryTabs onCategoryChange={onCategoryChange} />
      )}

      {/* 3. Modern Gmail-Style Action Toolbar & Top Pagination */}
      <div className="h-10 border-b border-slate-200/90 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 px-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 select-none shrink-0 transition-colors">
        {/* Left: Selection & Toolbar Actions */}
        <div className="flex items-center gap-2">
          {/* Select All Checkbox Button */}
          <button
            onClick={handleToggleSelectAll}
            title={allSelected ? "Deselect all" : "Select all"}
            className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition"
          >
            {allSelected ? (
              <CheckSquare size={16} className="text-blue-600 dark:text-indigo-400" />
            ) : someSelected ? (
              <CheckSquare size={16} className="text-slate-500 opacity-75" />
            ) : (
              <Square size={16} className="text-slate-400 dark:text-slate-500" />
            )}
          </button>

          {/* Refresh button */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoadingEmails}
              title="Refresh messages"
              className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition disabled:opacity-40"
            >
              <RotateCw size={14} className={isLoadingEmails ? "animate-spin text-blue-600 dark:text-indigo-400" : ""} />
            </button>
          )}

          {/* Selected count info */}
          {selectedEmailIds.size > 0 && (
            <span className="text-[11px] text-blue-700 dark:text-indigo-300 font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-indigo-950/60 border border-blue-200 dark:border-indigo-500/30">
              {selectedEmailIds.size} selected
            </span>
          )}
        </div>

        {/* Right: Top Compact Pagination (Gmail Style) */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            {filteredEmails.length > 0 ? (
              <>
                <strong className="text-slate-800 dark:text-slate-200">{start}–{end}</strong> of{' '}
                <strong className="text-slate-800 dark:text-slate-200">{totalMessages.toLocaleString()}</strong>
                {activeFilters.unread_only && ' unread'}
              </>
            ) : (
              '0 messages'
            )}
          </span>

          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onPrevPage?.()}
              disabled={currentPage <= 1 || isLoadingEmails}
              className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => onNextPage?.()}
              disabled={!nextPageToken || isLoadingEmails}
              className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 4. Main Scrollable Email Row Area */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingEmails ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="animate-pulse flex items-center gap-4 px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/60">
                <div className="w-4 h-4 bg-slate-200 dark:bg-slate-800 rounded shrink-0" />
                <div className="w-4 h-4 bg-slate-200 dark:bg-slate-800 rounded shrink-0" />
                <div className="w-44 h-4 bg-slate-200 dark:bg-slate-800 rounded shrink-0" />
                <div className="flex-1 h-3.5 bg-slate-200 dark:bg-slate-800/60 rounded" />
                <div className="w-16 h-3 bg-slate-200 dark:bg-slate-800/40 rounded shrink-0" />
              </div>
            ))}
          </div>
        ) : filteredEmails.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-12 text-center select-none">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 flex items-center justify-center text-slate-400 mb-4 shadow-inner">
              {isSearchActive || hasFilters ? <MailSearch size={28} /> : <Inbox size={28} />}
            </div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1">
              {isSearchActive
                ? 'No emails found in Gmail matching your search'
                : hasFilters
                ? 'No emails match your filter criteria'
                : `No messages in ${currentView === 'inbox' ? activeCategory : currentView}`}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-4">
              {isSearchActive
                ? 'Try searching with different keywords, sender addresses, or check for typos.'
                : hasFilters
                ? 'Try adjusting your filter criteria, dates, or clearing active filters.'
                : 'New emails received in your connected Gmail will appear here automatically.'}
            </p>
            {isSearchActive ? (
              <button
                onClick={handleClear}
                className="px-3.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-indigo-600/20 dark:text-indigo-300 border border-blue-200 dark:border-indigo-500/30 text-xs font-semibold transition"
              >
                Back to Inbox
              </button>
            ) : hasFilters ? (
              <button
                onClick={resetFilters}
                className="px-3.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-indigo-600/20 dark:text-indigo-300 border border-blue-200 dark:border-indigo-500/30 text-xs font-semibold transition"
              >
                Clear all filters
              </button>
            ) : null}
          </div>
        ) : (
          <div>
            {filteredEmails.map((email) => (
              <EmailListItem 
                key={email.id} 
                email={email}
                isSelectedItem={selectedEmailIds.has(email.id)}
                onToggleSelect={handleToggleSelectOne}
              />
            ))}
          </div>
        )}
      </div>

      {/* 5. Bottom Reusable Pagination Bar */}
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
