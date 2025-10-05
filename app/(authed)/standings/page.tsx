'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/** CONFIG */
const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

/** Types from our tables/RPCs (only what we use) */
type WeekRow = { id: number; week_number: number };
type GameForScoring = {
  game_id?: unknown;
  home?: unknown;        // RPC returns team short (e.g., PHI)
  away?: unknown;        // RPC returns team short (e.g., DAL)
  home_score?: unknown;
  away_score?: unknown;
};

type GameResolved = {
  id: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
};

type PickRow = {
  week_id?: unknown;
  pick_number?: unknown;
  player_display_name?: unknown;
  team_short?: unknown;      // picked team short
  spread_at_pick?: unknown;  // signed line for picked team
  home_short?: unknown;
  away_short?: unknown;
};

type AtsPick = {
  week_id: number;
  player: string;
  team_short: string;
  spread: number | null;
  home: string;
  away: string;
};

type Totals = {
  weekWins: number;
  w: number;
  l: number;
  pu: number;
};

const toStr = (x: unknown, fb = ''): string =>
  typeof x === 'string' ? x : x == null ? fb : String(x);
const toNumOrNull = (x: unknown): number | null => {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};
const norm = (s: string) => s.trim().toLowerCase();

/** Compute ATS outcome for a single pick given a final game score */
function outcomeATS(
  game: GameResolved | undefined,
  pickedTeam: string,
  spreadForPick: number | null
): 'win' | 'loss' | 'push' | 'pending' {
  if (!game) return 'pending';
  const { home_score, away_score } = game;
  if (home_score == null || away_score == null) return 'pending';
  if (spreadForPick == null) return 'pending';

  const pickIsHome = norm(pickedTeam) === norm(game.home);
  const pickScore = pickIsHome ? home_score : away_score;
  const oppScore = pickIsHome ? away_score : home_score;

  const adjusted = pickScore + spreadForPick;
  if (adjusted > oppScore) return 'win';
  if (adjusted < oppScore) return 'loss';
  return 'push';
}

/** Page component */
export default function SeasonStandingsPage() {
  const [throughWeek, setThroughWeek] = useState<number>(1);
  const [totalsByPlayer, setTotalsByPlayer] = useState<Map<string, Totals>>(
    () =>
      new Map(
        (PLAYERS as readonly string[]).map((p) => [
          p,
          { weekWins: 0, w: 0, l: 0, pu: 0 },
        ])
      )
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadStandings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStandings() {
    setLoading(true);

    /** 1) Map week_id -> week_number for the season */
    const { data: weeksData } = await supabase
      .from('weeks')
      .select('id, week_number')
      .eq('season_year', YEAR);

    const weeks: WeekRow[] = Array.isArray(weeksData)
      ? (weeksData as WeekRow[])
      : [];

    const weekNumberById = new Map<number, number>();
    for (const w of weeks) {
      weekNumberById.set(w.id, w.week_number);
    }

    /** 2) Which week_ids actually have picks this season? */
    const { data: usedWeeksRaw } = await supabase
      .from('picks')
      .select('week_id')
      .eq('season_year', YEAR)
      .not('week_id', 'is', null);

    const usedWeekIds = new Set<number>();
    if (Array.isArray(usedWeeksRaw)) {
      for (const r of usedWeeksRaw as Array<{ week_id?: number }>) {
        if (typeof r.week_id === 'number') usedWeekIds.add(r.week_id);
      }
    }

    /** 3) Convert to week_numbers and sort */
    const usedWeekNumbers = Array.from(usedWeekIds)
      .map((id) => weekNumberById.get(id) ?? null)
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => a - b);

    const latestWeekNumber = usedWeekNumbers.length
      ? usedWeekNumbers[usedWeekNumbers.length - 1]
      : 1;

    setThroughWeek(latestWeekNumber);

    /** 4) Accumulate per-player totals across all used weeks */
    const agg = new Map<string, Totals>(
      (PLAYERS as readonly string[]).map((p) => [
        p,
        { weekWins: 0, w: 0, l: 0, pu: 0 },
      ])
    );

    for (const wk of usedWeekNumbers) {
      // 4a) fetch final scores for that week from your RPC (stable column names)
      const { data: gamesRaw } = await supabase.rpc(
        'get_week_games_for_scoring',
        { p_year: YEAR, p_week: wk }
      );

      const gamesArr: GameForScoring[] = Array.isArray(gamesRaw)
        ? (gamesRaw as GameForScoring[])
        : [];

      const games: GameResolved[] = gamesArr
        .map((r): GameResolved | null => {
          const id = toNumOrNull(r.game_id);
          const home = toStr(r.home);
          const away = toStr(r.away);
          const hs = toNumOrNull(r.home_score);
          const as = toNumOrNull(r.away_score);
          if (id == null || !home || !away) return null;
          return {
            id,
            home,
            away,
            home_score: hs,
            away_score: as,
          };
        })
        .filter((g): g is GameResolved => g !== null);

      // (index by pair for quick lookup)
      const gameByPair = new Map<string, GameResolved>();
      for (const g of games) gameByPair.set(`${g.home}-${g.away}`, g);

      // 4b) fetch the 3 spread picks for that week
      const { data: picksRaw } = await supabase
        .from('picks')
        .select(
          'week_id, pick_number, player_display_name, team_short, spread_at_pick, home_short, away_short'
        )
        .eq('season_year', YEAR)
        .eq('week_id', Array.from(weekNumberById.entries()).find(([, num]) => num === wk)?.[0] ?? -1) // safe lookup
        .order('pick_number', { ascending: true });

      const picksArr: PickRow[] = Array.isArray(picksRaw)
        ? (picksRaw as PickRow[])
        : [];

      const picks: AtsPick[] = picksArr
        .map((r): AtsPick | null => {
          const wid = toNumOrNull(r.week_id);
          const player = toStr(r.player_display_name);
          const team_short = toStr(r.team_short);
          const spread = toNumOrNull(r.spread_at_pick);
          const home = toStr(r.home_short);
          const away = toStr(r.away_short);
          if (wid == null || !player || !team_short || !home || !away) return null;
          return { week_id: wid, player, team_short, spread, home, away };
        })
        .filter((p): p is AtsPick => p !== null);

      // group by player for the week to compute week winner
      const weekWinsPerPlayer = new Map<string, number>();
      for (const name of PLAYERS) weekWinsPerPlayer.set(name, 0);

      for (const p of picks) {
        const canonical =
          (PLAYERS as readonly string[]).find((n) => norm(n) === norm(p.player)) ??
          p.player;

        const key = `${p.home}-${p.away}`;
        const g = gameByPair.get(key);

        const o = outcomeATS(g, p.team_short, p.spread);
        const t = agg.get(canonical) ?? { weekWins: 0, w: 0, l: 0, pu: 0 };

        if (o === 'win') {
          t.w += 1;
          weekWinsPerPlayer.set(canonical, (weekWinsPerPlayer.get(canonical) ?? 0) + 1);
        } else if (o === 'loss') {
          t.l += 1;
        } else if (o === 'push') {
          t.pu += 1;
        }
        agg.set(canonical, t);
      }

      // only a 3–0 week counts as a "Week Win"
      for (const [playerName, winsThisWeek] of weekWinsPerPlayer) {
        if (winsThisWeek === 3) {
          const t = agg.get(playerName)!;
          t.weekWins += 1;
          agg.set(playerName, t);
        }
      }
    }

    setTotalsByPlayer(agg);
    setLoading(false);
  }

  const rows = useMemo(() => {
    return (PLAYERS as readonly string[]).map((name) => {
      const t = totalsByPlayer.get(name) ?? { weekWins: 0, w: 0, l: 0, pu: 0 };
      const denom = t.w + t.l + t.pu; // pushes count as losses in win%
      const pct = denom > 0 ? (t.w / denom) * 100 : 0;
      return { name, ...t, pct };
    });
  }, [totalsByPlayer]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Season Standings</h1>
        <div className="text-zinc-400">Through Week {throughWeek}</div>
      </header>

      <section className="border rounded overflow-hidden">
        <div className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] bg-zinc-900/60 text-xs px-3 py-2 border-b">
          <div>PLAYER</div>
          <div className="text-right">WEEK WINS</div>
          <div className="text-right">ATS W</div>
          <div className="text-right">ATS L</div>
          <div className="text-right">ATS PU</div>
          <div className="text-right">WIN %</div>
        </div>

        {loading ? (
          <div className="px-3 py-4 text-sm text-zinc-400">Loading…</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.name}
              className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] px-3 py-3 border-b last:border-b-0"
            >
              <div className="font-medium">{r.name}</div>
              <div className="text-right">{r.weekWins}</div>
              <div className="text-right">{r.w}</div>
              <div className="text-right">{r.l}</div>
              <div className="text-right">{r.pu}</div>
              <div className="text-right">{r.pct.toFixed(1)}%</div>
            </div>
          ))
        )}
      </section>

      <div className="text-sm text-zinc-400">
        Win% treats pushes as losses.
      </div>
    </div>
  );
}
