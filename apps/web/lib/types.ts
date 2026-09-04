export type ViewType = 'inbox' | 'sent' | 'compose' | 'detail';

export interface Email {
  id: string;
  thread_id?: string;
  sender: string;
  recipients: string[];
  subject: string;
  snippet: string;
  body_text?: string;
  body_html?: string;
  folder: 'inbox' | 'sent' | 'draft';
  is_unread: boolean;
  date?: string;
  received_at?: string;
  label_ids?: string[];
}

export interface FilterCriteria {
  date_from?: string;
  date_to?: string;
  sender?: string;
  keyword?: string;
  unread_only?: boolean;
  folder?: string;
}

export interface ComposeDraft {
  to: string;
  subject: string;
  body: string;
  reply_to_id?: string;
  thread_id?: string;
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, any>;
  result?: any;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolCall?: ToolCall;
  isStreaming?: boolean;
}

export interface UIContext {
  current_view: ViewType;
  open_email: {
    id: string;
    sender: string;
    subject: string;
    snippet: string;
  } | null;
  active_filters: FilterCriteria;
}

export interface MailboxStats {
  total: number;
  unread: number;
}

export interface EmailListResponse {
  emails: Email[];
  count: number;
  next_page_token?: string | null;
  result_size_estimate?: number;
  is_search?: boolean;
  search_query?: string;
  search_total_estimate?: number;
  total_count?: number;
  unread_count?: number;
  is_unread_only?: boolean;
}
