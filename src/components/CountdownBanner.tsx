'use client';

import { useEffect, useMemo, useState } from 'react';

// Super Bowl LX – Feb 8, 2026 @ 6:30 PM ET (23:30 UTC)
const TARGET_DATE = new Date('2026-02-08T23:30:00Z');

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

interface CountdownBannerProps {
  className?: string;
}

export default function CountdownBanner({ className }: CountdownBannerProps = {}) {
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
    <div
      aria-live="polite"
      role="status"
      className={[
        'inline-flex min-h-[2.5rem] w-full items-center justify-center rounded-2xl border px-4 text-center text-xs font-medium tracking-wide text-slate-100 sm:text-sm transition-colors duration-300',
        expired
          ? 'border-emerald-500/60 bg-emerald-900/20 text-emerald-200'
          : 'border-white/10 bg-gradient-to-r from-slate-950/80 via-slate-900/70 to-slate-950/80 text-slate-100',
        className || '',
      ].join(' ')}
    >
      <span className="font-medium">The Super Bowl LX -&nbsp;</span>
      <time dateTime={TARGET_DATE.toISOString()}>
        <span className="sm:hidden">{formatted.short}</span>
        <span className="hidden sm:inline">{formatted.full}</span>
      </time>
    </div>
  );
}
