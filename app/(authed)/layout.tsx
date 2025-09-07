'use client';

import type { ReactNode } from 'react';
import AuthGate from '@/components/AuthGate';

export default function AuthedLayout({ children }: { children: ReactNode }) {
  // Any page placed under app/(authed)/... will be protected by AuthGate.
  return <AuthGate>{children}</AuthGate>;
}
