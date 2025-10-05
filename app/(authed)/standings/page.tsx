'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* ------------------------------- types ----------------------------------- */

type WeekRow = { id: number; week_number: number; season_year: number };

type PickRow = {
  id: number;
  player_display_name: string;
  team_short: string;
  spread_at_pick: number | null;
  game_id: number;
};

type GameRow = {
  id: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  is_final: boolean | null;
};

type Totals = { weekWins: number; w: number; l: number; p: number };

/* -------------------------------- utils ---------------------------------- */

const toNum = (x: unknown): number | null =>
  typeof x === 'number' && Number.isFinite(x) ? x : null;

const toStr = (x: unknown): string => (typeof x === 'string' ? x : '');

const toBool = (x: unknown): boolean | null =>
  typeof x === 'boolean' ? x : null;

const asRec = (x: unknown): Record<string, unknown> =>
  (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;

const norm = (s: string) => s.trim().toLowerCase();

function outcomeATS(
  g: GameRow | undefined,
  picked: string,
  spread: number | null
): 'win' | 'loss' | 'push' | 'pending' {
  if (!g || g.home_score == null || g.away_score == null || spread == null) {
    return 'pending';
  }
  const pickIsHome = picked === g.home;
  const ps = pickIsHome ? g.home_score : g.away_score;
  const os = pickIsHome ? g.away_score : g.home_score;

  const adj = ps + spread;
  if (adj > os) return 'win';
  if (adj < os) return 'loss';
  return 'push';
}

/* -------------------------------- page ----------------------------------- */

export default function StandingsPage() {
  const [loading, setLoading] = useState(true);
  const [throughWeekNumber, setThroughWeekNumber] = useState<number>(1);
  const [rows, setRows] = useState<
    Array<{ player: string; weekWins: number; w: number; l: number; p: number }>
  >([]);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // 0) Load weeks for this season to build id <-> number mapping
      const { data: wkRows } = await supabase
        .from('weeks')
        .select('id,week_number,season_year')
        .eq('season_year', YEAR);

      const weeks: WeekRow[] = (Array.isArray(wkRows) ? wkRows : [])
        .map((r) => {
          const o = asRec(r);
          const id = toNum(o.id) ?? 0;
          const week_number = toNum(o.week_number) ?? 0;
          const season_year = toNum(o.season_year) ?? 0;
          return { id, week_number, season_year };
        })
        .filter((w) => w.id > 0 && w.week_number > 0);

      const idByNumber = new Map<number, number>();
      const numberById = new Map<number, number>();
      for (const w of weeks) {
        idByNumber.set(w.week_number, w.id);
        numberById.set(w.id, w.week_number);
      }

      // Determine latest week NUMBER with any picks
      const { data: lastPick } = await supabase
        .from('picks')
        .select('week_id')
        .eq('season_year', YEAR)
        .order('week_id', { ascending: false })
        .limit(1)
        .maybeSingle();

      const latestWeekId =
        typeof lastPick?.week_id === 'number' ? (lastPick.week_id as number) : null;
      const latestWeekNumber =
        latestWeekId != null ? numberById.get(latestWeekId) ?? 1 : 1;
      setThroughWeekNumber(latestWeekNumber);

      // 1) Seed season totals
      const totals = new Map<string, Totals>();
      for (const name of PLAYERS) totals.set(name, { weekWins: 0, w: 0, l: 0, p: 0 });

      // 2) Loop week numbers 1..through and aggregate using week IDs
      for (let weekNum = 1; weekNum <= latestWeekNumber; weekNum++) {
        const wid = idByNumber.get(weekNum);
        if (!wid) continue;

        // A) spread picks for this week id
        const { data: pickRows } = await supabase
          .from('picks')
          .select('id,player_display_name,team_short,spread_at_pick,game_id')
          .eq('season_year', YEAR)
          .eq('week_id', wid);

        const picks: PickRow[] = (Array.isArray(pickRows) ? pickRows : [])
          .map((r) => {
            const rec = asRec(r);
            const id = toNum(rec.id);
            const game_id = toNum(rec.game_id);
            return {
              id: id ?? 0,
              player_display_name: toStr(rec.player_display_name),
              team_short: toStr(rec.team_short),
              spread_at_pick:
                typeof rec.spread_at_pick === 'number'
                  ? (rec.spread_at_pick as number)
                  : null,
              game_id: game_id ?? 0,
            };
          })
          .filter((p) => p.id > 0 && p.game_id > 0);

        if (!picks.length) continue;

        // B) fetch those games
        const ids = Array.from(new Set(picks.map((p) => p.game_id)));
        const { data: gameRows } = await supabase
          .from('games')
          .select('id,home,away,home_score,away_score,is_final')
          .in('id', ids);

        const gameMap = new Map<number, GameRow>();
        for (const r of (Array.isArray(gameRows) ? gameRows : [])) {
          const rec = asRec(r);
          const id = toNum(rec.id);
          if (id == null) continue;
          gameMap.set(id, {
            id,
            home: toStr(rec.home),
            away: toStr(rec.away),
            home_score: toNum(rec.home_score),
            away_score: toNum(rec.away_score),
            is_final: toBool(rec.is_final),
          });
        }

        // C) weekly tallies
        const weekly = new Map<string, { w: number; l: number; p: number }>();
        for (const name of PLAYERS) weekly.set(name, { w: 0, l: 0, p: 0 });

        for (const pick of picks) {
          const player =
            (PLAYERS as readonly string[]).find(
              (n) => norm(n) === norm(pick.player_display_name)
            ) ?? pick.player_display_name;

          const g = gameMap.get(pick.game_id);
          const res = outcomeATS(g, pick.team_short, pick.spread_at_pick);

          if (res === 'pending') continue; // don’t count non-final
          const w = weekly.get(player) || { w: 0, l: 0, p: 0 };
          if (res === 'win') w.w += 1;
          else if (res === 'loss') w.l += 1;
          else w.p += 1;
          weekly.set(player, w);
        }

        // D) commit weekly -> season totals
        for (const [player, wk] of weekly) {
          const t = totals.get(player);
          if (!t) continue;
          t.w += wk.w;
          t.l += wk.l;
          t.p += wk.p;
        }

        // E) award week wins (3–0 only)
        for (const [player, wk] of weekly) {
          if (wk.w === 3) {
            const t = totals.get(player);
            if (t) t.weekWins += 1;
          }
        }
      }

      // 3) build table
      const table = PLAYERS.map((player) => {
        const t = totals.get(player)!;
        return { player, ...t };
      }).sort((a, b) => {
        if (b.weekWins !== a.weekWins) return b.weekWins - a.weekWins;
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
      const played = r.w + r.l + r.p; // pushes included (treated as losses)
      const pct = played ? r.w / played : 0;
      return { ...r, pct };
    });
  }, [rows]);

  /* --------------------------------- UI ----------------------------------- */

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-semibold">Season Standings</h1>
        <div className="text-sm text-zinc-400">Through Week {throughWeekNumber}</div>
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
