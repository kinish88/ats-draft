'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ------------------------------- constants ------------------------------- */

const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* --------------------------------- types --------------------------------- */

type WeekRow = { id: number; season_year: number; week_number: number };

type PicksRow = {
  week_id: number;
  pick_number: number;
  player_display_name: string;
  team_short: string; // picked team short (e.g., PHI)
  spread_at_pick: number | null; // signed line for that team
  home_short: string;
  away_short: string;
};

type RpcGameRow = {
  game_id: number;
  home: string; // team short (e.g., PHI)
  away: string; // team short (e.g., DAL)
  home_score: number | null;
  away_score: number | null;
  kickoff?: string | null;
};

type GameMap = Map<string, RpcGameRow>;

type Totals = {
  weekWins: number;
  w: number;
  l: number;
  pu: number;
};

type SafeRec = Record<string, unknown>;

/* --------------------------------- utils --------------------------------- */

const norm = (s: string) => s.trim().toUpperCase();

function keyPair(home: string, away: string) {
  return `${norm(home)}-${norm(away)}`;
}
function toStr(x: unknown, fb = ''): string {
  return typeof x === 'string' ? x : x == null ? fb : String(x);
}
function toNumOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------ scoreboard ------------------------------- */

type Outcome = 'win' | 'loss' | 'push' | 'pending';

/** Determine ATS outcome for one pick given the final (or current live) score. */
function atsOutcome(
  game: RpcGameRow | undefined,
  pickedTeam: string,
  lineForPick: number | null
): Outcome {
  if (!game) return 'pending';
  if (lineForPick == null) return 'pending';

  const hs = toNumOrNull(game.home_score);
  const as = toNumOrNull(game.away_score);
  if (hs == null || as == null) return 'pending';

  const pickIsHome = norm(pickedTeam) === norm(game.home);
  const pickScore = pickIsHome ? hs : as;
  const oppScore = pickIsHome ? as : hs;

  const adj = pickScore + lineForPick;
  if (adj > oppScore) return 'win';
  if (adj < oppScore) return 'loss';
  return 'push';
}

/* --------------------------------- page ---------------------------------- */

export default function StandingsPage() {
  const [loading, setLoading] = useState(true);
  const [throughWeek, setThroughWeek] = useState<number>(1);

  // Totals by player
  const [totalsByPlayer, setTotalsByPlayer] = useState<Map<string, Totals>>(
    () =>
      new Map(
        PLAYERS.map((p) => [
          p,
          { weekWins: 0, w: 0, l: 0, pu: 0 } satisfies Totals,
        ])
      )
  );

  useEffect(() => {
    (async () => {
      setLoading(true);

      /* 1) Load **spread** picks joined to weeks so we know each pick’s week. */
      const { data: picksRows } = await supabase
        .from('picks')
        .select(
          'week_id, pick_number, player_display_name, team_short, spread_at_pick, home_short, away_short, weeks!inner(id,season_year,week_number)'
        )
        .eq('season_year', YEAR)
        .order('week_id', { ascending: true })
        .order('pick_number', { ascending: true });

      const picks: PicksRow[] = (Array.isArray(picksRows) ? picksRows : []).map(
        (r) => {
          const row = r as SafeRec;
          return {
            week_id: Number(row.week_id ?? 0),
            pick_number: Number(row.pick_number ?? 0),
            player_display_name: toStr(row.player_display_name),
            team_short: toStr(row.team_short),
            spread_at_pick: toNumOrNull(row.spread_at_pick),
            home_short: toStr(row.home_short),
            away_short: toStr(row.away_short),
          };
        }
      );

      // Also extract week_number for each week_id so we can call the right RPC week
      const weekIdToNum = new Map<number, number>();
      for (const r of (Array.isArray(picksRows) ? picksRows : []) as SafeRec[]) {
        const wk = r['weeks'] as SafeRec | undefined;
        const id = typeof r['week_id'] === 'number' ? (r['week_id'] as number) : null;
        const num =
          wk && typeof wk['week_number'] === 'number'
            ? (wk['week_number'] as number)
            : null;
        if (id != null && num != null) weekIdToNum.set(id, num);
      }

      // If no picks yet, we still want a clean table
      if (!picks.length) {
        setTotalsByPlayer(
          new Map(PLAYERS.map((p) => [p, { weekWins: 0, w: 0, l: 0, pu: 0 }]))
        );
        setThroughWeek(1);
        setLoading(false);
        return;
      }

      // what’s the last week number that appears among picks?
      const maxWeek = Math.max(...Array.from(weekIdToNum.values()));
      setThroughWeek(maxWeek > 0 ? maxWeek : 1);

      /* 2) Score, week by week, against **that same week’s games**. */
      const byWeekId = new Map<number, PicksRow[]>();
      for (const p of picks) {
        const list = byWeekId.get(p.week_id) ?? [];
        list.push(p);
        byWeekId.set(p.week_id, list);
      }

      const totals = new Map<string, Totals>(
        PLAYERS.map((p) => [p, { weekWins: 0, w: 0, l: 0, pu: 0 }])
      );

      for (const [weekId, list] of byWeekId) {
        const weekNum = weekIdToNum.get(weekId) ?? maxWeek; // fallback to maxWeek if somehow missing

        // Pull official scores for *this* week (fixes “only latest week showed” bug)
        const { data: gamesRows } = await supabase.rpc(
          'get_week_games_for_scoring',
          { p_year: YEAR, p_week: weekNum }
        );

        const gamesArr: RpcGameRow[] = (Array.isArray(gamesRows)
          ? gamesRows
          : []
        ).map((r) => {
          const o = r as SafeRec;
          return {
            game_id: Number(o.game_id ?? 0),
            home: toStr(o.home),
            away: toStr(o.away),
            home_score: toNumOrNull(o.home_score),
            away_score: toNumOrNull(o.away_score),
            kickoff: toStr(o.kickoff, null as unknown as string),
          };
        });

        const gameMap: GameMap = new Map();
        for (const g of gamesArr) gameMap.set(keyPair(g.home, g.away), g);

        // Tally for week-wins (3–0 only)
        const weekWinsTracker = new Map<string, { w: number; l: number; pu: number }>(
          PLAYERS.map((p) => [p, { w: 0, l: 0, pu: 0 }])
        );

        for (const p of list) {
          const player =
            (PLAYERS as readonly string[]).find(
              (n) => n.toLowerCase() === p.player_display_name.toLowerCase()
            ) ?? p.player_display_name;

          const gm = gameMap.get(keyPair(p.home_short, p.away_short));
          const outcome = atsOutcome(gm, p.team_short, p.spread_at_pick);

          const t = totals.get(player) ?? { weekWins: 0, w: 0, l: 0, pu: 0 };
          const wk = weekWinsTracker.get(player)!;

          if (outcome === 'win') {
            t.w += 1;
            wk.w += 1;
          } else if (outcome === 'loss') {
            t.l += 1;
            wk.l += 1;
          } else if (outcome === 'push') {
            t.pu += 1;
            wk.pu += 1;
          }
          totals.set(player, t);
          weekWinsTracker.set(player, wk);
        }

        // credit 1 “Week Win” only if player is 3–0 that week
        for (const [player, wk] of weekWinsTracker) {
          if (wk.w === 3 && wk.l === 0 && wk.pu === 0) {
            const t = totals.get(player)!;
            t.weekWins += 1;
            totals.set(player, t);
          }
        }
      }

      setTotalsByPlayer(totals);
      setLoading(false);
    })();
  }, []);

  /* ---------------------------- derived / render --------------------------- */

  const rows = useMemo(() => {
    return PLAYERS.map((name) => {
      const t = totalsByPlayer.get(name) ?? { weekWins: 0, w: 0, l: 0, pu: 0 };
      const denom = t.w + t.l + t.pu; // pushes count as losses in %
      const pct = denom > 0 ? (t.w / denom) * 100 : 0;
      return { name, ...t, pct };
    });
  }, [totalsByPlayer]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <header className="flex items-baseline justify-between mb-4">
        <h1 className="text-4xl font-semibold">Season Standings</h1>
        <div className="text-zinc-300">Through Week {throughWeek}</div>
      </header>

      <div className="border rounded overflow-hidden">
        {/* table head */}
        <div className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] bg-zinc-900/70 text-zinc-200 px-4 py-3 text-sm font-semibold">
          <div>PLAYER</div>
          <div className="text-center">WEEK WINS</div>
          <div className="text-center">ATS W</div>
          <div className="text-center">ATS L</div>
          <div className="text-center">ATS PU</div>
          <div className="text-center">WIN %</div>
        </div>

        {/* table body */}
        <div className="divide-y divide-zinc-800/70">
          {loading ? (
            <div className="px-4 py-6 text-sm text-zinc-400">Loading…</div>
          ) : (
            rows.map((r) => (
              <div
                key={r.name}
                className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] px-4 py-4 items-center"
              >
                <div className="font-semibold">{r.name}</div>
                <div className="text-center tabular-nums">{r.weekWins}</div>
                <div className="text-center tabular-nums">{r.w}</div>
                <div className="text-center tabular-nums">{r.l}</div>
                <div className="text-center tabular-nums">{r.pu}</div>
                <div className="text-center tabular-nums">
                  {r.pct.toFixed(1)}%
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="mt-4 text-sm text-zinc-400">Win% treats pushes as losses.</p>
    </div>
  );
}
