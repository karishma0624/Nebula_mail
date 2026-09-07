'use client';

import React, { useState, useEffect } from 'react';
import { LogOut, AlertCircle, X, Shield } from 'lucide-react';
import { useMailStore } from '../../lib/store';
import { performLogout } from '../../lib/auth';

export const LogoutModal: React.FC = () => {
  const { isLogoutModalOpen, closeLogoutModal, userEmail } = useMailStore();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isLogoutModalOpen && !isLoggingOut) {
        closeLogoutModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLogoutModalOpen, isLoggingOut, closeLogoutModal]);

  if (!isLogoutModalOpen) return null;

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true);
    try {
      await performLogout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={() => !isLoggingOut && closeLogoutModal()}
    >
      <div
        className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden transition-all duration-200 scale-100 animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle ambient glow */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={closeLogoutModal}
          disabled={isLoggingOut}
          aria-label="Close modal"
          className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-40"
        >
          <X size={18} />
        </button>

        {/* Icon */}
        <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-500/15 border border-rose-100 dark:border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-5 shadow-xs">
          <LogOut size={26} className="translate-x-0.5" />
        </div>

        {/* Text Details */}
        <div className="text-center mb-6">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight mb-2">
            Log out of Nebula Mail?
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            You will be disconnected from your Gmail session for{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {userEmail || 'this account'}
            </span>
            . Stored credentials will be safely cleared.
          </p>
        </div>

        {/* Info Pill */}
        <div className="mb-6 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300">
          <Shield size={16} className="text-emerald-500 shrink-0" />
          <span>You can reconnect your Gmail account at any time with a single click.</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={closeLogoutModal}
            disabled={isLoggingOut}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirmLogout}
            disabled={isLoggingOut}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/25 active:scale-[0.98] transition duration-150 disabled:opacity-60"
          >
            {isLoggingOut ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Logging out...</span>
              </>
            ) : (
              <>
                <LogOut size={16} />
                <span>Log out</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
