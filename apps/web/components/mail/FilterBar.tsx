'use client';

import React from 'react';
import { Filter, X, Calendar, User, EyeOff } from 'lucide-react';
import { useMailStore } from '../../lib/store';

export const FilterBar: React.FC = () => {
  const { activeFilters, setFilters, resetFilters } = useMailStore();

  const hasActiveFilters = Object.values(activeFilters).some(
    (v) => v !== undefined && v !== '' && v !== false
  );

  return (
    <div className="px-5 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs transition-colors">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-medium">
          <Filter size={13} className="text-blue-600 dark:text-indigo-400" />
          <span>Filters:</span>
        </div>

        {/* Sender filter input */}
        <div className="relative flex items-center">
          <User size={13} className="absolute left-2.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="From: sender..."
            value={activeFilters.sender || ''}
            onChange={(e) => setFilters({ sender: e.target.value || undefined })}
            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg pl-7 pr-2.5 py-1 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-blue-500 dark:focus:border-indigo-500 focus:ring-1 focus:ring-blue-500/30 transition w-36 shadow-sm"
          />
        </div>

        {/* Date From */}
        <div className="relative flex items-center">
          <Calendar size={13} className="absolute left-2.5 text-slate-400 pointer-events-none" />
          <input
            type="date"
            value={activeFilters.date_from || ''}
            onChange={(e) => setFilters({ date_from: e.target.value || undefined })}
            title="Received after"
            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg pl-7 pr-2 py-1 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 dark:focus:border-indigo-500 transition text-[11px] shadow-sm"
          />
        </div>

        {/* Date To */}
        <div className="relative flex items-center">
          <Calendar size={13} className="absolute left-2.5 text-slate-400 pointer-events-none" />
          <input
            type="date"
            value={activeFilters.date_to || ''}
            onChange={(e) => setFilters({ date_to: e.target.value || undefined })}
            title="Received before"
            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg pl-7 pr-2 py-1 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 dark:focus:border-indigo-500 transition text-[11px] shadow-sm"
          />
        </div>

        {/* Unread Only Toggle */}
        <button
          onClick={() => setFilters({ unread_only: !activeFilters.unread_only })}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium border transition shadow-sm ${
            activeFilters.unread_only
              ? 'bg-blue-50 dark:bg-indigo-500/20 border-blue-300 dark:border-indigo-500/40 text-blue-700 dark:text-indigo-300 font-semibold'
              : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <EyeOff size={13} className={activeFilters.unread_only ? 'text-blue-600 dark:text-indigo-400' : 'text-slate-400'} />
          <span>Unread Only</span>
        </button>
      </div>

      {/* Reset filters button */}
      {hasActiveFilters && (
        <button
          onClick={resetFilters}
          className="flex items-center gap-1 text-rose-600 dark:text-rose-400 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 border border-rose-200 dark:border-rose-500/30 px-2.5 py-1 rounded-lg font-medium transition"
        >
          <X size={12} />
          <span>Reset Filters</span>
        </button>
      )}
    </div>
  );
};
