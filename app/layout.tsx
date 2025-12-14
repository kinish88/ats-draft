// app/layout.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import NavLinks from '@/components/NavLinks'; // ← add this
import TinyLogo from '@/components/TinyLogo';

export const metadata: Metadata = {
  title: 'ATS Draft',
  description: 'Weekly ATS draft with O/U tiebreakers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-white">
        <header className="border-b border-white/10">
          <div className="max-w-5xl mx-auto px-6 py-3 flex flex-wrap items-center gap-4 text-sm">
            <TinyLogo url="/nfl.png" alt="NFL" className="h-7 w-7" />
            <Link href="/" className="text-lg font-semibold">ATS Draft</Link>
            <NavLinks /> {/* ← replaces the hard-coded links */}
          </div>
        </header>
        <main className="pb-16">{children}</main>
      </body>
    </html>
  );
}
