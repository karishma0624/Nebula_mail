'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface PaginationBarProps {
  currentPage: number;
  pageSize?: number;
  totalCount?: number;
  currentCount: number;
  hasNextPage: boolean;
  isLoading?: boolean;
  isSearchActive?: boolean;
  isUnreadFilter?: boolean;
  searchEstimate?: number | null;
  onNextPage: () => void;
  onPrevPage: () => void;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({
  currentPage,
  pageSize = 25,
  totalCount = 0,
  currentCount,
  hasNextPage,
  isLoading = false,
  isSearchActive = false,
  isUnreadFilter = false,
  searchEstimate = null,
  onNextPage,
  onPrevPage,
}) => {
  const start = currentCount > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const end = currentCount > 0 ? (currentPage - 1) * pageSize + currentCount : 0;

  const renderCountLabel = () => {
    if (currentCount === 0) {
      return <span>0 messages</span>;
    }

    if (isSearchActive) {
      if (searchEstimate !== null && searchEstimate !== undefined) {
        return (
          <span>
            Showing <strong className="text-slate-200">{start}–{end}</strong> of ~
            <strong className="text-slate-200">{searchEstimate.toLocaleString()}</strong> results
          </span>
        );
      }
      return (
        <span>
          Showing <strong className="text-slate-200">{start}–{end}</strong> search results
        </span>
      );
    }

    if (isUnreadFilter) {
      return (
        <span>
          Showing <strong className="text-slate-200">{start}–{end}</strong> of{' '}
          <strong className="text-slate-200">{totalCount.toLocaleString()}</strong> unread messages
        </span>
      );
    }

    if (totalCount > 0) {
      return (
        <span>
          Showing <strong className="text-slate-900 dark:text-slate-200 font-bold">{start}–{end}</strong> of{' '}
          <strong className="text-slate-900 dark:text-slate-200 font-bold">{totalCount.toLocaleString()}</strong> messages
        </span>
      );
    }

    return (
      <span>
        Showing <strong className="text-slate-900 dark:text-slate-200 font-bold">{start}–{end}</strong> messages
      </span>
    );
  };

  return (
    <div className="h-12 border-t border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/80 backdrop-blur-md px-6 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 select-none shrink-0 transition-colors">
      {/* Count Range Text */}
      <div className="flex items-center gap-2">
        {renderCountLabel()}
        {isLoading && (
          <Loader2 size={13} className="animate-spin text-blue-600 dark:text-indigo-400 ml-1.5" />
        )}
      </div>

      {/* Page Navigation Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={onPrevPage}
          disabled={currentPage <= 1 || isLoading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 dark:border-slate-700/80 bg-white hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-200 font-medium transition shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
          title="Previous page"
        >
          <ChevronLeft size={14} />
          <span>Previous</span>
        </button>

        <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/40 text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
          Page {currentPage}
        </span>

        <button
          onClick={onNextPage}
          disabled={!hasNextPage || isLoading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 dark:border-slate-700/80 bg-white hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-200 font-medium transition shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
          title="Next page"
        >
          <span>Next</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};
