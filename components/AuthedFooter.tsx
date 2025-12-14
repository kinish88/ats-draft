'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthedFooter() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const em = session?.user.email ?? null;

      let ok = em?.toLowerCase() === 'me@chrismcarthur.co.uk';
      if (!ok && em) {
        const { data } = await supabase
          .from('players')
          .select('display_name')
          .eq('email', em)
          .maybeSingle();
        ok = data?.display_name === 'Kinish';
      }
      setIsAdmin(ok);
    })();
  }, []);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  }, [router]);

  return (
    <footer className="border-t border-white/10 px-6 py-4 text-sm text-zinc-400">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-full border border-white/20 px-4 py-1.5 text-white/80 transition hover:text-white hover:border-white/40"
        >
          Log out
        </button>
        {isAdmin && (
          <Link
            href="/admin"
            className="rounded-full border border-white/15 px-4 py-1.5 text-white/80 transition hover:text-white hover:border-white/40"
          >
            Admin
          </Link>
        )}
      </div>
    </footer>
  );
}
