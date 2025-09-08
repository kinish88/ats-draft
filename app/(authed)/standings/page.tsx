'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;
const PLAYERS = ['Big Dawg', 'Pud', 'Kinish'] as const;

type WeekRow = { week_number: number };

type WeekSummaryRow = {
  display_name: string;
  spread_wins: number;
  spread_losses: number;
  spread_pushes: number;
  ou_result: 'win' | 'loss' | 'push' | null;
};

type Totals = {
  weekWins: number;
  w: number;
  l: number;
  p: number;
};

function pct(w: number, l: number, p: number) {
  const games = w + l + p;
  if (!games) return '—';
  return `${((w / games) * 100).toFixed(1)}%`;
}

export default function SeasonStandingsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Array<{ player: string; weekWins: number; w: number; l: number; p: number }>>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // 1) Which weeks exist?
      const { data: weeksRaw } = await supabase.rpc('list_weeks', { p_year: YEAR });
      const weeks: number[] =
        (Array.isArray(weeksRaw) ? weeksRaw : [])
          .map((w: any) => (typeof w?.week_number === 'number' ? w.week_number : null))
          .filter((n: number | null): n is number => n !== null) || [];

      // seed totals for each player
      const totals = new Map<string, Totals>();
      for (const name of PLAYERS) totals.set(name, { weekWins: 0, w: 0, l: 0, p: 0 });

      // 2) Roll through the season week-by-week
      for (const w of weeks) {
        const { data } = await supabase.rpc('get_week_summary', { p_year: YEAR, p_week: w });
        const summary: WeekSummaryRow[] = (Array.isArray(data) ? data : []).map((r: any) => ({
          display_name: String(r?.display_name ?? ''),
          spread_wins: Number(r?.spread_wins ?? 0),
          spread_losses: Number(r?.spread_losses ?? 0),
          spread_pushes: Number(r?.spread_pushes ?? 0),
          ou_result: r?.ou_result ?? null,
        }));

        // accumulate ATS tallies regardless of completeness
        for (const r of summary) {
          const t = totals.get(r.display_name);
          if (!t) continue;
          t.w += r.spread_wins;
          t.l += r.spread_losses;
          t.p += r.spread_pushes;
        }

        // award week wins only if every player has all 3 ATS results
        const complete = summary.every(
          (r) => r.spread_wins + r.spread_losses + r.spread_pushes === 3
        );
        if (!complete) continue;

        // find ATS leaders
        const maxW = Math.max(...summary.map((r) => r.spread_wins));
        let contenders = summary.filter((r) => r.spread_wins === maxW);

        if (contenders.length > 1) {
          // break ties with O/U: prefer ou_result === 'win'
          const ouWinners = contenders.filter((r) => r.ou_result === 'win');
          if (ouWinners.length > 0) contenders = ouWinners;
          // if still tied (or missing O/U), they all share the week win
        }

        for (const r of contenders) {
          const t = totals.get(r.display_name);
          if (t) t.weekWins += 1;
        }
      }

      // shape rows
      const table = PLAYERS.map((name) => {
        const t = totals.get(name)!;
        return { player: name, ...t };
      }).sort((a, b) => (b.weekWins - a.weekWins) || ((b.w / Math.max(1, b.w + b.l + b.p)) - (a.w / Math.max(1, a.w + a.l + a.p))));

      setRows(table);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Season Standings</h1>
        <Link href="/"><span className="text-sm opacity-80 hover:opacity-100">← Back</span></Link>
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
              <tr><td className="py-3 text-zinc-400" colSpan={6}>Loading…</td></tr>
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
