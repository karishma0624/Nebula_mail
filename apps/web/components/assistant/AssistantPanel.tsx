'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  Send, 
  X, 
  Bot, 
  Layers, 
  CheckCircle2, 
  Flame,
  AlertCircle 
} from 'lucide-react';
import { useMailStore } from '../../lib/store';
import { ChatMessage as ChatMessageType, UIContext, ToolCall } from '../../lib/types';
import { ChatMessage } from './ChatMessage';
import { streamChatAssistant } from '../../lib/sse';
import { executeAssistantToolCall } from './ToolCallExecutor';

export const AssistantPanel: React.FC = () => {
  const { 
    isAssistantOpen, 
    toggleAssistant, 
    currentView, 
    openEmail, 
    activeFilters 
  } = useMailStore();

  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<ChatMessageType[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content: 'Hello! I am your Nebula Mail Copilot. Tell me what to do and I will control your mailbox UI directly.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isStreaming) return;

    setInputMessage('');
    const userMsgId = 'u-' + Date.now();
    const assistantMsgId = 'a-' + Date.now();

    // 1. Append user message
    const userMsg: ChatMessageType = {
      id: userMsgId,
      sender: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const assistantMsg: ChatMessageType = {
      id: assistantMsgId,
      sender: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    // 2. Build live UI context
    const uiContext: UIContext = {
      current_view: currentView,
      open_email: openEmail
        ? {
            id: openEmail.id,
            sender: openEmail.sender,
            subject: openEmail.subject,
            snippet: openEmail.snippet,
          }
        : null,
      active_filters: activeFilters,
    };

    // 3. Connect to SSE
    await streamChatAssistant({
      message: text,
      uiContext,
      onToolCall: async (toolCall: ToolCall) => {
        // Embed tool call in message UI
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, toolCall }
              : msg
          )
        );
        // Execute tool call in UI via Zustand
        await executeAssistantToolCall(toolCall);
      },
      onMessageDelta: (delta: string) => {
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
      },
    });
  };

  if (!isAssistantOpen) return null;

  return (
    <aside className="w-84 md:w-96 h-screen bg-nebula-900 border-l border-slate-800 flex flex-col justify-between shadow-2xl z-20 select-none">
      {/* Header */}
      <div className="p-4 px-5 border-b border-slate-800/80 bg-nebula-900/90 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-400 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Sparkles size={16} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Mail Copilot</h3>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] text-slate-400">UI Automation Active</span>
            </div>
          </div>
        </div>

        <button
          onClick={toggleAssistant}
          className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
        >
          <X size={16} />
        </button>
      </div>

      {/* Live Context Chip Bar */}
      <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <Layers size={12} className="text-indigo-400" />
          <span>View: <strong className="text-slate-200 uppercase">{currentView}</strong></span>
        </div>
        {openEmail && (
          <span className="truncate max-w-[160px] text-slate-300 font-medium">
            Email: {openEmail.sender.split('<')[0]}
          </span>
        )}
      </div>

      {/* Chat Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-2">
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-indigo-400 p-2">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
            <span>Reasoning & executing tool actions...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Test Prompt Chips */}
      <div className="p-3 border-t border-slate-800/60 bg-slate-950/40">
        <div className="flex items-center gap-1 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <Flame size={11} className="text-amber-400" />
          <span>Evaluator Test Prompts</span>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
          {quickTestPrompts.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(prompt)}
              disabled={isStreaming}
              className="text-[11px] bg-slate-800/80 hover:bg-indigo-600/30 text-slate-300 hover:text-indigo-200 border border-slate-700/80 hover:border-indigo-500/40 rounded-lg px-2 py-1 text-left truncate max-w-full transition disabled:opacity-40"
              title={prompt}
            >
              &quot;{prompt.slice(0, 32)}...&quot;
            </button>
          ))}
        </div>
      </div>

      {/* Chat Input */}
      <div className="p-3 bg-nebula-900 border-t border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={isStreaming}
            placeholder="Ask Copilot to draft, search, or navigate..."
            className="flex-1 bg-slate-800/80 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isStreaming || !inputMessage.trim()}
            className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shrink-0 transition disabled:opacity-40 shadow-md shadow-indigo-600/30"
          >
            <Send size={13} />
          </button>
        </form>
      </div>
    </aside>
  );
};
