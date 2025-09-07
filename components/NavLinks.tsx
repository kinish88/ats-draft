'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function NavLinks() {
  const router = useRouter();
  const pathname = usePathname();

  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const em = session?.user.email ?? null;
      setEmail(em);

      // Admin = your email OR players.display_name === 'Kinish'
      let ok = (em?.toLowerCase() === 'me@chrismcarthur.co.uk');
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

  async function logout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const linkCls = (href: string) =>
    `hover:underline ${pathname === href ? 'font-semibold' : ''}`;

  return (
    <nav className="flex items-center gap-4 text-sm">
      <Link href="/" className={linkCls('/')}>Scoreboard</Link>
      <Link href="/draft" className={linkCls('/draft')}>Draft</Link>
      <Link href="/standings" className={linkCls('/standings')}>Standings</Link>
      {isAdmin && <Link href="/admin" className={linkCls('/admin')}>Admin</Link>}
      {email && (
        <button onClick={logout} className="text-xs opacity-80 hover:opacity-100 border px-2 py-1 rounded">
          Log out
        </button>
      )}
    </nav>
  );
}
