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
    setLoadingEmails 
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

  // Fetch real emails from Gmail backend
  const fetchEmails = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoadingEmails(true);
    try {
      const folder = currentView === 'sent' ? 'sent' : 'inbox';
      const res = await fetch(`${AGENT_API_URL}/emails/list?folder=${folder}`);
      if (res.ok) {
        const data = await res.json();
        setEmails(data.emails || []);
      }
    } catch (err) {
      console.error('Failed to load Gmail messages:', err);
    } finally {
      setLoadingEmails(false);
    }
  }, [isAuthenticated, currentView, setEmails, setLoadingEmails]);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchEmails();
    }
  }, [isAuthenticated, currentView, fetchEmails]);

  // Fallback 15-second polling sync per priority specification
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      fetchEmails();
    }, 15000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchEmails]);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-nebula-950 font-sans">
      {/* 1. Left Sidebar Navigation */}
      <Sidebar />

      {/* 2. Main Mail Workspace */}
      <section className="flex-1 flex flex-col h-full overflow-hidden">
        <TopBar onRefresh={fetchEmails} />

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
                <EmailList />
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
