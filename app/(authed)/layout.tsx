'use client';

import type { ReactNode } from 'react';
import AuthGate from '@/components/AuthGate';
import AuthedFooter from '@/components/AuthedFooter';

export default function AuthedLayout({ children }: { children: ReactNode }) {
  // Any page placed under app/(authed)/... will be protected by AuthGate.
  return (
    <AuthGate>
      <div className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <AuthedFooter />
      </div>
    </AuthGate>
  );
}
