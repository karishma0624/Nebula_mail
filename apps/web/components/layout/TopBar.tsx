'use client';

import React, { useState } from 'react';
import { Search, RefreshCw, Sparkles, Filter, CheckCircle2, AlertCircle } from 'lucide-react';
import { useMailStore } from '../../lib/store';

interface TopBarProps {
  onRefresh?: () => void;
  onSearch?: (query: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onRefresh, onSearch }) => {
  const { 
    currentView, 
    isAuthenticated,
    isAssistantOpen, 
    toggleAssistant,
    isLoadingEmails,
    isSearchActive,
    setSearchResults,
    clearSearch,
    setLoadingEmails
  } = useMailStore();

  const [keywordInput, setKeywordInput] = useState('');

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = keywordInput.trim();
    if (!query) {
      clearSearch();
      if (onRefresh) onRefresh();
      return;
    }

    if (onSearch) {
      onSearch(query);
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
    setLoadingEmails(true);
    try {
      const res = await fetch(`${apiUrl}/emails/list?q=${encodeURIComponent(query)}&limit=25`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(
          data.emails || [],
          query,
          data.result_size_estimate ?? data.count ?? (data.emails ? data.emails.length : 0),
          data.next_page_token || null
        );
      }
    } catch (err) {
      console.error('Failed to search Gmail from top bar:', err);
    } finally {
      setLoadingEmails(false);
    }
  };

  const handleClear = () => {
    setKeywordInput('');
    clearSearch();
    if (onRefresh) onRefresh();
  };

  const getTitle = () => {
    switch (currentView) {
      case 'inbox': return isSearchActive ? 'Search Results' : 'Inbox';
      case 'sent': return 'Sent Mail';
      case 'compose': return 'Compose';
      case 'detail': return 'Email Details';
      default: return 'Mail';
    }
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-nebula-900/80 backdrop-blur-md px-6 flex items-center justify-between gap-4 select-none">
      <div className="flex items-center gap-4 min-w-[200px]">
        <h2 className="text-lg font-semibold text-slate-100 tracking-tight">{getTitle()}</h2>
        
        {/* Auth status pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800/80 border border-slate-700/60">
          {isAuthenticated ? (
            <>
              <CheckCircle2 size={12} className="text-emerald-400" />
              <span className="text-slate-300">Live Gmail</span>
            </>
          ) : (
            <>
              <AlertCircle size={12} className="text-amber-400" />
              <span className="text-amber-300">Auth Required</span>
            </>
          )}
        </div>
      </div>

      {/* Global Gmail Search Bar */}
      <form onSubmit={handleSearchSubmit} className="flex-1 max-w-xl">
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="Search all Gmail by keyword, subject, or from:sender..."
            className="w-full bg-slate-800/60 border border-slate-700/80 rounded-xl pl-10 pr-12 py-2 text-sm text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition duration-150"
          />
          {(keywordInput || isSearchActive) && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200 bg-slate-700/60 hover:bg-slate-700 px-2 py-0.5 rounded-md transition"
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {/* Action buttons */}
      <div className="flex items-center gap-2.5">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoadingEmails || !isAuthenticated}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent hover:border-slate-700 transition disabled:opacity-40"
            title="Refresh inbox"
          >
            <RefreshCw size={17} className={isLoadingEmails ? 'animate-spin text-indigo-400' : ''} />
          </button>
        )}

        <button
          onClick={toggleAssistant}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
            isAssistantOpen
              ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40 shadow-sm shadow-indigo-500/20'
              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}
        >
          <Sparkles size={14} className="text-cyan-400" />
          <span>Copilot</span>
        </button>
      </div>
    </header>
  );
};
