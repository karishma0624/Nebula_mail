export type ViewType = 'inbox' | 'sent' | 'compose' | 'detail';

export interface Email {
  id: string;
  thread_id?: string;
  sender: string;
  recipients: string[];
  subject: string;
  snippet: string;
  body_text?: string;
  body_plain?: string;
  body_html?: string;
  folder: 'inbox' | 'sent' | 'draft';
  is_unread: boolean;
  date?: string;
  received_at?: string;
  label_ids?: string[];
  has_form?: boolean;
  form_url?: string;
  attachments?: Array<{ filename: string; attachment_id?: string; mime_type?: string; size?: number }>;
}

export interface Citation {
  number: number;
  email_id: string;
  sender?: string;
  subject?: string;
  received_at?: string;
  snippet?: string;
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
  draft_id?: string;
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
  citations?: Citation[];
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
  is_search_active?: boolean;
  search_query?: string | null;
  top_emails?: Array<{
    id: string;
    sender: string;
    subject: string;
    snippet: string;
    date?: string;
  }>;
  preferred_language?: string;
}

export type EmailCategory = 'primary' | 'promotions' | 'social' | 'updates';

export interface CategoryCounts {
  total: number;
  unread: number;
}

export interface CategoryStats {
  primary: CategoryCounts;
  promotions: CategoryCounts;
  social: CategoryCounts;
  updates: CategoryCounts;
}

export interface MailboxStats {
  total: number;
  unread: number;
  sentTotal?: number;
  categories?: CategoryStats;
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
  category?: EmailCategory;
  category_total?: number;
  category_unread?: number;
}
