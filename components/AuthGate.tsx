'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      // initial check
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
      } else {
        setAuthed(true);
      }
      setReady(true);

      // react to future auth changes
      const { data } = supabase.auth.onAuthStateChange((_event, s) => {
        if (!s) {
          setAuthed(false);
          router.replace('/login');
        } else {
          setAuthed(true);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    })();

    return () => { if (unsubscribe) unsubscribe(); };
  }, [router]);

  if (!ready) return <div className="max-w-5xl mx-auto p-6">Checking login…</div>;
  if (!authed) return null; // we're redirecting
  return <>{children}</>;
}
