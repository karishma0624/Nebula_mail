'use client';

import React, { useEffect, useCallback } from 'react';
import { useMailStore } from '../lib/store';
import { Sidebar } from '../components/layout/Sidebar';
import { TopBar } from '../components/layout/TopBar';
import { ConnectGmailBanner } from '../components/layout/ConnectGmailBanner';
import { FilterBar } from '../components/mail/FilterBar';
import { EmailList } from '../components/mail/EmailList';
import { EmailDetail } from '../components/mail/EmailDetail';
import { ComposeForm } from '../components/mail/ComposeForm';
import { FormFillModal } from '../components/mail/FormFillModal';
import { AssistantPanel } from '../components/assistant/AssistantPanel';
import { ConfirmSendModal } from '../components/assistant/ConfirmSendModal';

const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';

export default function MailApp() {
  const { 
    isAuthenticated, 
    setAuthenticated, 
    currentView, 
    setEmails, 
    setLoadingEmails,
    currentPage,
    nextPageToken,
    pageTokenHistory,
    setPaginationData,
    setMailboxStats,
    isSearchActive,
    clearSearch
  } = useMailStore();

  // Check backend auth status
  const checkAuthStatus = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_API_URL}/auth/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated) {
          setAuthenticated(true, data.email || 'User');
          return true;
        }
      }
    } catch (e) {
      console.warn('Unable to connect to backend auth service:', e);
    }
    return false;
  }, [setAuthenticated]);

  // Fetch real mailbox statistics independently
  const fetchMailboxStats = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch(`${AGENT_API_URL}/emails/stats`);
      if (res.ok) {
        const data = await res.json();
        setMailboxStats({
          total: data.inbox?.total,
          unread: data.inbox?.unread,
          sentTotal: data.sent?.total,
          categories: data.categories
        });
      }
    } catch (e) {
      console.warn('Unable to fetch mailbox statistics:', e);
    }
  }, [isAuthenticated, setMailboxStats]);

  const activeFilters = useMailStore((state) => state.activeFilters);
  const activeCategory = useMailStore((state) => state.activeCategory);

  // Fetch real emails from Gmail backend with native page tokens
  const fetchEmails = useCallback(async (pageToken: string | null = null, pageNumber: number = 1) => {
    if (!isAuthenticated) return;
    setLoadingEmails(true);
    try {
      const folder = currentView === 'sent' ? 'sent' : 'inbox';
      let url = `${AGENT_API_URL}/emails/list?folder=${folder}&limit=25`;
      
      const { activeFilters: currentFilters, isSearchActive, activeCategory: currentCat } = useMailStore.getState();
      const queryParts: string[] = [];

      if (currentFilters.sender) {
        queryParts.push(`from:${currentFilters.sender}`);
      }
      if (currentFilters.keyword) {
        queryParts.push(currentFilters.keyword);
      }
      if (currentFilters.date_from) {
        queryParts.push(`after:${currentFilters.date_from}`);
      }
      if (currentFilters.date_to) {
        try {
          const parts = currentFilters.date_to.split('-').map(Number);
          if (parts.length === 3) {
            const nextDate = new Date(parts[0], parts[1] - 1, parts[2] + 1);
            const y = nextDate.getFullYear();
            const m = String(nextDate.getMonth() + 1).padStart(2, '0');
            const d = String(nextDate.getDate()).padStart(2, '0');
            queryParts.push(`before:${y}-${m}-${d}`);
          } else {
            queryParts.push(`before:${currentFilters.date_to}`);
          }
        } catch {
          queryParts.push(`before:${currentFilters.date_to}`);
        }
      }

      const combinedQ = queryParts.join(' ').trim();
      const hasSearch = Boolean(combinedQ);

      if (hasSearch) {
        url += `&q=${encodeURIComponent(combinedQ)}`;
      }

      if (currentFilters.unread_only) {
        url += `&unread_only=true`;
      }

      // STRICT ISOLATION: category MUST ONLY be passed when folder is inbox AND there is NO search/filters
      if (folder === 'inbox' && !hasSearch && !isSearchActive) {
        if (currentCat) {
          url += `&category=${encodeURIComponent(currentCat)}`;
        }
      }

      if (pageToken) {
        url += `&page_token=${encodeURIComponent(pageToken)}`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEmails(data.emails || []);
        setPaginationData(
          pageNumber, 
          data.next_page_token || null, 
          data.total_count, 
          data.unread_count
        );
      }
    } catch (err) {
      console.error('Failed to load Gmail messages:', err);
    } finally {
      setLoadingEmails(false);
    }
  }, [isAuthenticated, currentView, setEmails, setLoadingEmails, setPaginationData]);

  // Pagination navigation handlers
  const handleNextPage = useCallback(() => {
    if (nextPageToken) {
      fetchEmails(nextPageToken, currentPage + 1);
    }
  }, [nextPageToken, currentPage, fetchEmails]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      const targetPage = currentPage - 1;
      const targetToken = pageTokenHistory[targetPage - 1] ?? null;
      fetchEmails(targetToken, targetPage);
    }
  }, [currentPage, pageTokenHistory, fetchEmails]);

  const handleClearSearch = useCallback(() => {
    clearSearch();
    fetchEmails(null, 1);
  }, [clearSearch, fetchEmails]);

  const handleCategoryChange = useCallback(() => {
    fetchEmails(null, 1);
  }, [fetchEmails]);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Initial load only: fetch emails and mailbox stats
  useEffect(() => {
    if (isAuthenticated) {
      fetchEmails(null, 1);
      fetchMailboxStats();
    }
  }, [isAuthenticated, checkAuthStatus]);

  // View / Category / Filter change: fetch emails and reset to page 1
  // Notice: fetchMailboxStats is NOT called on category switch!
  useEffect(() => {
    if (isAuthenticated) {
      fetchEmails(null, 1);
    }
  }, [isAuthenticated, currentView, activeCategory, activeFilters, fetchEmails]);

  // Fallback 15-second polling sync
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      const state = useMailStore.getState();
      if (state.isSearchActive) {
        fetchMailboxStats();
      } else if (state.currentPage === 1) {
        fetchEmails(null, 1);
      } else {
        fetchMailboxStats();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchEmails, fetchMailboxStats]);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-white dark:bg-slate-950 font-sans transition-colors">
      {/* 1. Left Sidebar Navigation */}
      <Sidebar />

      {/* 2. Main Mail Workspace */}
      <section className="flex-1 flex flex-col h-full overflow-hidden">
        <TopBar onRefresh={() => {
          if (useMailStore.getState().isSearchActive) {
            handleClearSearch();
          } else {
            fetchEmails(null, 1);
          }
        }} />

        {/* Center Workspace View Handling */}
        {currentView === 'compose' ? (
          <div className="flex-1 flex overflow-hidden">
            <ComposeForm />
          </div>
        ) : !isAuthenticated ? (
          /* State: Not Authenticated on Inbox / Sent / Detail -> Render clean Connect Gmail banner */
          <ConnectGmailBanner />
        ) : (
          /* State: Authenticated -> Render real Gmail UI views */
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {currentView !== 'detail' && (
              <FilterBar />
            )}

            <div className="flex-1 flex overflow-hidden">
              {currentView === 'detail' ? (
                <EmailDetail />
              ) : (
                <EmailList 
                  onNextPage={handleNextPage}
                  onPrevPage={handlePrevPage}
                  onClearSearch={handleClearSearch}
                  onCategoryChange={handleCategoryChange}
                  onRefresh={() => fetchEmails(null, 1)}
                />
              )}
            </div>
          </div>
        )}
      </section>

      {/* 3. AI Copilot Drawer */}
      <AssistantPanel />

      {/* 4. Human-in-the-Loop Send Approval Modal */}
      <ConfirmSendModal />

      {/* 5. Human-in-the-Loop Form Fill Approval Modal */}
      <FormFillModal />
    </main>
  );
}

