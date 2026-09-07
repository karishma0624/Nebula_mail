'use client';

import React from 'react';
import { 
  Inbox, 
  Send, 
  PenSquare, 
  Sparkles, 
  LogOut,
  Mail
} from 'lucide-react';
import { useMailStore } from '../../lib/store';
import { ViewType } from '../../lib/types';

export const Sidebar: React.FC = () => {
  const { 
    currentView, 
    setView, 
    isAuthenticated, 
    userEmail, 
    openLogoutModal,
    isAssistantOpen,
    toggleAssistant,
    unreadMessages,
    sentTotal
  } = useMailStore();

  const unreadCount = unreadMessages;
  const sentCount = sentTotal;

  const navItems: { id: ViewType; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'inbox', label: 'Inbox', icon: <Inbox size={18} />, badge: unreadCount },
    { id: 'sent', label: 'Sent', icon: <Send size={18} />, badge: sentCount },
    { id: 'compose', label: 'Compose', icon: <PenSquare size={18} /> },
  ];

  return (
    <aside className="w-64 h-screen bg-[#f6f8fc] dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between select-none transition-colors">
      {/* App Branding */}
      <div>
        <div className="p-6 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/25">
              <Mail className="text-white" size={20} />
            </div>
            <div>
              <h1 className="font-semibold text-slate-900 dark:text-white tracking-wide text-base">Nebula Mail</h1>
              <span className="text-[11px] text-blue-600 dark:text-indigo-400 font-semibold tracking-wider uppercase">AI Mail Copilot</span>
            </div>
          </div>
        </div>

        {/* Primary Action Button - Gmail style compose pill */}
        <div className="p-4">
          <button
            onClick={() => setView('compose')}
            className="w-full flex items-center justify-center gap-2.5 bg-[#c2e7ff] hover:bg-[#b3dcf5] text-[#001d35] dark:bg-indigo-600 dark:hover:bg-indigo-500 dark:text-white font-semibold py-3 px-5 rounded-2xl shadow-sm hover:shadow transition duration-150 ease-in-out text-sm"
          >
            <PenSquare size={18} />
            <span>New Message</span>
          </button>
        </div>

        {/* Navigation links - Gmail rounded pill */}
        <nav className="px-3 space-y-1 mt-1">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-full text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#d3e3fd] text-[#041e49] dark:bg-indigo-600/20 dark:text-indigo-300 font-bold'
                    : 'text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-[#e8eef6] dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <span className={isActive ? 'text-[#041e49] dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                      isActive
                        ? 'bg-[#041e49] text-white dark:bg-indigo-500 dark:text-white'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer / Account & Copilot info */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 space-y-3">
        {/* Assistant Toggle Button */}
        <button
          onClick={toggleAssistant}
          className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors ${
            isAssistantOpen 
              ? 'bg-blue-50 dark:bg-indigo-950/40 border-blue-300 dark:border-indigo-500/40 text-blue-700 dark:text-indigo-300 font-semibold' 
              : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-blue-600 dark:text-cyan-400 animate-pulse" />
            <span>AI Copilot Panel</span>
          </div>
          <span className="text-[10px] bg-blue-100 dark:bg-indigo-500/20 text-blue-700 dark:text-indigo-300 px-1.5 py-0.5 rounded font-semibold">
            {isAssistantOpen ? 'Open' : 'Minimized'}
          </span>
        </button>

        {/* User profile / Auth status */}
        <div 
          onClick={async () => {
            if (!isAuthenticated) {
              try {
                const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
                const res = await fetch(`${apiUrl}/auth/login-url`);
                const data = await res.json();
                if (data.url) window.location.href = data.url;
              } catch (e) {
                console.error(e);
              }
            } else {
              openLogoutModal();
            }
          }}
          className={`flex items-center justify-between pt-1 p-2 rounded-xl transition border border-transparent ${
            !isAuthenticated 
              ? 'cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700/60' 
              : 'cursor-pointer hover:bg-slate-200/40 dark:hover:bg-slate-800/50 hover:border-slate-200/60 dark:hover:border-slate-700/40'
          }`}
          title={isAuthenticated ? 'Click to manage account / log out' : 'Click to connect Gmail'}
        >
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 border border-blue-200 dark:border-slate-700 flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-xs">
              {userEmail ? userEmail.charAt(0).toUpperCase() : '?'}
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate" title={userEmail || undefined}>
                {userEmail || 'Not Connected'}
              </p>
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isAuthenticated ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  {isAuthenticated ? 'Gmail Linked' : 'Click to Connect'}
                </span>
              </div>
            </div>
          </div>
          {isAuthenticated && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openLogoutModal();
              }}
              title="Log out of Nebula Mail"
              aria-label="Log out"
              className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition flex items-center gap-1 group shrink-0"
            >
              <LogOut size={15} className="group-hover:scale-110 transition-transform" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
