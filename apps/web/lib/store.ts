import { create } from 'zustand';
import { ViewType, Email, FilterCriteria, ComposeDraft } from './types';

interface MailState {
  isAuthenticated: boolean;
  userEmail: string | null;
  currentView: ViewType;
  emails: Email[];
  filteredEmails: Email[];
  openEmail: Email | null;
  activeFilters: FilterCriteria;
  composeDraft: ComposeDraft;
  isTypingCompose: boolean;
  draftToSend: ComposeDraft | null;
  isConfirmModalOpen: boolean;
  isLoadingEmails: boolean;
  isAssistantOpen: boolean;

  // Pagination & Mailbox Stats
  currentPage: number;
  nextPageToken: string | null;
  pageTokenHistory: (string | null)[];
  totalMessages: number;
  unreadMessages: number;
  sentTotal: number;

  // Search Mode State
  isSearchActive: boolean;
  searchQueryDescription: string | null;
  searchResultEstimate: number | null;

  // Actions
  setAuthenticated: (status: boolean, email?: string) => void;
  setView: (view: ViewType) => void;
  setOpenEmail: (email: Email | null) => void;
  setEmails: (emails: Email[]) => void;
  setFilters: (filters: Partial<FilterCriteria>) => void;
  resetFilters: () => void;
  setComposeDraft: (draft: Partial<ComposeDraft>) => void;
  resetComposeDraft: () => void;
  setIsTypingCompose: (isTyping: boolean) => void;
  openConfirmModal: (draft: ComposeDraft) => void;
  closeConfirmModal: () => void;
  toggleAssistant: () => void;
  setAssistantOpen: (open: boolean) => void;
  setLoadingEmails: (loading: boolean) => void;
  applyLocalFilters: () => void;

  // Pagination & Search Actions
  setPaginationData: (page: number, nextToken: string | null, total?: number, unread?: number) => void;
  setMailboxStats: (stats: { total?: number; unread?: number; sentTotal?: number }) => void;
  setSearchResults: (emails: Email[], queryDesc: string, estimate?: number, nextToken?: string | null) => void;
  clearSearch: () => void;
}

const initialDraft: ComposeDraft = {
  to: '',
  subject: '',
  body: '',
};

export const useMailStore = create<MailState>((set, get) => ({
  isAuthenticated: false,
  userEmail: null,
  currentView: 'inbox',
  emails: [],
  filteredEmails: [],
  openEmail: null,
  activeFilters: {},
  composeDraft: initialDraft,
  isTypingCompose: false,
  draftToSend: null,
  isConfirmModalOpen: false,
  isLoadingEmails: false,
  isAssistantOpen: true,

  currentPage: 1,
  nextPageToken: null,
  pageTokenHistory: [null],
  totalMessages: 0,
  unreadMessages: 0,
  sentTotal: 0,

  isSearchActive: false,
  searchQueryDescription: null,
  searchResultEstimate: null,

  setAuthenticated: (status, email) => set({ 
    isAuthenticated: status, 
    userEmail: email || null 
  }),

  setView: (view) => {
    const current = get().currentView;
    if (view !== 'detail' && view !== current) {
      // Reset pagination when switching primary view folders
      set({ 
        currentView: view,
        currentPage: 1,
        nextPageToken: null,
        pageTokenHistory: [null],
        isSearchActive: false,
        searchQueryDescription: null,
        searchResultEstimate: null
      });
    } else {
      set({ currentView: view });
    }
    get().applyLocalFilters();
  },

  setOpenEmail: (email) => set({ 
    openEmail: email,
    currentView: email ? 'detail' : 'inbox'
  }),

  setEmails: (emails) => {
    set({ emails });
    get().applyLocalFilters();
  },

  setFilters: (filters) => {
    set((state) => ({
      activeFilters: { ...state.activeFilters, ...filters },
      ...(filters.unread_only !== undefined ? {
        currentPage: 1,
        nextPageToken: null,
        pageTokenHistory: [null]
      } : {})
    }));
    get().applyLocalFilters();
  },

  resetFilters: () => {
    set({ activeFilters: {} });
    get().applyLocalFilters();
  },

  setComposeDraft: (draft) => set((state) => ({
    composeDraft: { ...state.composeDraft, ...draft }
  })),

  resetComposeDraft: () => set({ composeDraft: initialDraft }),

  setIsTypingCompose: (isTyping) => set({ isTypingCompose: isTyping }),

  openConfirmModal: (draft) => set({
    draftToSend: draft,
    isConfirmModalOpen: true
  }),

  closeConfirmModal: () => set({
    isConfirmModalOpen: false,
    draftToSend: null
  }),

  toggleAssistant: () => set((state) => ({ isAssistantOpen: !state.isAssistantOpen })),
  
  setAssistantOpen: (open) => set({ isAssistantOpen: open }),

  setLoadingEmails: (loading) => set({ isLoadingEmails: loading }),

  setPaginationData: (page, nextToken, total, unread) => {
    set((state) => {
      const history = [...state.pageTokenHistory];
      // Ensure history index for this page exists
      if (page > history.length) {
        history.push(nextToken);
      } else if (nextToken && history[page] !== nextToken) {
        history[page] = nextToken;
      }
      return {
        currentPage: page,
        nextPageToken: nextToken,
        pageTokenHistory: history,
        ...(total !== undefined ? { totalMessages: total } : {}),
        ...(unread !== undefined ? { unreadMessages: unread } : {})
      };
    });
  },

  setMailboxStats: (stats) => {
    set((state) => ({
      ...(stats.total !== undefined ? { totalMessages: stats.total } : {}),
      ...(stats.unread !== undefined ? { unreadMessages: stats.unread } : {}),
      ...(stats.sentTotal !== undefined ? { sentTotal: stats.sentTotal } : {})
    }));
  },

  setSearchResults: (emails, queryDesc, estimate, nextToken = null) => {
    set({
      emails,
      filteredEmails: emails,
      isSearchActive: true,
      searchQueryDescription: queryDesc,
      searchResultEstimate: estimate !== undefined ? estimate : emails.length,
      currentPage: 1,
      nextPageToken: nextToken,
      pageTokenHistory: [null],
      currentView: 'inbox'
    });
  },

  clearSearch: () => {
    set({
      isSearchActive: false,
      searchQueryDescription: null,
      searchResultEstimate: null,
      currentPage: 1,
      nextPageToken: null,
      pageTokenHistory: [null]
    });
  },

  applyLocalFilters: () => {
    const { emails, activeFilters, currentView, isSearchActive } = get();
    let result = [...emails];

    // If search mode is active, do not discard emails by folder or keyword mismatch
    if (!isSearchActive) {
      if (currentView === 'inbox') {
        result = result.filter(e => e.folder === 'inbox');
      } else if (currentView === 'sent') {
        result = result.filter(e => e.folder === 'sent');
      }

      if (activeFilters.sender) {
        const s = activeFilters.sender.toLowerCase();
        result = result.filter(e => e.sender.toLowerCase().includes(s));
      }

      if (activeFilters.keyword) {
        const kw = activeFilters.keyword.toLowerCase();
        result = result.filter(e => 
          e.subject.toLowerCase().includes(kw) || 
          e.snippet.toLowerCase().includes(kw)
        );
      }
    }

    // Unread filter applies in both normal and search view
    if (activeFilters.unread_only) {
      result = result.filter(e => e.is_unread);
    }

    if (activeFilters.date_from) {
      const parts = activeFilters.date_from.split('-').map(Number);
      if (parts.length === 3) {
        const fromDate = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime();
        result = result.filter(e => {
          const itemDate = new Date(e.date || e.received_at || '').getTime();
          return !isNaN(itemDate) && itemDate >= fromDate;
        });
      }
    }

    if (activeFilters.date_to) {
      const parts = activeFilters.date_to.split('-').map(Number);
      if (parts.length === 3) {
        const toDate = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999).getTime();
        result = result.filter(e => {
          const itemDate = new Date(e.date || e.received_at || '').getTime();
          return !isNaN(itemDate) && itemDate <= toDate;
        });
      }
    }

    // Always sort newest emails first
    result.sort((a, b) => {
      const timeA = new Date(a.date || a.received_at || '').getTime();
      const timeB = new Date(b.date || b.received_at || '').getTime();
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });

    set({ filteredEmails: result });
  }
}));
