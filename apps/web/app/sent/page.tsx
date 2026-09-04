'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMailStore } from '../../lib/store';

export default function SentPage() {
  const router = useRouter();
  const setView = useMailStore((s) => s.setView);

  useEffect(() => {
    setView('sent');
    router.replace('/');
  }, [router, setView]);

  return null;
}
