'use client';

import { ConnectGmailBanner } from '../../components/layout/ConnectGmailBanner';

export default function LoginPage() {
  return (
    <main className="flex h-screen w-screen items-center justify-center bg-nebula-950">
      <ConnectGmailBanner />
    </main>
  );
}
