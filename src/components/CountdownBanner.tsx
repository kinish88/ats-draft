'use client';

import { useEffect, useMemo, useState } from 'react';

const TARGET_DATE = new Date('2025-12-19T18:00:00Z');

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

const getRemaining = (): Remaining => clampRemaining(TARGET_DATE.getTime() - Date.now());

export default function CountdownBanner() {
  const [remaining, setRemaining] = useState<Remaining>(() => getRemaining());
  const expired = remaining.totalMs <= 0;

  useEffect(() => {
    if (expired) return;
    const timer = setInterval(() => {
      const next = getRemaining();
      if (next.totalMs <= 0) {
        setRemaining(next);
        clearInterval(timer);
      } else {
        setRemaining(next);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expired]);

  const formatted = useMemo(() => {
    if (expired) return { full: 'Time!', short: 'Time!' };
    const { days, hours, minutes, seconds } = remaining;

    const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
    return {
      full: `${plural(days, 'day')} ${plural(hours, 'hour')} ${plural(minutes, 'minute')} ${plural(seconds, 'second')}`,
      short: `${days}d ${hours}h ${minutes}m ${seconds}s`,
    };
  }, [expired, remaining]);

  return (
    <div className="px-4 sm:px-6">
      <div
        aria-live="polite"
        role="status"
        className={[
          'mx-auto w-full rounded-lg border px-4 py-2 text-center text-xs sm:text-sm transition-colors duration-300',
          expired
            ? 'border-emerald-500/60 bg-emerald-900/10 text-emerald-300'
            : 'border-white/10 bg-gradient-to-r from-slate-950/80 via-slate-900/70 to-slate-950/80 text-slate-100',
        ].join(' ')}
      >
        <span className="font-medium">China Garden — </span>
        <time dateTime={TARGET_DATE.toISOString()}>
          <span className="sm:hidden">{formatted.short}</span>
          <span className="hidden sm:inline">{formatted.full}</span>
        </time>
      </div>
    </div>
  );
}
