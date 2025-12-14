// app/layout.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import NavLinks from '@/components/NavLinks'; // ← add this
import CountdownBanner from '@/src/components/CountdownBanner';
import { NFL_LOGO_URL } from '@/lib/logos';

export const metadata: Metadata = {
  title: 'ATS Draft',
  description: 'Weekly ATS draft with O/U tiebreakers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-white">
        <header className="border-b border-white/10">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {NFL_LOGO_URL ? (
                <img src={NFL_LOGO_URL} alt="NFL shield" className="h-7 w-7 rounded-sm border border-white/10" />
              ) : null}
              <Link href="/" className="font-semibold">ATS Draft</Link>
            </div>
            <NavLinks /> {/* ← replaces the hard-coded links */}
          </div>
        </header>
        <CountdownBanner />
        <main className="pb-16">{children}</main>
      </body>
    </html>
  );
}
