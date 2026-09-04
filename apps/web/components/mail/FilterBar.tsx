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
    <div className="px-6 py-2.5 bg-nebula-900/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1.5 text-slate-400 font-medium">
          <Filter size={13} className="text-indigo-400" />
          <span>Filters:</span>
        </div>

        {/* Sender filter input */}
        <div className="relative flex items-center">
          <User size={13} className="absolute left-2.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="From: sender..."
            value={activeFilters.sender || ''}
            onChange={(e) => setFilters({ sender: e.target.value || undefined })}
            className="bg-slate-800/70 border border-slate-700/80 rounded-lg pl-7 pr-2.5 py-1 text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition w-36"
          />
        </div>

        {/* Date From */}
        <div className="relative flex items-center">
          <Calendar size={13} className="absolute left-2.5 text-slate-500 pointer-events-none" />
          <input
            type="date"
            value={activeFilters.date_from || ''}
            onChange={(e) => setFilters({ date_from: e.target.value || undefined })}
            title="Received after"
            className="bg-slate-800/70 border border-slate-700/80 rounded-lg pl-7 pr-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500 transition text-[11px]"
          />
        </div>

        {/* Date To */}
        <div className="relative flex items-center">
          <Calendar size={13} className="absolute left-2.5 text-slate-500 pointer-events-none" />
          <input
            type="date"
            value={activeFilters.date_to || ''}
            onChange={(e) => setFilters({ date_to: e.target.value || undefined })}
            title="Received before"
            className="bg-slate-800/70 border border-slate-700/80 rounded-lg pl-7 pr-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500 transition text-[11px]"
          />
        </div>

        {/* Unread Only Toggle */}
        <button
          onClick={() => setFilters({ unread_only: !activeFilters.unread_only })}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium border transition ${
            activeFilters.unread_only
              ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
              : 'bg-slate-800/60 border-slate-700/80 text-slate-400 hover:text-slate-200'
          }`}
        >
          <EyeOff size={13} className={activeFilters.unread_only ? 'text-indigo-400' : 'text-slate-500'} />
          <span>Unread Only</span>
        </button>
      </div>

      {/* Reset filters button */}
      {hasActiveFilters && (
        <button
          onClick={resetFilters}
          className="flex items-center gap-1 text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1 rounded-lg transition"
        >
          <X size={12} />
          <span>Reset Filters</span>
        </button>
      )}
    </div>
  );
};
