'use client';

import React from 'react';
import { 
  Inbox, 
  Send, 
  PenSquare, 
  Sparkles, 
  ShieldCheck, 
  LogOut,
  Mail
} from 'lucide-react';
import { useMailStore } from '../../lib/store';
import { ViewType } from '../../lib/types';

export const Sidebar: React.FC = () => {
  const { 
    currentView, 
    setView, 
    emails, 
    isAuthenticated, 
    userEmail, 
    setAuthenticated,
    isAssistantOpen,
    toggleAssistant,
    unreadMessages,
    sentTotal
  } = useMailStore();

  const unreadCount = unreadMessages > 0 ? unreadMessages : emails.filter(e => e.folder === 'inbox' && e.is_unread).length;
  const sentCount = sentTotal > 0 ? sentTotal : emails.filter(e => e.folder === 'sent').length;

  const navItems: { id: ViewType; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'inbox', label: 'Inbox', icon: <Inbox size={18} />, badge: unreadCount },
    { id: 'sent', label: 'Sent', icon: <Send size={18} />, badge: sentCount },
    { id: 'compose', label: 'Compose', icon: <PenSquare size={18} /> },
  ];

  return (
    <aside className="w-64 h-screen bg-nebula-900 border-r border-slate-800 flex flex-col justify-between select-none">
      {/* App Branding */}
      <div>
        <div className="p-6 flex items-center justify-between border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Mail className="text-white" size={20} />
            </div>
            <div>
              <h1 className="font-semibold text-white tracking-wide text-base">Nebula Mail</h1>
              <span className="text-[11px] text-indigo-400 font-medium tracking-wider uppercase">AI Mail Copilot</span>
            </div>
          </div>
        </div>

        {/* Primary Action Button */}
        <div className="p-4">
          <button
            onClick={() => setView('compose')}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-medium py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-600/25 transition duration-150 ease-in-out"
          >
            <PenSquare size={17} />
            <span>New Message</span>
          </button>
        </div>

        {/* Navigation links */}
        <nav className="px-3 space-y-1 mt-1">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={isActive ? 'text-indigo-400' : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      isActive
                        ? 'bg-indigo-500 text-white'
                        : 'bg-slate-800 text-slate-300'
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
      <div className="p-4 border-t border-slate-800/80 space-y-3">
        {/* Assistant Toggle Button */}
        <button
          onClick={toggleAssistant}
          className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors ${
            isAssistantOpen 
              ? 'bg-indigo-950/40 border-indigo-500/40 text-indigo-300' 
              : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-cyan-400 animate-pulse" />
            <span>AI Copilot Panel</span>
          </div>
          <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">
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
            }
          }}
          className={`flex items-center justify-between pt-1 ${!isAuthenticated ? 'cursor-pointer hover:bg-slate-800/80 p-2 rounded-xl transition border border-transparent hover:border-slate-700/60' : ''}`}
        >
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-300 shrink-0">
              {userEmail ? userEmail.charAt(0).toUpperCase() : '?'}
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-slate-200 truncate">
                {userEmail || 'Not Connected'}
              </p>
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isAuthenticated ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                <span className="text-[10px] text-slate-400">
                  {isAuthenticated ? 'Gmail Linked' : 'Click to Connect'}
                </span>
              </div>
            </div>
          </div>
          {isAuthenticated && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAuthenticated(false, '');
              }}
              title="Disconnect"
              className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-800 transition"
            >
              <LogOut size={15} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
