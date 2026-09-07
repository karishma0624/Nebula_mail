'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useMailStore } from '../../../lib/store';
import { authFetch, AGENT_API_URL } from '../../../lib/api';

export default function EmailDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const { emails, setOpenEmail } = useMailStore();

  useEffect(() => {
    if (!id) return;
    const found = emails.find((e) => e.id === id);
    if (found) {
      setOpenEmail(found);
      router.replace('/');
    } else {
      authFetch(`${AGENT_API_URL}/emails/${id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.id) {
            setOpenEmail(data);
          }
          router.replace('/');
        })
        .catch(() => router.replace('/'));
    }
  }, [id, emails, setOpenEmail, router]);

  return null;
}
