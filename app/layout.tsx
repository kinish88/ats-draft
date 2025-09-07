// app/layout.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'ATS Draft',
  description: 'Weekly ATS draft with O/U tiebreakers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-white">
        <header className="border-b border-white/10">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
            <Link href="/" className="font-semibold">ATS Draft</Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/">Scoreboard</Link>
              <Link href="/draft">Draft</Link>
              <Link href="/admin">Admin</Link>
              <Link href="/standings">Standings</Link>
            </nav>
          </div>
        </header>
        <main className="pb-16">{children}</main>
      </body>
    </html>
  );
}
