'use client';

import React, { useState } from 'react';
import { ChatMessage as ChatMessageType } from '../../lib/types';
import { Sparkles, User, Wrench, CheckCircle2, FileText, Volume2, VolumeX } from 'lucide-react';
import { useMailStore } from '../../lib/store';

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const { emails, setOpenEmail, setView, setHighlightedEmailId } = useMailStore();
  const [isSpeaking, setIsSpeaking] = useState(false);

  const isUser = message.sender === 'user';

  const handleCitationClick = (emailId: string) => {
    const found = emails.find((e) => e.id === emailId);
    if (found) {
      setOpenEmail(found);
      setView('detail');
    }
    setHighlightedEmailId(emailId);
    setTimeout(() => {
      setHighlightedEmailId(null);
    }, 1500);
  };

  const toggleSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else {
      window.speechSynthesis.cancel();
      const spokenText = message.content.replace(/\[\d+\]/g, '');
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  // Render text with clickable citation badges [1], [2]
  const renderContentWithCitations = (text: string) => {
    const citationRegex = /\[(\d+)\]/g;
    const parts = [];
    let lastIdx = 0;
    let match;

    while ((match = citationRegex.exec(text)) !== null) {
      const citNumber = parseInt(match[1], 10);
      // Preceding text
      if (match.index > lastIdx) {
        parts.push(text.substring(lastIdx, match.index));
      }
      // Citation pill
      const targetCit = message.citations?.find((c) => c.number === citNumber);
      const targetId = targetCit?.email_id || (citNumber === 1 ? emails[0]?.id : undefined);

      parts.push(
        <button
          key={`cit-${match.index}`}
          onClick={() => targetId && handleCitationClick(targetId)}
          className="inline-flex items-center px-1.5 py-0.2 mx-0.5 rounded-md bg-blue-100 hover:bg-blue-200 text-blue-700 hover:text-blue-900 dark:bg-indigo-500/20 dark:hover:bg-indigo-500/40 dark:text-indigo-300 dark:hover:text-white border border-blue-300 dark:border-indigo-500/30 text-[10px] font-bold transition cursor-pointer"
          title={targetCit ? `Referenced: ${targetCit.subject || targetCit.email_id}` : `Citation [${citNumber}]`}
        >
          [{citNumber}]
        </button>
      );
      lastIdx = match.index + match[0].length;
    }

    if (lastIdx < text.length) {
      parts.push(text.substring(lastIdx));
    }

    return parts.length > 0 ? parts : text;
  };

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3`}>
      <div className={`flex items-start gap-2 max-w-[92%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-xs shadow-sm ${
          isUser 
            ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200' 
            : 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white'
        }`}>
          {isUser ? <User size={13} /> : <Sparkles size={13} />}
        </div>

        {/* Message bubble */}
        <div className="flex flex-col gap-1.5">
          {message.content && (
            <div className={`relative group px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm whitespace-pre-line ${
              isUser
                ? 'bg-[#0b57d0] text-white rounded-tr-sm'
                : 'bg-[#f0f4f9] dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200/90 dark:border-slate-700 rounded-tl-sm'
            }`}>
              {renderContentWithCitations(message.content)}

              {/* Text-to-speech button on assistant messages */}
              {!isUser && !message.isStreaming && (
                <button
                  onClick={toggleSpeech}
                  className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md bg-white/80 dark:bg-slate-700/80 hover:bg-blue-50 dark:hover:bg-indigo-600/60 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-white border border-slate-200 dark:border-slate-600"
                  title={isSpeaking ? "Stop reading" : "Read aloud"}
                >
                  {isSpeaking ? <VolumeX size={11} className="text-blue-600 dark:text-indigo-400" /> : <Volume2 size={11} />}
                </button>
              )}
            </div>
          )}

          {/* Citation chips list */}
          {message.citations && message.citations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {message.citations.map((c) => (
                <button
                  key={c.number}
                  onClick={() => handleCitationClick(c.email_id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-900 dark:bg-indigo-950/70 dark:hover:bg-indigo-800/70 dark:text-indigo-300 border border-blue-200 dark:border-indigo-500/30 text-[10px] font-semibold transition cursor-pointer shadow-sm"
                  title={`Open: ${c.subject || c.email_id}`}
                >
                  <FileText size={10} />
                  <span>[{c.number}] {c.sender?.split('<')[0]?.trim() || 'Email'}</span>
                </button>
              ))}
            </div>
          )}

          {/* Embedded Tool Call Event Notification */}
          {message.toolCall && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-indigo-950/60 border border-blue-200 dark:border-indigo-500/30 text-[11px] text-blue-900 dark:text-indigo-300 font-medium">
              <Wrench size={12} className="text-blue-600 dark:text-cyan-400 shrink-0" />
              <span className="font-semibold">{message.toolCall.name}</span>
              <span className="text-slate-500 dark:text-slate-400 text-[10px]">
                {message.toolCall.name === 'draft_compose' && `(to: ${message.toolCall.arguments?.to || '...'})`}
                {message.toolCall.name === 'search_emails' && `(query: ${message.toolCall.arguments?.keyword || message.toolCall.arguments?.sender || 'filters'})`}
                {message.toolCall.name === 'open_email' && `(id: ${message.toolCall.arguments?.email_id?.slice(0, 8)}...)`}
                {message.toolCall.name === 'prepare_send' && `(confirmation required)`}
                {message.toolCall.name === 'fill_form' && `(preview prepared)`}
              </span>
              <CheckCircle2 size={11} className="text-emerald-500 dark:text-emerald-400 ml-auto shrink-0" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
