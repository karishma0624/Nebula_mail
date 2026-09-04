'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMailStore } from '../../lib/store';

export default function ComposePage() {
  const router = useRouter();
  const setView = useMailStore((s) => s.setView);

  useEffect(() => {
    setView('compose');
    router.replace('/');
  }, [router, setView]);

  return null;
}
