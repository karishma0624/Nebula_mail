'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, RefreshCw, Sparkles, Filter, CheckCircle2, AlertCircle, Sun, Moon, LogOut, LogIn, ChevronDown } from 'lucide-react';
import { useMailStore } from '../../lib/store';

interface TopBarProps {
  onRefresh?: () => void;
  onSearch?: (query: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onRefresh, onSearch }) => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const updateTheme = () => {
      const active = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
      setTheme(active);
    };
    updateTheme();
    window.addEventListener('themechange', updateTheme);
    return () => window.removeEventListener('themechange', updateTheme);
  }, []);

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', nextTheme);
    setTheme(nextTheme);
    window.dispatchEvent(new Event('themechange'));
  };

  const handleConnectGmail = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/auth/login-url`);
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Failed to initiate login flow:', err);
    }
  };

  const { 
    currentView, 
    isAuthenticated,
    userEmail,
    openLogoutModal,
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
    <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 backdrop-blur-md px-6 flex items-center justify-between gap-4 select-none transition-colors">
      <div className="flex items-center gap-4 min-w-[200px]">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">{getTitle()}</h2>
        
        {/* Auth status pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60">
          {isAuthenticated ? (
            <>
              <CheckCircle2 size={12} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-slate-700 dark:text-slate-300 font-medium">Live Gmail</span>
            </>
          ) : (
            <>
              <AlertCircle size={12} className="text-amber-500 dark:text-amber-400" />
              <span className="text-amber-700 dark:text-amber-300">Auth Required</span>
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
            placeholder="Search mail by keyword, subject, or sender..."
            className="w-full bg-[#edf2fa] dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 rounded-full pl-10 pr-12 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 dark:focus:border-indigo-500 focus:ring-1 focus:ring-blue-500/40 transition duration-150"
          />
          {(keywordInput || isSearchActive) && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 px-2 py-0.5 rounded-full transition"
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {/* Sun/Moon Theme Toggle */}
        <button
          onClick={handleToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 transition"
        >
          {theme === 'dark' ? (
            <Sun size={17} className="text-amber-400 hover:rotate-45 transition-transform duration-200" />
          ) : (
            <Moon size={17} className="text-indigo-600 hover:-rotate-12 transition-transform duration-200" />
          )}
        </button>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoadingEmails || !isAuthenticated}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 transition disabled:opacity-40"
            title="Refresh inbox"
          >
            <RefreshCw size={17} className={isLoadingEmails ? 'animate-spin text-blue-600 dark:text-indigo-400' : ''} />
          </button>
        )}

        <button
          onClick={toggleAssistant}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition shadow-sm ${
            isAssistantOpen
              ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-indigo-600/20 dark:text-indigo-300 dark:border-indigo-500/40'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/80'
          }`}
        >
          <Sparkles size={14} className="text-blue-600 dark:text-cyan-400" />
          <span>Copilot</span>
        </button>

        {/* User Account / Profile Menu with Log Out */}
        <div className="relative ml-1" ref={userMenuRef}>
          {isAuthenticated ? (
            <>
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                title={userEmail ? `Account: ${userEmail}` : 'Account options'}
                aria-label="Account menu"
                aria-expanded={isUserMenuOpen}
                className="flex items-center gap-1.5 p-1 pl-1 pr-2 rounded-full border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700/80 transition shadow-xs"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center text-white font-bold text-xs shadow-xs select-none">
                  {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
                </div>
                <ChevronDown size={13} className={`text-slate-500 transition-transform duration-150 ${isUserMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Account Dropdown */}
              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-150 select-none">
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0">
                      {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate" title={userEmail || undefined}>
                        {userEmail || 'Google Account'}
                      </p>
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                        Gmail Connected
                      </p>
                    </div>
                  </div>

                  <div className="p-1.5">
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        openLogoutModal();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition group"
                    >
                      <LogOut size={15} className="group-hover:-translate-x-0.5 transition-transform" />
                      <span className="font-semibold">Log out</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <button
              onClick={handleConnectGmail}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition"
            >
              <LogIn size={13} />
              <span>Sign in</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
