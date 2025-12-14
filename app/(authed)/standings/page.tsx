'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import ControlBar from '@/components/ControlBar';

/* ------------------------------- constants ------------------------------- */

const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* --------------------------------- types --------------------------------- */

type PickRow = {
  player_display_name: string;
  team_short: string;
  spread_at_pick: number | null;
  home_short: string;
  away_short: string;
  week_id: number;
  game_id: number | null;
};

type GameRow = {
  id: number;
  home_score: number | null;
  away_score: number | null;
  live_home_score: number | null;
  live_away_score: number | null;
  is_final: boolean | null;
  is_live: boolean | null;
};

type WeekRow = { id: number; week_number: number };

type Outcome = 'win' | 'loss' | 'push' | 'pending';

type TableRow = {
  name: string;
  weekWins: number;
  w: number;
  l: number;
  pu: number;
  pct: string; // "57.1%"
};

/* --------------------------------- utils --------------------------------- */

const norm = (s: string) => s.trim().toLowerCase();

function numOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function outcomeATS(game: GameRow | undefined, pickedTeamIsHome: boolean, spread: number | null): Outcome {
  if (!game) return 'pending';

  const hasFinal = game.home_score != null && game.away_score != null;
  const hasLive = game.live_home_score != null && game.live_away_score != null;

  const home = hasFinal ? game.home_score : hasLive ? game.live_home_score : null;
  const away = hasFinal ? game.away_score : hasLive ? game.live_away_score : null;

  if (home == null || away == null) return 'pending';
  if (spread == null) return 'pending';

  const pickScore = pickedTeamIsHome ? (home ?? 0) : (away ?? 0);
  const oppScore = pickedTeamIsHome ? (away ?? 0) : (home ?? 0);
  const adj = pickScore + spread;

  if (adj > oppScore) return 'win';
  if (adj < oppScore) return 'loss';
  return 'push';
}

/* --------------------------------- page ---------------------------------- */

export default function StandingsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [throughWeek, setThroughWeek] = useState<number>(1);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // 1) Pull all spread picks for the season
      const { data: pickData } = await supabase
        .from('picks')
        .select(
          'player_display_name, team_short, spread_at_pick, home_short, away_short, week_id, game_id'
        )
        .eq('season_year', YEAR);

      const picksRaw: unknown[] = Array.isArray(pickData) ? (pickData as unknown[]) : [];
      const picks: PickRow[] = picksRaw.map((r) => {
        const o = r as Record<string, unknown>;
        return {
          player_display_name: String(o.player_display_name ?? ''),
          team_short: String(o.team_short ?? ''),
          spread_at_pick: numOrNull(o.spread_at_pick),
          home_short: String(o.home_short ?? ''),
          away_short: String(o.away_short ?? ''),
          week_id: Number(o.week_id ?? 0),
          game_id: numOrNull(o.game_id),
        };
      });

      // Nothing yet? Render empty table nicely.
      if (picks.length === 0) {
        setRows(
          PLAYERS.map((name) => ({
            name,
            weekWins: 0,
            w: 0,
            l: 0,
            pu: 0,
            pct: '0.0%',
          }))
        );
        setThroughWeek(1);
        setLoading(false);
        return;
      }

      // 2) Fetch games referenced by those picks
      const gameIds = Array.from(
        new Set(picks.map((p) => p.game_id).filter((id): id is number => typeof id === 'number'))
      );
      let gameById = new Map<number, GameRow>();
      if (gameIds.length) {
        const { data: gData } = await supabase
          .from('games')
          .select(
            'id, home_score, away_score, live_home_score, live_away_score, is_final, is_live'
          )
          .in('id', gameIds);

        const arr: unknown[] = Array.isArray(gData) ? (gData as unknown[]) : [];
        gameById = new Map<number, GameRow>();
        for (const r of arr) {
          const o = r as Record<string, unknown>;
          const id = Number(o.id ?? 0);
          if (!id) continue;
          gameById.set(id, {
            id,
            home_score: numOrNull(o.home_score),
            away_score: numOrNull(o.away_score),
            live_home_score: numOrNull(o.live_home_score),
            live_away_score: numOrNull(o.live_away_score),
            is_final: typeof o.is_final === 'boolean' ? (o.is_final as boolean) : null,
            is_live: typeof o.is_live === 'boolean' ? (o.is_live as boolean) : null,
          });
        }
      }

      // 3) Determine "Through Week" as the max week_number that has any picks
      const weekIds = Array.from(new Set(picks.map((p) => p.week_id).filter((x) => x)));
      let maxWeek = 1;
      if (weekIds.length) {
        const { data: wData } = await supabase
          .from('weeks')
          .select('id, week_number')
          .in('id', weekIds);

        const wArr: unknown[] = Array.isArray(wData) ? (wData as unknown[]) : [];
        const weekMap = new Map<number, number>();
        for (const r of wArr) {
          const o = r as Record<string, unknown>;
          const id = Number(o.id ?? 0);
          const wn = Number(o.week_number ?? 0);
          if (id) weekMap.set(id, wn);
        }
        maxWeek = Math.max(...Array.from(weekMap.values()), 1);
      }
      setThroughWeek(maxWeek);

      // 4) Compute outcomes + aggregates
      //    - Wins/Losses/Pushes consider only games with a decided outcome
      //    - WeekWins: credit a week if that player's 3 picks are all wins
      type Agg = {
        w: number;
        l: number;
        pu: number;
        // week_id -> 'win'|'loss'|'push' for each of 3 picks
        perWeek: Map<number, Outcome[]>;
      };
      const byPlayer = new Map<string, Agg>();
      for (const name of PLAYERS) {
        byPlayer.set(name, { w: 0, l: 0, pu: 0, perWeek: new Map() });
      }

      for (const p of picks) {
        // Only track for the three league players
        const canonical =
          PLAYERS.find((n) => norm(n) === norm(p.player_display_name)) ?? null;
        if (!canonical) continue;

        const g = p.game_id ? gameById.get(p.game_id) : undefined;
        const pickedHome = norm(p.team_short) === norm(p.home_short);
        const oc = outcomeATS(g, pickedHome, p.spread_at_pick);

        if (oc !== 'pending') {
          const agg = byPlayer.get(canonical)!;
          if (oc === 'win') agg.w += 1;
          else if (oc === 'loss') agg.l += 1;
          else agg.pu += 1;

          const arr = agg.perWeek.get(p.week_id) ?? [];
          arr.push(oc);
          agg.perWeek.set(p.week_id, arr);
        }
      }

      const out: TableRow[] = [];
      for (const name of PLAYERS) {
        const agg = byPlayer.get(name)!;

        // Count "week wins": exactly 3 picks and all wins
        let weekWins = 0;
        for (const [, arr] of agg.perWeek) {
          if (arr.length === 3 && arr.every((x) => x === 'win')) weekWins += 1;
        }

        const total = agg.w + agg.l + agg.pu;
        const pct =
          total > 0 ? `${((agg.w / total) * 100).toFixed(1)}%` : '0.0%';

        out.push({
          name,
          weekWins,
          w: agg.w,
          l: agg.l,
          pu: agg.pu,
          pct,
        });
      }

      setRows(out);
      setLoading(false);
    })();
  }, []);

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      <ControlBar />
      <header className="flex items-baseline justify-between mb-4">
        <h1 className="text-4xl font-semibold">Season Standings</h1>
        <div className="text-zinc-300">Through Week {throughWeek}</div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border rounded overflow-hidden">
          <thead className="bg-zinc-900/70 text-zinc-200">
            <tr>
              <th className="px-4 py-3 text-left">PLAYER</th>
              <th className="px-4 py-3 text-center">WEEK WINS</th>
              <th className="px-4 py-3 text-center">ATS W</th>
              <th className="px-4 py-3 text-center">ATS L</th>
              <th className="px-4 py-3 text-center">ATS PU</th>
              <th className="px-4 py-3 text-center">WIN %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-sm text-zinc-400" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.name} className="hover:bg-zinc-900/30">
                  <td className="px-4 py-4 font-semibold">{r.name}</td>
                  <td className="px-4 py-4 text-center tabular-nums">{r.weekWins}</td>
                  <td className="px-4 py-4 text-center tabular-nums">{r.w}</td>
                  <td className="px-4 py-4 text-center tabular-nums">{r.l}</td>
                  <td className="px-4 py-4 text-center tabular-nums">{r.pu}</td>
                  <td className="px-4 py-4 text-center tabular-nums">{r.pct}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm text-zinc-400">Win% treats pushes as losses.</p>
    </div>
  );
}
