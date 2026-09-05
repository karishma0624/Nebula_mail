'use client';

import { ConnectGmailBanner } from '../../components/layout/ConnectGmailBanner';

export default function LoginPage() {
  return (
    <main className="flex h-screen w-screen items-center justify-center bg-[#f6f8fc] dark:bg-nebula-950 transition-colors">
      <ConnectGmailBanner />
    </main>
  );
}
