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
          sentTotal: data.sent?.total
        });
      }
    } catch (e) {
      console.warn('Unable to fetch mailbox statistics:', e);
    }
  }, [isAuthenticated, setMailboxStats]);

  const unreadOnly = useMailStore((state) => state.activeFilters.unread_only);

  // Fetch real emails from Gmail backend with native page tokens
  const fetchEmails = useCallback(async (pageToken: string | null = null, pageNumber: number = 1) => {
    if (!isAuthenticated) return;
    setLoadingEmails(true);
    try {
      const folder = currentView === 'sent' ? 'sent' : 'inbox';
      let url = `${AGENT_API_URL}/emails/list?folder=${folder}&limit=25`;
      const isUnread = useMailStore.getState().activeFilters.unread_only;
      if (isUnread) {
        url += `&unread_only=true`;
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

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchEmails(null, 1);
      fetchMailboxStats();
    }
  }, [isAuthenticated, currentView, unreadOnly, fetchEmails, fetchMailboxStats]);

  // Fallback 15-second polling sync
  // When active search is running, polling ONLY updates mailbox statistics and NEVER overwrites search results!
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
    <main className="flex h-screen w-screen overflow-hidden bg-nebula-950 font-sans">
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
    </main>
  );
}
