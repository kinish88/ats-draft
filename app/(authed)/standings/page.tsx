'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;

type WeekRow = { week_number: number };
type WeekSummaryRow = {
  display_name: string;
  spread_wins: number;
  spread_losses: number;
  spread_pushes: number;
  ou_result: string | null;
  is_gold_winner: boolean | null;
  is_ou_winner: boolean | null;
};

type Totals = {
  player: string;
  weekWins: number;
  atsW: number;
  atsL: number;
  atsP: number;
};

export default function SeasonStandingsPage() {
  const [rows, setRows] = useState<Totals[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // which weeks exist?
      const { data: weekList } = await supabase.rpc('list_weeks', { p_year: YEAR });
      const weeks =
        (Array.isArray(weekList) ? (weekList as WeekRow[]).map((w) => w.week_number) : []) || [1];

      // fetch each week's summary
      const results = await Promise.all(
        weeks.map((w) => supabase.rpc('get_week_summary', { p_year: YEAR, p_week: w })),
      );

      // aggregate
      const byPlayer = new Map<string, Totals>();
      for (let i = 0; i < results.length; i++) {
        const week = weeks[i];
        const sum = (results[i].data as WeekSummaryRow[]) || [];

        // weekly winner: most ATS wins, tie broken by is_ou_winner
        if (sum.length) {
          const top = Math.max(...sum.map(r => r.spread_wins));
const cands = sum.filter(r => r.spread_wins === top);
const winners = cands.some(r => r.is_ou_winner) ? cands.filter(r => r.is_ou_winner) : cands;
const winnerNames = new Set(winners.map(w => w.display_name));

for (const r of sum) {
  const key = r.display_name;
  const prev = byPlayer.get(key) || { player: key, weekWins: 0, atsW: 0, atsL: 0, atsP: 0 };
  const next = {
    player: key,
    weekWins: prev.weekWins + (winnerNames.has(key) ? 1 : 0),
    atsW: prev.atsW + (r.spread_wins || 0),
    atsL: prev.atsL + (r.spread_losses || 0),
    atsP: prev.atsP + (r.spread_pushes || 0),
  };
  byPlayer.set(key, next);
}

        }
      }

      setRows(Array.from(byPlayer.values()).sort((a, b) => b.weekWins - a.weekWins));
      setLoading(false);
    };

    load();
  }, []);

  const withPct = useMemo(
    () =>
      rows.map((r) => {
        const denom = r.atsW + r.atsL;
        const pct = denom > 0 ? (r.atsW / denom) * 100 : 0;
        return { ...r, pct: Math.round(pct * 10) / 10 };
      }),
    [rows],
  );

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Season Standings</h1>
        <Link href="/scoreboard" className="text-sm text-zinc-300 hover:underline">
          ← Back
        </Link>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-400">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-300">
              <tr>
                <th className="py-2 pr-3">Player</th>
                <th className="py-2 px-3">Week Wins</th>
                <th className="py-2 px-3">ATS W</th>
                <th className="py-2 px-3">ATS L</th>
                <th className="py-2 px-3">ATS P</th>
                <th className="py-2 px-3">Win %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-700/60">
              {withPct.map((r) => (
                <tr key={r.player}>
                  <td className="py-2 pr-3 font-medium">{r.player}</td>
                  <td className="py-2 px-3 tabular-nums">{r.weekWins}</td>
                  <td className="py-2 px-3 tabular-nums">{r.atsW}</td>
                  <td className="py-2 px-3 tabular-nums">{r.atsL}</td>
                  <td className="py-2 px-3 tabular-nums">{r.atsP}</td>
                  <td className="py-2 px-3 tabular-nums">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
