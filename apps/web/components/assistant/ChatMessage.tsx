'use client';

import React from 'react';
import { ChatMessage as ChatMessageType } from '../../lib/types';
import { Sparkles, User, Wrench, CheckCircle2 } from 'lucide-react';

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.sender === 'user';
  const isTool = message.sender === 'tool' || !!message.toolCall;

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3`}>
      <div className={`flex items-start gap-2 max-w-[90%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-xs shadow-md ${
          isUser 
            ? 'bg-slate-700 text-slate-200' 
            : 'bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white'
        }`}>
          {isUser ? <User size={13} /> : <Sparkles size={13} />}
        </div>

        {/* Message bubble */}
        <div className="flex flex-col gap-1.5">
          {message.content && (
            <div className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm ${
              isUser
                ? 'bg-indigo-600 text-white rounded-tr-sm'
                : 'glass-card text-slate-200 border border-slate-800 rounded-tl-sm'
            }`}>
              {message.content}
            </div>
          )}

          {/* Embedded Tool Call Event Notification */}
          {message.toolCall && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-950/60 border border-indigo-500/30 text-[11px] text-indigo-300">
              <Wrench size={12} className="text-cyan-400 shrink-0" />
              <span className="font-semibold">{message.toolCall.name}</span>
              <span className="text-slate-400 text-[10px]">
                {message.toolCall.name === 'draft_compose' && `(to: ${message.toolCall.arguments?.to || '...'})`}
                {message.toolCall.name === 'search_emails' && `(query: ${message.toolCall.arguments?.keyword || message.toolCall.arguments?.sender || 'filters'})`}
                {message.toolCall.name === 'open_email' && `(id: ${message.toolCall.arguments?.email_id?.slice(0, 8)}...)`}
                {message.toolCall.name === 'prepare_send' && `(confirmation required)`}
              </span>
              <CheckCircle2 size={11} className="text-emerald-400 ml-auto shrink-0" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
