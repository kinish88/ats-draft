'use client';

import { useEffect, useMemo, useState } from 'react';

const TARGET_DATE = new Date('2026-09-09T20:20:00-04:00'); // NFL Kickoff, Seattle, 8:20pm ET

type Remaining = {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const clampRemaining = (ms: number): Remaining => {
  const clamped = Math.max(ms, 0);
  const totalSeconds = Math.floor(clamped / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { totalMs: clamped, days, hours, minutes, seconds };
};

export default function CountdownBanner({ className }: { className?: string }) {
  const [remaining, setRemaining] = useState<Remaining>(() =>
    clampRemaining(TARGET_DATE.getTime() - Date.now())
  );

  useEffect(() => {
    const iv = setInterval(() => {
      setRemaining(clampRemaining(TARGET_DATE.getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const label = useMemo(() => {
    if (remaining.totalMs <= 0) return '🏈 The 2026 NFL Season is here!';
    const parts = [];
    if (remaining.days > 0) parts.push(`${remaining.days}d`);
    parts.push(`${remaining.hours}h`, `${remaining.minutes}m`, `${remaining.seconds}s`);
    return `🏈 NFL 2026 Kickoff — ${parts.join(' ')} to go`;
  }, [remaining]);

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-zinc-400 text-center ${className ?? ''}`}>
      {label}
    </div>
  );
}