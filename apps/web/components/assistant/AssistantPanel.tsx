'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  Send, 
  X, 
  Layers, 
  Flame,
  Mic, 
  MicOff,
  SlidersHorizontal,
  SquarePen
} from 'lucide-react';

import { useMailStore } from '../../lib/store';
import { ChatMessage as ChatMessageType } from '../../lib/types';
import { ChatMessage } from './ChatMessage';
import { streamChatAssistant } from '../../lib/sse';
import { executeAssistantToolCall } from './ToolCallExecutor';
import { CopilotDrawer } from './CopilotDrawer';

const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';

export const AssistantPanel: React.FC = () => {
  const { 
    isAssistantOpen, 
    toggleAssistant, 
    currentView, 
    openEmail, 
    activeFilters,
    activeConversationId,
    setActiveConversationId,
    toggleCopilotDrawer,
    isSearchActive,
    searchQueryDescription,
    filteredEmails,
    emails
  } = useMailStore();


  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<ChatMessageType[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content: 'Hello! I am your Nebula Mail Copilot. Tell me what to do and I will control your mailbox UI directly.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // The 6 exact mandatory test prompts from prompt specification
  const quickTestPrompts = [
    "Send an email to john@example.com with subject 'Meeting Tomorrow' and body 'Let\'s meet at 3pm'",
    "Show me emails from the last 10 days",
    "Find the email from Sarah about the project update",
    "Open the latest email from David",
    "Reply to this",
    "Show only unread emails from this week"
  ];

  const handleToggleMic = () => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const preferredLang = typeof window !== 'undefined' ? (localStorage.getItem('nebula_preferred_language') || 'auto') : 'auto';
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = preferredLang !== 'auto' ? preferredLang : 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((res: any) => (res as any)[0].transcript)
        .join('');
      setInputMessage(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isStreaming) return;

    if (!textToSend) setInputMessage('');

    // User chat bubble
    const userMsg: ChatMessageType = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Assistant placeholder
    const assistantMsgId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessageType = {
      id: assistantMsgId,
      sender: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    let accumulatedText = '';
    const preferredLang = typeof window !== 'undefined' ? (localStorage.getItem('nebula_preferred_language') || 'auto') : 'auto';

    await streamChatAssistant({
      message: text,
      conversationId: activeConversationId || undefined,
      uiContext: {
        current_view: currentView,
        open_email: (currentView === 'detail' && openEmail)
          ? {
              id: openEmail.id,
              sender: openEmail.sender,
              subject: openEmail.subject,
              snippet: openEmail.snippet,
            }
          : null,
        active_filters: activeFilters,
        is_search_active: isSearchActive,
        search_query: searchQueryDescription,
        preferred_language: preferredLang !== 'auto' ? preferredLang : undefined,
        top_emails: (filteredEmails && filteredEmails.length > 0 ? filteredEmails : emails || []).slice(0, 6).map(e => ({
          id: e.id,
          sender: e.sender,
          subject: e.subject,
          snippet: e.snippet,
          date: e.date || e.received_at
        }))
      },

      onConversation: (data) => {
        if (data.conversation_id) setActiveConversationId(data.conversation_id);
      },
      onToolCall: async (toolCall) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId ? { ...msg, toolCall } : msg
          )
        );
        await executeAssistantToolCall(toolCall);
      },
      onCitations: (citations) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId ? { ...msg, citations } : msg
          )
        );
      },
      onMessageDelta: (delta: string) => {
        accumulatedText += delta;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, content: (msg.content || '') + delta }
              : msg
          )
        );
      },
      onError: (err: string) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content:
                    (msg.content ? msg.content + '\n' : '') +
                    `[Error: ${err}]`,
                  isStreaming: false,
                }
              : msg
          )
        );
      },
      onDone: () => {
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId ? { ...msg, isStreaming: false } : msg
          )
        );

        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          if (localStorage.getItem('nebula_voice_autoread') === 'true' && accumulatedText) {
            const cleanText = accumulatedText.replace(/\[\d+\]/g, '');
            const utter = new SpeechSynthesisUtterance(cleanText);
            if (preferredLang !== 'auto') utter.lang = preferredLang;
            window.speechSynthesis.speak(utter);
          }
        }
      },
    });
  };

  const handleEditMessage = async (messageId: string, newContent: string) => {
    if (isStreaming) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    // Truncate messages in local state: remove this message and anything after it
    const priorMessages = messages.slice(0, idx);
    setMessages(priorMessages);

    // Call backend endpoint to truncate and update message in Supabase
    if (activeConversationId) {
      try {
        await fetch(`${AGENT_API_URL}/conversations/${activeConversationId}/edit-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message_id: messageId,
            new_content: newContent,
          }),
        });
      } catch (e) {
        console.warn('Notice updating message on server:', e);
      }
    }

    // Re-run the conversation from the edited prompt
    handleSendMessage(newContent);
  };

  // Section 30: Explicit New Chat action in Copilot panel header
  const handleStartNewChat = () => {
    setActiveConversationId(null);
    setMessages([
      {
        id: 'welcome',
        sender: 'assistant',
        content: 'Hello! I am your Nebula Mail Copilot. Tell me what to do and I will control your mailbox UI directly.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setInputMessage('');
  };

  const contextualSuggestions = [
    "Show me my unread emails",
    "is AWS invoice available",
    "Which Supabase project is paused?",
    "mails from supabase"
  ];

  if (!isAssistantOpen) return null;

  return (
    <aside className="w-84 md:w-96 h-screen bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-2xl z-20 select-none transition-colors">
      {/* Header */}
      <div className="p-4 px-5 border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/90 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <Sparkles size={16} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Mail Copilot</h3>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">UI Automation Active</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleStartNewChat}
            className="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-indigo-400 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Start New Chat"
            aria-label="New chat"
          >
            <SquarePen size={15} />
          </button>
          <button
            onClick={toggleCopilotDrawer}
            className="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-indigo-400 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Copilot Menu & Tools (History, Prompts, Settings)"
          >
            <SlidersHorizontal size={15} />
          </button>
          <button
            onClick={toggleAssistant}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title="Close Panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>


      {/* Live Context Chip Bar */}
      <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <Layers size={12} className="text-blue-600 dark:text-indigo-400" />
          <span>View: <strong className="text-slate-800 dark:text-slate-200 uppercase font-semibold">{isSearchActive ? 'SEARCH RESULTS' : currentView}</strong></span>
        </div>
        {currentView === 'detail' && openEmail && (
          <span className="truncate max-w-[160px] text-slate-700 dark:text-slate-300 font-medium">
            Email: {openEmail.sender.split('<')[0]}
          </span>
        )}
      </div>


      {/* Chat Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-2.5">
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} onEdit={handleEditMessage} />
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-indigo-400 p-2">
            <div className="w-2 h-2 rounded-full bg-blue-600 dark:bg-indigo-500 animate-ping" />
            <span className="font-medium">Reasoning & reading emails...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Contextual Suggestions Chips (Image 2 style) */}
      <div className="px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-slate-200/80 dark:border-slate-800/60 bg-slate-50/80 dark:bg-slate-950/50">
        {contextualSuggestions.map((s, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(s)}
            disabled={isStreaming}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[11px] font-medium whitespace-nowrap transition shadow-xs disabled:opacity-50"
          >
            <span className="text-slate-400">↳</span>
            <span>{s}</span>
          </button>
        ))}
      </div>

      {/* Quick Test Prompt Chips */}
      <div className="p-2.5 border-t border-slate-200 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-950/30">
        <div className="flex items-center gap-1 mb-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          <Flame size={11} className="text-amber-500" />
          <span>Evaluator Test Prompts</span>
        </div>
        <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
          {quickTestPrompts.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(prompt)}
              disabled={isStreaming}
              className="text-[10.5px] bg-white dark:bg-slate-800/80 hover:bg-blue-50 dark:hover:bg-indigo-600/30 text-slate-700 dark:text-slate-300 hover:text-blue-700 dark:hover:text-indigo-200 border border-slate-200 dark:border-slate-700/80 hover:border-blue-300 dark:hover:border-indigo-500/40 rounded-lg px-2 py-0.5 text-left truncate max-w-full transition disabled:opacity-40 shadow-xs"
              title={prompt}
            >
              &quot;{prompt.slice(0, 30)}...&quot;
            </button>
          ))}
        </div>
      </div>

      {/* Chat Input */}
      <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={handleToggleMic}
            disabled={isStreaming}
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition ${
              isListening
                ? 'bg-rose-600 text-white animate-pulse shadow-md shadow-rose-600/40'
                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
            }`}
            title={isListening ? "Listening... click to stop" : "Voice dictation (Web Speech API)"}
          >
            {isListening ? <MicOff size={15} /> : <Mic size={15} />}
          </button>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={isStreaming}
            placeholder={isListening ? "Listening to your voice..." : "Ask Copilot to draft, search, or navigate..."}
            className="flex-1 bg-[#edf2fa] dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-full px-4 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 dark:focus:border-indigo-500 focus:ring-1 focus:ring-blue-500/30 transition disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isStreaming || !inputMessage.trim()}
            className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shrink-0 transition disabled:opacity-40 shadow-sm"
          >
            <Send size={14} />
          </button>
        </form>
      </div>

      {/* Slide-over Copilot Drawer */}
      <CopilotDrawer
        onSelectConversation={(_id, loadedMessages) => {
          setMessages(loadedMessages);
        }}
        onSendPrompt={(prompt) => {
          handleSendMessage(prompt);
        }}
      />
    </aside>
  );
};
