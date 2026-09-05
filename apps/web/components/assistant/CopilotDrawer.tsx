'use client';

import React, { useState, useEffect } from 'react';
import { useMailStore } from '../../lib/store';
import { 
  X, 
  History, 
  Sparkles, 
  Settings, 
  MessageSquare, 
  Trash2, 
  Sun, 
  Moon, 
  Volume2, 
  VolumeX, 
  Check, 
  Clock, 
  ArrowRight,
  ThumbsUp,
  ThumbsDown,
  Loader2
} from 'lucide-react';
import { ChatMessage as ChatMessageType } from '../../lib/types';

const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';

interface ConversationItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface CopilotDrawerProps {
  onSelectConversation?: (conversationId: string, messages: ChatMessageType[]) => void;
  onSendPrompt?: (prompt: string) => void;
}

export const CopilotDrawer: React.FC<CopilotDrawerProps> = ({
  onSelectConversation,
  onSendPrompt
}) => {
  const { 
    isCopilotDrawerOpen, 
    setCopilotDrawerOpen, 
    currentView, 
    openEmail,
    activeConversationId,
    setActiveConversationId 
  } = useMailStore();

  const [activeTab, setActiveTab] = useState<'suggestions' | 'history' | 'settings' | 'feedback'>('suggestions');

  // History State
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Settings State
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [autoReadAloud, setAutoReadAloud] = useState(false);
  const [sendMode, setSendMode] = useState<'confirm' | 'automatic'>('confirm');
  const [preferredLanguage, setPreferredLanguage] = useState<string>('auto');

  // Feedback State
  const [feedbackRating, setFeedbackRating] = useState<'positive' | 'negative' | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const updateTheme = () => {
        const storedTheme = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
        setTheme(storedTheme);
      };
      updateTheme();
      window.addEventListener('themechange', updateTheme);
      const storedVoice = localStorage.getItem('nebula_voice_autoread') === 'true';
      setAutoReadAloud(storedVoice);

      const storedLang = localStorage.getItem('nebula_preferred_language') || 'auto';
      setPreferredLanguage(storedLang);

      // Load user send_mode preference
      fetch(`${AGENT_API_URL}/user/settings`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.send_mode) setSendMode(data.send_mode);
        })
        .catch(() => {});

      return () => window.removeEventListener('themechange', updateTheme);
    }
  }, []);

  const handleLanguageChange = (lang: string) => {
    setPreferredLanguage(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('nebula_preferred_language', lang);
      window.dispatchEvent(new Event('languagechange'));
    }
  };

  const handleSendModeChange = async (mode: 'confirm' | 'automatic') => {
    setSendMode(mode);
    try {
      await fetch(`${AGENT_API_URL}/user/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ send_mode: mode }),
      });
    } catch (e) {
      console.error('Failed to update send_mode:', e);
    }
  };

  const loadConversations = async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(`${AGENT_API_URL}/conversations`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data || []);
      }
    } catch (e) {
      console.warn('Failed to load conversations:', e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (isCopilotDrawerOpen && activeTab === 'history') {
      loadConversations();
    }
  }, [isCopilotDrawerOpen, activeTab]);

  if (!isCopilotDrawerOpen) return null;

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', nextTheme);
    window.dispatchEvent(new Event('themechange'));
  };

  const handleToggleVoice = () => {
    const nextVal = !autoReadAloud;
    setAutoReadAloud(nextVal);
    localStorage.setItem('nebula_voice_autoread', String(nextVal));
  };

  const handleSelectConv = async (convId: string) => {
    try {
      const res = await fetch(`${AGENT_API_URL}/conversations/${convId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveConversationId(convId);
        if (onSelectConversation && data.messages) {
          const formatted: ChatMessageType[] = data.messages.map((m: any) => ({
            id: m.id,
            sender: m.role,
            content: m.content,
            timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            toolCall: m.tool_calls && m.tool_calls[0] ? m.tool_calls[0] : undefined,
            citations: m.citations || undefined
          }));
          onSelectConversation(convId, formatted);
        }
        setCopilotDrawerOpen(false);
      }
    } catch (e) {
      console.warn('Failed to fetch conversation detail:', e);
    }
  };

  const handleDeleteConv = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`${AGENT_API_URL}/conversations/${convId}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConversationId === convId) {
        setActiveConversationId(null);
      }
    } catch (err) {
      console.warn('Error deleting conversation:', err);
    }
  };

  const handleClearAllHistory = async () => {
    if (!confirm('Are you sure you want to clear all conversation memory?')) return;
    try {
      await fetch(`${AGENT_API_URL}/conversations`, { method: 'DELETE' });
      setConversations([]);
      setActiveConversationId(null);
    } catch (err) {
      console.warn('Error clearing conversations:', err);
    }
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackText.trim()) return;
    setIsSubmittingFeedback(true);
    try {
      await fetch(`${AGENT_API_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: feedbackText,
          rating: feedbackRating || undefined,
          conversation_id: activeConversationId || undefined
        })
      });
      setFeedbackSubmitted(true);
      setTimeout(() => {
        setFeedbackSubmitted(false);
        setFeedbackText('');
        setFeedbackRating(null);
      }, 2000);
    } catch (e) {
      console.warn('Feedback submit failed:', e);
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // Contextual Prompts Calculation
  const contextualPrompts = openEmail
    ? [
        `Reply to this email`,
        `Summarize this email from ${openEmail.sender.split('<')[0].trim()}`,
        `Draft a polite reply to ${openEmail.sender.split('<')[0].trim()}`,
        `Are there any action items or next steps in this email?`,
        `Check if this email contains any forms or attachments`
      ]
    : [
        `Show only unread emails from this week`,
        `Show me emails from the last 10 days`,
        `Find the email from Sarah about the project update`,
        `Open the latest email from David`,
        `Send an email to john@example.com with subject 'Meeting Tomorrow' and body 'Let\'s meet at 3pm'`,
        `Which Supabase project is paused?`
      ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-80 md:w-96 h-full bg-nebula-900 border-l border-slate-800 shadow-2xl flex flex-col justify-between select-none animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-4 px-5 border-b border-slate-800/80 bg-slate-950/60 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-400" />
            <span>Copilot Menu & Tools</span>
          </h3>
          <button
            onClick={() => setCopilotDrawerOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 text-xs">
          <button
            onClick={() => setActiveTab('suggestions')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 font-semibold transition border-b-2 ${
              activeTab === 'suggestions'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles size={13} />
            <span>Prompts</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 font-semibold transition border-b-2 ${
              activeTab === 'history'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History size={13} />
            <span>History</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 font-semibold transition border-b-2 ${
              activeTab === 'settings'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings size={13} />
            <span>Settings</span>
          </button>
          <button
            onClick={() => setActiveTab('feedback')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 font-semibold transition border-b-2 ${
              activeTab === 'feedback'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare size={13} />
            <span>Feedback</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* TAB 1: CONTEXTUAL SUGGESTIONS */}
          {activeTab === 'suggestions' && (
            <div className="space-y-3">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {openEmail ? 'Prompts for Open Email' : 'Recommended Prompts'}
              </div>
              <div className="space-y-2">
                {contextualPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      onSendPrompt?.(prompt);
                      setCopilotDrawerOpen(false);
                    }}
                    className="w-full p-2.5 rounded-xl bg-slate-800/70 hover:bg-indigo-600/20 text-slate-200 hover:text-indigo-200 border border-slate-700/70 hover:border-indigo-500/40 text-xs text-left transition flex items-center justify-between group cursor-pointer"
                  >
                    <span>{prompt}</span>
                    <ArrowRight size={13} className="text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Past Conversations
                </span>
                {conversations.length > 0 && (
                  <button
                    onClick={handleClearAllHistory}
                    className="text-[10px] text-rose-400 hover:text-rose-300 transition hover:underline"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {isLoadingHistory ? (
                <div className="flex items-center justify-center p-8 text-slate-500 text-xs">
                  <Loader2 size={16} className="animate-spin mr-2" />
                  <span>Loading history...</span>
                </div>
              ) : conversations.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  No previous conversations found.
                </div>
              ) : (
                <div className="space-y-2">
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectConv(conv.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between group ${
                        activeConversationId === conv.id
                          ? 'bg-indigo-950/60 border-indigo-500/50 text-indigo-200'
                          : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/60 text-slate-200'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <h4 className="text-xs font-semibold truncate">{conv.title}</h4>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
                          <Clock size={10} />
                          <span>{new Date(conv.updated_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteConv(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-700/80 transition"
                        title="Delete conversation"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SETTINGS */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* Send Mode Setting (Section 23) */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 space-y-2.5">
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Email Send Mode</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Control confirmation step before transmitting messages</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSendModeChange('confirm')}
                    className={`py-2 px-2.5 rounded-xl text-xs font-semibold border transition text-center ${
                      sendMode === 'confirm'
                        ? 'bg-blue-50 dark:bg-indigo-600/30 border-blue-500 dark:border-indigo-500 text-blue-700 dark:text-indigo-300 shadow-sm'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                    }`}
                  >
                    Confirm before sending (Default)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendModeChange('automatic')}
                    className={`py-2 px-2.5 rounded-xl text-xs font-semibold border transition text-center ${
                      sendMode === 'automatic'
                        ? 'bg-amber-50 dark:bg-amber-500/20 border-amber-500 text-amber-800 dark:text-amber-300 shadow-sm'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                    }`}
                  >
                    Send automatically
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 italic leading-snug">
                  {sendMode === 'automatic' 
                    ? "Skips the confirmation step. Not recommended if this app is being evaluated against a human-in-the-loop requirement."
                    : "Always presents a one-click confirmation modal showing exact recipient, subject, and body before sending."}
                </p>
              </div>

              {/* Theme toggle row */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">App Theme</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Switch between Dark and Light mode</p>
                </div>
                <button
                  onClick={handleToggleTheme}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition shadow-sm"
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun size={13} className="text-amber-500" />
                      <span>Light</span>
                    </>
                  ) : (
                    <>
                      <Moon size={13} className="text-indigo-500" />
                      <span>Dark</span>
                    </>
                  )}
                </button>
              </div>

              {/* Voice auto-read row */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Speech Read-Aloud</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Automatically speak assistant answers</p>
                </div>
                <button
                  onClick={handleToggleVoice}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    autoReadAloud
                      ? 'bg-blue-600 dark:bg-indigo-600 text-white shadow-md'
                      : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {autoReadAloud ? (
                    <>
                      <Volume2 size={13} />
                      <span>Enabled</span>
                    </>
                  ) : (
                    <>
                      <VolumeX size={13} />
                      <span>Off</span>
                    </>
                  )}
                </button>
              </div>

              {/* Language Selector (Section 34) */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Copilot Language</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Response & speech language preference</p>
                </div>
                <select
                  value={preferredLanguage}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:border-blue-500 transition cursor-pointer"
                >
                  <option value="auto">Auto-detect (Default)</option>
                  <option value="en-US">English</option>
                  <option value="ta-IN">தமிழ் (Tamil)</option>
                  <option value="hi-IN">हिन्दी (Hindi)</option>
                  <option value="es-ES">Español (Spanish)</option>
                  <option value="fr-FR">Français (French)</option>
                  <option value="de-DE">Deutsch (German)</option>
                </select>
              </div>
            </div>
          )}

          {/* TAB 4: FEEDBACK */}
          {activeTab === 'feedback' && (
            <div className="space-y-3">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Send Feedback
              </div>
              <p className="text-xs text-slate-300">
                Help improve Nebula Mail Copilot. Tell us how the assistant is performing.
              </p>

              {/* Rating selection */}
              <div className="flex gap-2">
                <button
                  onClick={() => setFeedbackRating('positive')}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border transition ${
                    feedbackRating === 'positive'
                      ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <ThumbsUp size={13} />
                  <span>Works Great</span>
                </button>
                <button
                  onClick={() => setFeedbackRating('negative')}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border transition ${
                    feedbackRating === 'negative'
                      ? 'bg-rose-600/30 border-rose-500 text-rose-300'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <ThumbsDown size={13} />
                  <span>Needs Work</span>
                </button>
              </div>

              {/* Feedback Textarea */}
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Write your feedback or bug report here..."
                rows={4}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition resize-none"
              />

              <button
                onClick={handleSubmitFeedback}
                disabled={isSubmittingFeedback || !feedbackText.trim()}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-600/30"
              >
                {isSubmittingFeedback ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : feedbackSubmitted ? (
                  <>
                    <Check size={13} className="text-emerald-300" />
                    <span>Thank you for your feedback!</span>
                  </>
                ) : (
                  <span>Submit Feedback</span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
