'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ----------------------------- league settings ---------------------------- */

const YEAR = 2025;
const PLAYERS_ORDERED = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* ---------------------------------- types --------------------------------- */

type PickRow = {
  player_display_name: string;
  team_short: string;
  spread_at_pick: number | null;
  home_short: string;
  away_short: string;
};

type ScoreRow = {
  game_id: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
};

type Totals = {
  weekWins: number;
  wins: number;
  losses: number;
  pushes: number;
};

/** Raw shapes coming back from RPCs/queries (unknown properties) */
type RpcFinalRowUnknown = {
  game_id?: unknown;
  home?: unknown;
  away?: unknown;
  home_score?: unknown;
  away_score?: unknown;
};

type PicksSelectRowUnknown = {
  player_display_name?: unknown;
  team_short?: unknown;
  spread_at_pick?: unknown;
  home_short?: unknown;
  away_short?: unknown;
};

/* --------------------------------- utils ---------------------------------- */

const norm = (s: string) => s.trim().toLowerCase();

function toNumOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}
function toStr(x: unknown, fb = ''): string {
  return typeof x === 'string' ? x : x == null ? fb : String(x);
}

/** ATS outcome for one pick, using final scores from the scoring RPC. */
function scorePick(
  pick: PickRow,
  game: ScoreRow | undefined
): 'win' | 'loss' | 'push' | 'pending' {
  if (!game) return 'pending';
  const hs = toNumOrNull(game.home_score);
  const as = toNumOrNull(game.away_score);
  if (hs == null || as == null) return 'pending';

  const isHomePick = norm(pick.team_short) === norm(game.home);
  const pickScore = isHomePick ? hs : as;
  const oppScore = isHomePick ? as : hs;
  const spread = pick.spread_at_pick ?? 0;

  const adj = pickScore + spread;
  if (adj > oppScore) return 'win';
  if (adj < oppScore) return 'loss';
  return 'push';
}

/* ------------------------------- page logic ------------------------------- */

export default function StandingsPage() {
  const [latestWeekWithPicks, setLatestWeekWithPicks] = useState<number>(1);
  const [weeksToScore, setWeeksToScore] = useState<number[]>([]);
  const [rows, setRows] = useState<Map<string, Totals>>(new Map());
  const [loading, setLoading] = useState(true);

  // 1) Which weeks have picks? (so we know what to score)
  useEffect(() => {
    (async () => {
      // A) from weeks table (if you keep that up to date)
      const { data: weeksRpc } = await supabase.rpc('list_weeks', { p_year: YEAR });
      const weeksFromRpc: number[] = Array.isArray(weeksRpc)
        ? (weeksRpc as unknown[])
            .map((w): number | null => {
              const n =
                typeof (w as Record<string, unknown>)?.week_number === 'number'
                  ? ((w as Record<string, unknown>).week_number as number)
                  : null;
              return n;
            })
            .filter((n): n is number => n != null)
        : [];

      // B) from picks table (safe source of truth)
      const { data: pickedWeeks } = await supabase
        .from('picks')
        .select('weeks!inner(week_number)')
        .eq('season_year', YEAR)
        .order('weeks(week_number)', { ascending: true });

      const weeksFromPicks: number[] = Array.isArray(pickedWeeks)
        ? (pickedWeeks as unknown[])
            .map((r) => {
              const rec = r as Record<string, unknown>;
              const w = rec.weeks as Record<string, unknown> | undefined;
              const n = typeof w?.week_number === 'number' ? (w.week_number as number) : null;
              return n;
            })
            .filter((n): n is number => n != null)
        : [];

      const uniq = new Set<number>([...weeksFromRpc, ...weeksFromPicks]);
      const sorted = [...uniq].sort((a, b) => a - b);
      const latest = sorted.length ? sorted[sorted.length - 1] : 1;

      setWeeksToScore(sorted);
      setLatestWeekWithPicks(latest);
    })();
  }, []);

  // 2) Score each week via the scoring RPC + picks table
  useEffect(() => {
    (async () => {
      if (!weeksToScore.length) {
        setRows(new Map(PLAYERS_ORDERED.map((p) => [p, { weekWins: 0, wins: 0, losses: 0, pushes: 0 }])));
        setLoading(false);
        return;
      }

      setLoading(true);

      // init totals
      const totals = new Map<string, Totals>();
      for (const p of PLAYERS_ORDERED) {
        totals.set(p, { weekWins: 0, wins: 0, losses: 0, pushes: 0 });
      }

      for (const weekNumber of weeksToScore) {
        // A) Finals for the week (RPC)
        const { data: finals } = await supabase.rpc('get_week_games_for_scoring', {
          p_year: YEAR,
          p_week: weekNumber,
        });

        const finalsArr: RpcFinalRowUnknown[] = Array.isArray(finals)
          ? (finals as unknown[]).map((x) => x as RpcFinalRowUnknown)
          : [];

        const scores: ScoreRow[] = finalsArr.map((r) => ({
          game_id: Number(toNumOrNull(r.game_id) ?? 0),
          home: toStr(r.home),
          away: toStr(r.away),
          home_score: toNumOrNull(r.home_score),
          away_score: toNumOrNull(r.away_score),
        }));

        // index by pair "HOME-AWAY"
        const byPair = new Map<string, ScoreRow>();
        for (const g of scores) {
          if (g.home && g.away) byPair.set(`${norm(g.home)}-${norm(g.away)}`, g);
        }

        // B) Picks for that week
        const { data: picks } = await supabase
          .from('picks')
          .select('player_display_name, team_short, spread_at_pick, home_short, away_short, weeks!inner(week_number)')
          .eq('season_year', YEAR)
          .eq('weeks.week_number', weekNumber);

        const pickArr: PicksSelectRowUnknown[] = Array.isArray(picks)
          ? (picks as unknown[]).map((x) => x as PicksSelectRowUnknown)
          : [];

        const weekPicks: PickRow[] = pickArr.map((r) => ({
          player_display_name: toStr(r.player_display_name),
          team_short: toStr(r.team_short),
          spread_at_pick: toNumOrNull(r.spread_at_pick),
          home_short: toStr(r.home_short),
          away_short: toStr(r.away_short),
        }));

        // C) Tally outcomes for players this week
        const weekWinCounter = new Map<string, number>();
        for (const name of PLAYERS_ORDERED) weekWinCounter.set(name, 0);

        for (const pick of weekPicks) {
          const canonical =
            (PLAYERS_ORDERED as readonly string[]).find((n) => norm(n) === norm(pick.player_display_name)) ??
            pick.player_display_name;

          if (!totals.has(canonical)) totals.set(canonical, { weekWins: 0, wins: 0, losses: 0, pushes: 0 });

          const game = byPair.get(`${norm(pick.home_short)}-${norm(pick.away_short)}`);
          const result = scorePick(pick, game);

          if (result === 'win') {
            totals.get(canonical)!.wins += 1;
            weekWinCounter.set(canonical, (weekWinCounter.get(canonical) ?? 0) + 1);
          } else if (result === 'loss') {
            totals.get(canonical)!.losses += 1;
          } else if (result === 'push') {
            totals.get(canonical)!.pushes += 1;
          }
        }

        // D) Award week wins (3–0 only)
        for (const [player, wWins] of weekWinCounter) {
          if (wWins === 3) totals.get(player)!.weekWins += 1;
        }
      }

      setRows(totals);
      setLoading(false);
    })();
  }, [weeksToScore]);

  /* ------------------------------ derived view ----------------------------- */

  const table = useMemo(() => {
    const arr = PLAYERS_ORDERED.map((name) => {
      const t = rows.get(name) ?? { weekWins: 0, wins: 0, losses: 0, pushes: 0 };
      const denom = t.wins + t.losses + t.pushes; // pushes count as a loss for %
      const pct = denom === 0 ? 0 : (t.wins / denom) * 100;
      return { player: name, ...t, pct };
    });
    return arr;
  }, [rows]);

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="flex items-start justify-between mb-6">
        <h1 className="text-4xl font-extrabold tracking-tight">Season Standings</h1>
        <div className="text-zinc-300">Through Week {latestWeekWithPicks}</div>
      </header>

      <section className="border rounded overflow-hidden">
        {/* header row (classic table look) */}
        <div className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] bg-zinc-900/70 text-sm font-semibold px-4 py-3">
          <div>PLAYER</div>
          <div className="text-center">WEEK WINS</div>
          <div className="text-center">ATS W</div>
          <div className="text-center">ATS L</div>
          <div className="text-center">ATS PU</div>
          <div className="text-center">WIN %</div>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-zinc-400">Loading…</div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {table.map((r) => (
              <div key={r.player} className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] px-4 py-4">
                <div className="font-semibold">{r.player}</div>
                <div className="text-center">{r.weekWins}</div>
                <div className="text-center">{r.wins}</div>
                <div className="text-center">{r.losses}</div>
                <div className="text-center">{r.pushes}</div>
                <div className="text-center">{r.pct.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="mt-4 text-zinc-400">Win% treats pushes as losses.</p>
    </div>
  );
}
