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

  setAuthenticated: (status, email) => set({ 
    isAuthenticated: status, 
    userEmail: email || null 
  }),

  setView: (view) => set({ currentView: view }),

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
      activeFilters: { ...state.activeFilters, ...filters }
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

  applyLocalFilters: () => {
    const { emails, activeFilters, currentView } = get();
    let result = [...emails];

    // Filter by view folder if appropriate
    if (currentView === 'inbox') {
      result = result.filter(e => e.folder === 'inbox');
    } else if (currentView === 'sent') {
      result = result.filter(e => e.folder === 'sent');
    }

    // Apply active filter criteria
    if (activeFilters.unread_only) {
      result = result.filter(e => e.is_unread);
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
