// app/layout.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import NavLinks from '@/components/NavLinks';

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
          <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between gap-4">
            <Link href="/">
              <img
                src="/apple-touch-icon.png"
                alt="Against The Spread"
                className="h-10 w-10 rounded-xl"
              />
            </Link>
            <NavLinks />
          </div>
        </header>
        <main className="pb-16">{children}</main>
      </body>
    </html>
  );
}