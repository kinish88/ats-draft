'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ----------------------------- league settings ---------------------------- */

const YEAR = 2025;
const PLAYERS_ORDERED = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* ---------------------------------- types --------------------------------- */

type WeekRow = { week_number: number };

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

  // 1) Figure out which weeks have picks (so we know what to score)
  useEffect(() => {
    (async () => {
      // distinct week_numbers that have any picks this season
      const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
      const fromWeeksTable =
        Array.isArray(data) ? (data as any[]).map((w) => Number(w.week_number)).filter(Number.isFinite) : [];

      // We also look at picks directly, in case list_weeks is sparse in your data.
      const { data: pickedWeeks } = await supabase
        .from('picks')
        .select('week_id, weeks!inner(week_number)')
        .eq('season_year', YEAR)
        .order('weeks(week_number)', { ascending: true });

      const fromPicks = (Array.isArray(pickedWeeks) ? pickedWeeks : [])
        .map((r: any) => Number(r.weeks?.week_number))
        .filter((n) => Number.isFinite(n));

      const uniq = new Set<number>([...fromWeeksTable, ...fromPicks]);
      const sorted = [...uniq].sort((a, b) => a - b);
      const latest = sorted.length ? sorted[sorted.length - 1] : 1;

      setWeeksToScore(sorted);
      setLatestWeekWithPicks(latest);
    })();
  }, []);

  // 2) Score all those weeks using the RPC + picks table
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

      // score week-by-week
      for (const weekNumber of weeksToScore) {
        // A) All final scores for the week (from RPC — this *does* return finals)
        const { data: finals } = await supabase.rpc('get_week_games_for_scoring', {
          p_year: YEAR,
          p_week: weekNumber,
        });

        const scores: ScoreRow[] = Array.isArray(finals)
          ? (finals as any[]).map((r) => ({
              game_id: Number(r.game_id),
              home: toStr(r.home),
              away: toStr(r.away),
              home_score: toNumOrNull(r.home_score),
              away_score: toNumOrNull(r.away_score),
            }))
          : [];

        // index by pair "HOME-AWAY"
        const byPair = new Map<string, ScoreRow>();
        for (const g of scores) {
          byPair.set(`${norm(g.home)}-${norm(g.away)}`, g);
        }

        // B) Picks for that week
        const { data: picks } = await supabase
          .from('picks')
          .select('player_display_name, team_short, spread_at_pick, home_short, away_short, weeks!inner(week_number)')
          .eq('season_year', YEAR)
          .eq('weeks.week_number', weekNumber);

        const weekPicks: PickRow[] = Array.isArray(picks)
          ? (picks as any[]).map((r) => ({
              player_display_name: toStr(r.player_display_name),
              team_short: toStr(r.team_short),
              spread_at_pick: toNumOrNull(r.spread_at_pick),
              home_short: toStr(r.home_short),
              away_short: toStr(r.away_short),
            }))
          : [];

        // C) Tally outcomes for players this week
        const weekWinsMap = new Map<string, number>();
        for (const pName of PLAYERS_ORDERED) weekWinsMap.set(pName, 0);

        for (const pick of weekPicks) {
          // Canonical player key
          const player =
            (PLAYERS_ORDERED as readonly string[]).find((n) => norm(n) === norm(pick.player_display_name)) ??
            pick.player_display_name;

          if (!totals.has(player)) totals.set(player, { weekWins: 0, wins: 0, losses: 0, pushes: 0 });

          const g = byPair.get(`${norm(pick.home_short)}-${norm(pick.away_short)}`);
          const result = scorePick(pick, g);

          if (result === 'win') {
            totals.get(player)!.wins += 1;
            weekWinsMap.set(player, (weekWinsMap.get(player) ?? 0) + 1);
          } else if (result === 'loss') {
            totals.get(player)!.losses += 1;
          } else if (result === 'push') {
            totals.get(player)!.pushes += 1;
          }
          // 'pending' is ignored; that just means the game has no final yet
        }

        // D) Award week win(s): only players with **3 wins** get a week win
        for (const [player, wWins] of weekWinsMap) {
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
