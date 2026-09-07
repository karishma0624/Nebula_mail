'use client';

import React, { useState } from 'react';
import { ChatMessage as ChatMessageType, Citation } from '../../lib/types';
import { 
  Sparkles, 
  User, 
  Wrench, 
  CheckCircle2, 
  FileText, 
  Volume2, 
  VolumeX,
  Copy,
  Check,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  Link2,
  ChevronDown,
  ExternalLink
} from 'lucide-react';
import { useMailStore } from '../../lib/store';
import { authFetch, AGENT_API_URL } from '../../lib/api';

interface ChatMessageProps {
  message: ChatMessageType;
  onEdit?: (messageId: string, newContent: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, onEdit }) => {
  const { emails, setOpenEmail, setView, setHighlightedEmailId, activeConversationId } = useMailStore();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(message.content);
  const [feedbackRating, setFeedbackRating] = useState<'thumbs_up' | 'thumbs_down' | null>(null);
  const [showSources, setShowSources] = useState(false);

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
      // Clean speech text removing citation brackets and markdown formatting
      const spokenText = message.content
        .replace(/\[\d+\]/g, '')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/\*\*(.*?)\*\*/g, '$1');
      const utterance = new SpeechSynthesisUtterance(spokenText);
      const preferredLang = typeof window !== 'undefined' ? (localStorage.getItem('nebula_preferred_language') || 'auto') : 'auto';
      if (preferredLang !== 'auto') utterance.lang = preferredLang;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleCopy = () => {
    // Plain text without citations and links stripped to text
    const cleanText = message.content
      .replace(/\[\d+\]/g, '')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)');
    navigator.clipboard.writeText(cleanText.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleFeedback = async (rating: 'thumbs_up' | 'thumbs_down') => {
    if (feedbackRating === rating) return;
    setFeedbackRating(rating);
    try {
      await authFetch(`${AGENT_API_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          message: message.content.slice(0, 150),
          conversation_id: activeConversationId || undefined
        })
      });
    } catch (e) {
      console.warn('Feedback submit notice:', e);
    }
  };

  const handleSaveEdit = () => {
    const trimmed = editedText.trim();
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false);
      return;
    }
    setIsEditing(false);
    onEdit?.(message.id, trimmed);
  };

  // Render inline text with markdown links [label](url), **bold**, and [1] citation markers
  const renderInlineFormatted = (rawText: string) => {
    // Match either markdown links [label](url) or citations [1]
    const tokenRegex = /\[(.*?)\]\((https?:\/\/[^\)]+)\)|\[(\d+)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let match;

    const parseBold = (segment: string, keyPrefix: string): React.ReactNode[] => {
      const boldRegex = /\*\*(.*?)\*\*/g;
      const boldParts: React.ReactNode[] = [];
      let bLast = 0;
      let bMatch;
      while ((bMatch = boldRegex.exec(segment)) !== null) {
        if (bMatch.index > bLast) {
          boldParts.push(segment.substring(bLast, bMatch.index));
        }
        boldParts.push(
          <strong key={`${keyPrefix}-b-${bMatch.index}`} className="font-semibold text-slate-900 dark:text-white">
            {bMatch[1]}
          </strong>
        );
        bLast = bMatch.index + bMatch[0].length;
      }
      if (bLast < segment.length) {
        boldParts.push(segment.substring(bLast));
      }
      return boldParts.length > 0 ? boldParts : [segment];
    };

    while ((match = tokenRegex.exec(rawText)) !== null) {
      if (match.index > lastIdx) {
        parts.push(...parseBold(rawText.substring(lastIdx, match.index), `txt-${match.index}`));
      }

      // 1. Markdown link [label](url)
      if (match[1] && match[2]) {
        const linkLabel = match[1];
        const linkUrl = match[2];
        parts.push(
          <a
            key={`link-${match.index}`}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 font-medium underline underline-offset-2 hover:text-blue-800 dark:hover:text-blue-300 inline-flex items-center gap-0.5"
          >
            {linkLabel}
            <ExternalLink size={10} className="inline opacity-70" />
          </a>
        );
      }
      // 2. Citation marker [num]
      else if (match[3]) {
        const citNumber = parseInt(match[3], 10);
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
      }

      lastIdx = match.index + match[0].length;
    }

    if (lastIdx < rawText.length) {
      parts.push(...parseBold(rawText.substring(lastIdx), `txt-end`));
    }

    return parts;
  };

  const renderContentWithCitations = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('• ') || trimmed.startsWith('- ')) {
        const bulletText = trimmed.replace(/^[•\-]\s*/, '');
        return (
          <div key={idx} className="flex items-start gap-1.5 my-1 pl-1">
            <span className="text-blue-600 dark:text-indigo-400 font-bold shrink-0 leading-tight">•</span>
            <div className="flex-1 leading-relaxed">{renderInlineFormatted(bulletText)}</div>
          </div>
        );
      }
      return (
        <div key={idx} className={idx > 0 ? "mt-1.5" : ""}>
          {renderInlineFormatted(line)}
        </div>
      );
    });
  };

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3 group`}>
      <div className={`flex items-start gap-2 max-w-[92%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-xs shadow-sm ${
          isUser 
            ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200' 
            : 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white'
        }`}>
          {isUser ? <User size={13} /> : <Sparkles size={13} />}
        </div>

        {/* Message container */}
        <div className="flex flex-col gap-1.5 max-w-full">
          {/* User Inline Editing Mode */}
          {isUser && isEditing ? (
            <div className="flex flex-col gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-blue-400 dark:border-indigo-500 shadow-sm min-w-[240px]">
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                className="w-full text-xs p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={() => {
                    setEditedText(message.content);
                    setIsEditing(false);
                  }}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1 rounded-md text-[11px] font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition"
                >
                  Save & Submit
                </button>
              </div>
            </div>
          ) : (
            message.content && (
              <div className={`relative px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm whitespace-pre-line ${
                isUser
                  ? 'bg-[#0b57d0] text-white rounded-tr-sm'
                  : 'bg-[#f0f4f9] dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200/90 dark:border-slate-700 rounded-tl-sm'
              }`}>
                {renderContentWithCitations(message.content)}

                {/* User Message Action Buttons (Copy, Edit) on Hover */}
                {isUser && (
                  <div className="absolute top-1 right-full mr-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border border-slate-200 dark:border-slate-700 rounded-lg p-0.5 shadow-sm">
                    <button
                      onClick={() => setIsEditing(true)}
                      className="p-1 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      title="Edit prompt"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={handleCopy}
                      className="p-1 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      title={copied ? "Copied!" : "Copy message"}
                    >
                      {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    </button>
                  </div>
                )}
              </div>
            )
          )}

          {/* Section 24 & Image 2: Sources Chip & Assistant Actions */}
          {!isUser && !message.isStreaming && (
            <div className="flex items-center flex-wrap gap-2 mt-0.5 pl-1">
              {/* Sources Chip Pill */}
              {message.citations && message.citations.length > 0 && (
                <button
                  onClick={() => setShowSources(!showSources)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300/80 dark:border-slate-700 text-[11px] font-medium transition cursor-pointer shadow-sm"
                  title="View referenced sources"
                >
                  <Link2 size={12} className="rotate-45 text-slate-500 dark:text-slate-400" />
                  <span>{message.citations.length} {message.citations.length === 1 ? 'source' : 'sources'}</span>
                  <ChevronDown size={11} className={`text-slate-400 transition-transform duration-150 ${showSources ? 'rotate-180' : ''}`} />
                </button>
              )}

              {/* Feedback Icons (Thumbs Up, Thumbs Down) */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleFeedback('thumbs_up')}
                  className={`p-1 rounded-md transition ${
                    feedbackRating === 'thumbs_up'
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Good response"
                >
                  <ThumbsUp size={12} />
                </button>
                <button
                  onClick={() => handleFeedback('thumbs_down')}
                  className={`p-1 rounded-md transition ${
                    feedbackRating === 'thumbs_down'
                      ? 'text-red-500 bg-red-50 dark:bg-red-950/60'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Bad response"
                >
                  <ThumbsDown size={12} />
                </button>
                <button
                  onClick={handleCopy}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title={copied ? "Copied!" : "Copy response"}
                >
                  {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                </button>
                <button
                  onClick={toggleSpeech}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title={isSpeaking ? "Stop reading" : "Read aloud"}
                >
                  {isSpeaking ? <VolumeX size={12} className="text-blue-600 dark:text-indigo-400" /> : <Volume2 size={12} />}
                </button>
              </div>
            </div>
          )}

          {/* Expandable Sources Dropdown Card */}
          {!isUser && showSources && message.citations && message.citations.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1">
                Referenced Emails
              </div>
              {message.citations.map((c: Citation) => (
                <button
                  key={c.number}
                  onClick={() => handleCitationClick(c.email_id)}
                  className="flex items-start gap-2 p-2 rounded-lg text-left hover:bg-blue-50/70 dark:hover:bg-slate-800/80 transition cursor-pointer border border-transparent hover:border-blue-200 dark:hover:border-slate-700"
                >
                  <span className="w-4 h-4 rounded bg-blue-100 dark:bg-indigo-950 text-blue-700 dark:text-indigo-300 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    {c.number}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {c.sender?.replace(/<.*>/, '').trim() || 'Sender'}
                      </span>
                      {c.received_at && (
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {c.received_at.length > 16 ? c.received_at.slice(0, 16) : c.received_at}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {c.subject || 'No Subject'}
                    </div>
                  </div>
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
