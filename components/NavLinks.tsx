'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavLinks() {
  const pathname = usePathname();

  const linkCls = (href: string) =>
    `hover:underline ${pathname === href ? 'font-semibold' : ''}`;

  return (
    <nav className="flex flex-wrap items-center gap-4 text-sm">
      <Link href="/" className={linkCls('/')}>Scoreboard</Link>
      <Link href="/draft" className={linkCls('/draft')}>Draft</Link>
      <Link href="/standings" className={linkCls('/standings')}>Standings</Link>
    </nav>
  );
}
