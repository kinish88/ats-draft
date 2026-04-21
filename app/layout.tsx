// app/layout.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import NavLinks from '@/components/NavLinks';
import { NFL_LOGO_URL } from '@/lib/logos';

export const metadata: Metadata = {
  title: 'ATS',
  description: 'Against The Spread — Weekly draft with BD, PuD & K',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ATS',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* PWA / iOS */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ATS" />
        <meta name="theme-color" content="#09090b" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icon-152.png" />
        <link rel="apple-touch-icon" sizes="167x167" href="/icon-167.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />
        <link rel="manifest" href="/manifest.json" />
        {/* Register service worker */}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js');
            });
          }
        `}} />
      </head>
      <body className="min-h-screen text-white">
        <header className="border-b border-white/10">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {NFL_LOGO_URL ? (
                <img src={NFL_LOGO_URL} alt="NFL shield" className="h-7 w-7 rounded-sm border border-white/10" />
              ) : null}
              <Link href="/" className="font-semibold">ATS</Link>
            </div>
            <NavLinks />
          </div>
        </header>
        <main className="pb-16">{children}</main>
      </body>
    </html>
  );
}
