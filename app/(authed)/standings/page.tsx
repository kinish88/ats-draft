'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* ------------------------------- types ----------------------------------- */

type PickRow = {
  id: number;
  player_display_name: string;
  team_short: string;       // picked team
  spread_at_pick: number | null;
  game_id: number;
};

type GameRow = {
  id: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  live_home_score: number | null;
  live_away_score: number | null;
  is_final: boolean | null;
  is_live: boolean | null;
};

type Totals = { weekWins: number; w: number; l: number; p: number };

/* -------------------------------- utils ---------------------------------- */

const toNum = (x: unknown, fb = 0) =>
  typeof x === 'number' && Number.isFinite(x) ? x : fb;

const toStr = (x: unknown, fb = '') =>
  typeof x === 'string' ? x : x == null ? fb : String(x);

const norm = (s: string) => s.trim().toLowerCase();

/** For standings we only count **final** outcomes (live/pending don’t move totals). */
function outcomeATS(g: GameRow | undefined, picked: string, spread: number | null):
  'win' | 'loss' | 'push' | 'pending'
{
  if (!g || g.home_score == null || g.away_score == null || spread == null) return 'pending';

  const pickIsHome = picked === g.home;
  const ps = pickIsHome ? g.home_score : g.away_score;
  const os = pickIsHome ? g.away_score : g.home_score;

  const adj = ps + spread;
  if (adj > os) return 'win';
  if (adj < os) return 'loss';
  return 'push';
}

/** latest week_id with any picks this season (auto “through week”). */
async function getThroughWeek(): Promise<number> {
  const { data } = await supabase
    .from('picks')
    .select('week_id')
    .eq('season_year', YEAR)
    .order('week_id', { ascending: false })
    .limit(1)
    .maybeSingle();

  return typeof data?.week_id === 'number' ? data.week_id : 1;
}

/* -------------------------------- page ----------------------------------- */

export default function StandingsPage() {
  const [loading, setLoading] = useState(true);
  const [throughWeek, setThroughWeek] = useState<number>(1);
  const [rows, setRows] = useState<
    Array<{ player: string; weekWins: number; w: number; l: number; p: number }>
  >([]);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const thru = await getThroughWeek();
      setThroughWeek(thru);

      // Seed season totals
      const totals = new Map<string, Totals>();
      for (const name of PLAYERS) totals.set(name, { weekWins: 0, w: 0, l: 0, p: 0 });

      // Loop weeks 1..throughWeek and aggregate
      for (let wnum = 1; wnum <= thru; wnum++) {
        // Pull all spread picks for the week
        const { data: pickRows } = await supabase
          .from('picks')
          .select('id, player_display_name, team_short, spread_at_pick, game_id')
          .eq('season_year', YEAR)
          .eq('week_id', wnum);

        const picks: PickRow[] = (Array.isArray(pickRows) ? pickRows : [])
          .map((r) => ({
            id: toNum((r as any).id),
            player_display_name: toStr((r as any).player_display_name),
            team_short: toStr((r as any).team_short),
            spread_at_pick: (r as any).spread_at_pick ?? null,
            game_id: toNum((r as any).game_id),
          }))
          .filter((p) => p.id && p.game_id);

        if (!picks.length) continue;

        // Fetch the games touched this week
        const ids = Array.from(new Set(picks.map((p) => p.game_id)));
        const { data: gameRows } = await supabase
          .from('games')
          .select(
            'id,home,away,home_score,away_score,live_home_score,live_away_score,is_final,is_live'
          )
          .in('id', ids);

        const games = new Map<number, GameRow>();
        for (const r of (Array.isArray(gameRows) ? gameRows : [])) {
          const g = r as any;
          games.set(toNum(g.id), {
            id: toNum(g.id),
            home: toStr(g.home),
            away: toStr(g.away),
            home_score: g.home_score ?? null,
            away_score: g.away_score ?? null,
            live_home_score: g.live_home_score ?? null,
            live_away_score: g.live_away_score ?? null,
            is_final: g.is_final ?? null,
            is_live: g.is_live ?? null,
          });
        }

        // Tally weekly results per player (count **finals only**)
        const weekly = new Map<string, { w: number; l: number; p: number }>();
        for (const name of PLAYERS) weekly.set(name, { w: 0, l: 0, p: 0 });

        for (const pick of picks) {
          const player =
            (PLAYERS as readonly string[]).find(
              (n) => norm(n) === norm(pick.player_display_name)
            ) ?? pick.player_display_name;

          const g = games.get(pick.game_id);
          const res = outcomeATS(g, pick.team_short, pick.spread_at_pick);

          if (res === 'pending') continue; // don’t count non-final picks

          const w = weekly.get(player) || { w: 0, l: 0, p: 0 };
          if (res === 'win') w.w += 1;
          else if (res === 'loss') w.l += 1;
          else w.p += 1;
          weekly.set(player, w);
        }

        // Apply weekly results to season totals
        for (const [player, wk] of weekly) {
          const t = totals.get(player);
          if (!t) continue;
          t.w += wk.w;
          t.l += wk.l;
          t.p += wk.p;
        }

        // Week Win(s): any player who went 3–0 this week (no O/U involved)
        for (const [player, wk] of weekly) {
          if (wk.w === 3) {
            const t = totals.get(player);
            if (t) t.weekWins += 1;
          }
        }
      }

      // Build & sort the table
      const table = PLAYERS.map((player) => {
        const t = totals.get(player)!;
        return { player, ...t };
      }).sort((a, b) => {
        // primary: Week Wins
        if (b.weekWins !== a.weekWins) return b.weekWins - a.weekWins;
        // secondary: Win% (pushes count as losses in the rate)
        const aDen = a.w + a.l + a.p;
        const bDen = b.w + b.l + b.p;
        const aPct = aDen ? a.w / aDen : 0;
        const bPct = bDen ? b.w / bDen : 0;
        return bPct - aPct;
      });

      setRows(table);
      setLoading(false);
    })();
  }, []);

  const displayRows = useMemo(() => {
    return rows.map((r) => {
      const played = r.w + r.l + r.p;           // pushes treated as losses in % (i.e., part of denominator)
      const pct = played ? r.w / played : 0;
      return { ...r, pct };
    });
  }, [rows]);

  /* --------------------------------- UI ----------------------------------- */

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-semibold">Season Standings</h1>
        <div className="text-sm text-zinc-400">Through Week {throughWeek}</div>
      </header>

      <div className="overflow-x-auto border rounded">
        <table className="min-w-full text-left">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide border-b">
            <tr>
              <th className="px-4 py-2">Player</th>
              <th className="px-4 py-2">Week Wins</th>
              <th className="px-4 py-2">ATS W</th>
              <th className="px-4 py-2">ATS L</th>
              <th className="px-4 py-2">ATS PU</th>
              <th className="px-4 py-2">Win %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-zinc-400">
                  Calculating…
                </td>
              </tr>
            ) : displayRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-zinc-400">
                  No data yet.
                </td>
              </tr>
            ) : (
              displayRows.map((r) => (
                <tr key={r.player}>
                  <td className="px-4 py-3 font-medium">{r.player}</td>
                  <td className="px-4 py-3 tabular-nums">{r.weekWins}</td>
                  <td className="px-4 py-3 tabular-nums">{r.w}</td>
                  <td className="px-4 py-3 tabular-nums">{r.l}</td>
                  <td className="px-4 py-3 tabular-nums">{r.p}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {(r.pct * 100).toFixed(1)}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-zinc-400 mt-3">
        Win% treats pushes as losses.
      </p>
    </div>
  );
}
