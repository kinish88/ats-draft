'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;
const PLAYERS = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* ------------------------------- types ------------------------------- */

type WeekRow = { week_number: number };

type WeekSummaryRow = {
  display_name: string;
  spread_wins: number;
  spread_losses: number;
  spread_pushes: number;
  ou_result: 'win' | 'loss' | 'push' | null;
};

type WeekSummaryUnknown = {
  display_name?: unknown;
  spread_wins?: unknown;
  spread_losses?: unknown;
  spread_pushes?: unknown;
  ou_result?: unknown;
};

type Totals = {
  weekWins: number;
  w: number;
  l: number;
  p: number;
};

/* ----------------------------- utilities ---------------------------- */

function toNum(x: unknown, def = 0): number {
  if (typeof x === 'number') return Number.isFinite(x) ? x : def;
  if (typeof x === 'string') {
    const n = Number(x);
    return Number.isFinite(n) ? n : def;
  }
  return def;
}
function toStr(x: unknown, def = ''): string {
  return typeof x === 'string' ? x : def;
}
function toOu(x: unknown): 'win' | 'loss' | 'push' | null {
  const s = typeof x === 'string' ? x.toLowerCase() : x;
  return s === 'win' || s === 'loss' || s === 'push' ? s : null;
}
function pct(w: number, l: number, p: number) {
  const games = w + l + p;
  if (!games) return '—';
  return `${((w / games) * 100).toFixed(1)}%`;
}

/* ------------------------------ component --------------------------- */

export default function SeasonStandingsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<
    Array<{ player: string; weekWins: number; w: number; l: number; p: number }>
  >([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const fetchSeason = useCallback(async () => {
    setLoading(true);
    try {
      // 1) Weeks: read directly from table for the season (no 'any')
      const { data: weeksRaw, error: weeksErr } = await supabase
        .from('weeks')
        .select('week_number')
        .eq('season_year', YEAR)
        .order('week_number', { ascending: true });

      if (weeksErr) console.error('weeks select error', weeksErr);

      const weeks: number[] = (weeksRaw ?? [])
        .map((w: WeekRow) => w.week_number)
        .filter((n: number) => Number.isFinite(n));

      // Seed totals
      const totals = new Map<string, Totals>();
      for (const name of PLAYERS) totals.set(name, { weekWins: 0, w: 0, l: 0, p: 0 });

      // 2) Iterate week-by-week
      for (const w of weeks) {
        // If you didn’t deploy v2 yet, change to 'get_week_summary'
        const { data, error } = await supabase.rpc('get_week_summary', {
          p_year: YEAR,
          p_week: w,
        });
        if (error) {
          console.error('get_week_summary_v2 error', { week: w, error });
          continue;
        }
        const arr = Array.isArray(data) ? (data as unknown[]) : [];

        const summary: WeekSummaryRow[] = arr.map((r) => {
          const u = r as WeekSummaryUnknown;
          return {
            display_name: toStr(u.display_name),
            spread_wins: toNum(u.spread_wins),
            spread_losses: toNum(u.spread_losses),
            spread_pushes: toNum(u.spread_pushes),
            ou_result: toOu(u.ou_result),
          };
        });

        // accumulate ATS tallies
        for (const r of summary) {
          const t = totals.get(r.display_name);
          if (!t) continue;
          t.w += r.spread_wins;
          t.l += r.spread_losses;
          t.p += r.spread_pushes;
        }

        // only award week wins if every player has 3 graded ATS picks
        const complete = summary.every(
          (r) => r.spread_wins + r.spread_losses + r.spread_pushes === 3
        );
        if (!complete) continue;

        const maxW = Math.max(...summary.map((r) => r.spread_wins));
        let contenders = summary.filter((r) => r.spread_wins === maxW);

        // tie-break with O/U where available
        if (contenders.length > 1) {
          const ouWinners = contenders.filter((r) => r.ou_result === 'win');
          if (ouWinners.length > 0) contenders = ouWinners;
        }

        for (const r of contenders) {
          const t = totals.get(r.display_name);
          if (t) t.weekWins += 1;
        }
      }

      const table = PLAYERS.map((name) => {
        const t = totals.get(name)!;
        return { player: name, ...t };
      }).sort((a, b) => {
        const byWeekWins = b.weekWins - a.weekWins;
        if (byWeekWins) return byWeekWins;
        const aPct = a.w / Math.max(1, a.w + a.l + a.p);
        const bPct = b.w / Math.max(1, b.w + b.l + b.p);
        return bPct - aPct;
      });

      setRows(table);
      setUpdatedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + live updates
  useEffect(() => {
    fetchSeason();

    const onFocus = () => fetchSeason();
    window.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);

    const channel = supabase
      .channel('standings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, () =>
        fetchSeason()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ou_picks' }, () =>
        fetchSeason()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () =>
        fetchSeason()
      )
      .subscribe();

    return () => {
      window.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
      supabase.removeChannel(channel);
    };
  }, [fetchSeason]);

  const subtitle = useMemo(() => {
    if (loading) return 'Loading…';
    if (!updatedAt) return '';
    return `Updated ${updatedAt.toLocaleTimeString()}`;
  }, [loading, updatedAt]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Season Standings</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs opacity-60">{subtitle}</span>
          <button
            onClick={fetchSeason}
            className="text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800"
            title="Refresh"
          >
            Refresh
          </button>
          <Link href="/">
            <span className="text-sm opacity-80 hover:opacity-100">← Back</span>
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left border-b border-zinc-700">
            <tr>
              <th className="py-2 pr-4">Player</th>
              <th className="py-2 pr-4">Week Wins</th>
              <th className="py-2 pr-4">ATS W</th>
              <th className="py-2 pr-4">ATS L</th>
              <th className="py-2 pr-4">ATS P</th>
              <th className="py-2 pr-4">Win %</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="py-3 text-zinc-400" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.player} className="border-b border-zinc-800">
                  <td className="py-2 pr-4">{r.player}</td>
                  <td className="py-2 pr-4">{r.weekWins}</td>
                  <td className="py-2 pr-4">{r.w}</td>
                  <td className="py-2 pr-4">{r.l}</td>
                  <td className="py-2 pr-4">{r.p}</td>
                  <td className="py-2 pr-4">{pct(r.w, r.l, r.p)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
