'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ------------------------------- config -------------------------------- */

const YEAR = 2025;
// Keep the same display order across the app
const PLAYERS_ORDERED = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* -------------------------------- types -------------------------------- */

type WeekIdRow = { id: number; week_number: number };

type PicksSelectRow = {
  pick_number: number;           // 1..9 across week (we’ll group by player)
  player_display_name: string;
  team_short: string;            // picked team
  spread_at_pick: number | null; // signed number for the picked team
  home_short: string;
  away_short: string;
  week_id: number;
};

type GameScoreRow = {
  game_id: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
};

type Totals = {
  weekWins: number;
  w: number;
  l: number;
  pu: number;
};

type StandRow = {
  player: string;
  totals: Totals;
};

type RpcWeekGamesRowUnknown = {
  game_id?: unknown;
  home?: unknown;
  away?: unknown;
  home_score?: unknown;
  away_score?: unknown;
};

type PicksRowUnknown = {
  pick_number?: unknown;
  player_display_name?: unknown;
  team_short?: unknown;
  spread_at_pick?: unknown;
  home_short?: unknown;
  away_short?: unknown;
  week_id?: unknown;
};

/* -------------------------------- utils -------------------------------- */

const norm = (s: string) => s.trim().toLowerCase();
const toStr = (x: unknown, fb = ''): string =>
  typeof x === 'string' ? x : x == null ? fb : String(x);
const toNumOrNull = (x: unknown): number | null => {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};

function winPct(t: Totals): number {
  const den = t.w + t.l + t.pu;       // pushes treated as losses in denominator
  return den === 0 ? 0 : t.w / den;
}

function outcomeForPick(
  g: GameScoreRow | undefined,
  pickedTeam: string,
  spreadForPick: number | null
): 'W' | 'L' | 'PU' | 'PENDING' {
  if (!g) return 'PENDING';
  if (g.home_score == null || g.away_score == null) return 'PENDING';
  if (spreadForPick == null) return 'PENDING';

  const pickIsHome = norm(pickedTeam) === norm(g.home);
  const pickScore = pickIsHome ? g.home_score : g.away_score;
  const oppScore = pickIsHome ? g.away_score : g.home_score;

  const adj = pickScore + spreadForPick;
  if (adj > oppScore) return 'W';
  if (adj < oppScore) return 'L';
  return 'PU';
}

/* ------------------------------ page ----------------------------------- */

export default function SeasonStandingsPage() {
  const [latestWeekWithPicks, setLatestWeekWithPicks] = useState<number>(1);
  const [standings, setStandings] = useState<StandRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Discover which weeks actually have picks, then compute standings for those weeks.
  useEffect(() => {
    (async () => {
      setLoading(true);

      // Find weeks that actually have picks for this season
      const { data: picksWithWeeks } = await supabase
        .from('picks')
        .select('week_id, weeks!inner(id, week_number)')
        .eq('season_year', YEAR);

      const weekNums: number[] = [];
      const weekIds: number[] = [];
      if (Array.isArray(picksWithWeeks)) {
        for (const r of picksWithWeeks as unknown[]) {
          const rec = r as { week_id?: number; weeks?: WeekIdRow };
          if (typeof rec.week_id === 'number') weekIds.push(rec.week_id);
          if (rec.weeks && typeof rec.weeks.week_number === 'number') {
            weekNums.push(rec.weeks.week_number);
          }
        }
      }
      const uniqIds = [...new Set(weekIds)];
      const uniqWeekNums = [...new Set(weekNums)].sort((a, b) => a - b);
      const throughWeek = uniqWeekNums.length
        ? uniqWeekNums[uniqWeekNums.length - 1]
        : 1;
      setLatestWeekWithPicks(throughWeek);

      // No picks yet? Build zeros table and stop.
      if (uniqIds.length === 0) {
        const zeroRows: StandRow[] = (PLAYERS_ORDERED as readonly string[]).map(
          (p) => ({
            player: p,
            totals: { weekWins: 0, w: 0, l: 0, pu: 0 },
          })
        );
        setStandings(zeroRows);
        setLoading(false);
        return;
      }

      // Compute totals across all picked weeks
      const totalsByPlayer = new Map<string, Totals>();
      for (const name of PLAYERS_ORDERED)
        totalsByPlayer.set(name, { weekWins: 0, w: 0, l: 0, pu: 0 });

      // For each week that has picks:
      for (const weekId of uniqIds) {
        // 1) Load picks (spread only) for this week
        const { data: picksData } = await supabase
          .from('picks')
          .select(
            'pick_number, player_display_name, team_short, spread_at_pick, home_short, away_short, week_id'
          )
          .eq('season_year', YEAR)
          .eq('week_id', weekId);

        const pRowsRaw = Array.isArray(picksData) ? (picksData as unknown[]) : [];
        const picks: PicksSelectRow[] = pRowsRaw.map((x) => {
          const r = x as PicksRowUnknown;
          return {
            pick_number: toNumOrNull(r.pick_number) ?? 0,
            player_display_name: toStr(r.player_display_name),
            team_short: toStr(r.team_short),
            spread_at_pick: toNumOrNull(r.spread_at_pick),
            home_short: toStr(r.home_short),
            away_short: toStr(r.away_short),
            week_id: toNumOrNull(r.week_id) ?? 0,
          };
        });

        // 2) Load final scores for all games of that week (via your RPC)
        const { data: baseGames } = await supabase.rpc(
          'get_week_games_for_scoring',
          { p_year: YEAR, p_week: throughWeekForWeekId(weekId, uniqWeekNums) }
        );

        const gameMap = new Map<string, GameScoreRow>();
        if (Array.isArray(baseGames)) {
          for (const row of baseGames as unknown[]) {
            const g = row as RpcWeekGamesRowUnknown;
            const home = toStr(g.home);
            const away = toStr(g.away);
            const id = toNumOrNull(g.game_id) ?? 0;
            gameMap.set(`${home}-${away}`, {
              game_id: id,
              home,
              away,
              home_score: toNumOrNull(g.home_score),
              away_score: toNumOrNull(g.away_score),
            });
          }
        }

        // 3) Tally this week’s W/L/PU per player (spread picks only)
        const weeklyByPlayer = new Map<
          string,
          { w: number; l: number; pu: number }
        >();
        for (const name of PLAYERS_ORDERED)
          weeklyByPlayer.set(name, { w: 0, l: 0, pu: 0 });

        for (const p of picks) {
          const key = (PLAYERS_ORDERED as readonly string[]).find(
            (nm) => norm(nm) === norm(p.player_display_name)
          ) ?? p.player_display_name;

          // Only 3 ATS picks count — ignore any O/U rows if they exist in this table.
          const g = gameMap.get(`${p.home_short}-${p.away_short}`);
          const res = outcomeForPick(g, p.team_short, p.spread_at_pick);

          const bucket = weeklyByPlayer.get(key);
          if (!bucket) continue;

          if (res === 'W') bucket.w++;
          else if (res === 'L') bucket.l++;
          else if (res === 'PU') bucket.pu++;
        }

        // 4) Add weekly totals to season totals + week win if a player went 3-0
        for (const [name, wk] of weeklyByPlayer) {
          const agg = totalsByPlayer.get(name) ?? {
            weekWins: 0,
            w: 0,
            l: 0,
            pu: 0,
          };
          agg.w += wk.w;
          agg.l += wk.l;
          agg.pu += wk.pu;

          // Week win = 3 wins (we don’t care about ties across players here)
          if (wk.w === 3) agg.weekWins += 1;

          totalsByPlayer.set(name, agg);
        }
      }

      // Final table in desired order
      const rows: StandRow[] = (PLAYERS_ORDERED as readonly string[]).map(
        (name) => ({
          player: name,
          totals: totalsByPlayer.get(name) ?? { weekWins: 0, w: 0, l: 0, pu: 0 },
        })
      );

      setStandings(rows);
      setLoading(false);
    })();
  }, []);

  /* ------------------------------ render -------------------------------- */

  const table = useMemo(() => {
    if (!standings) return null;
    return (
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-left">
          <thead className="text-xs uppercase tracking-wide bg-zinc-900/60">
            <tr>
              <th className="px-4 py-2">Player</th>
              <th className="px-4 py-2 text-right">Week Wins</th>
              <th className="px-4 py-2 text-right">ATS W</th>
              <th className="px-4 py-2 text-right">ATS L</th>
              <th className="px-4 py-2 text-right">ATS PU</th>
              <th className="px-4 py-2 text-right">Win %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {standings.map(({ player, totals }) => (
              <tr key={player}>
                <td className="px-4 py-3 font-medium">{player}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {totals.weekWins}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.w}</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.l}</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.pu}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {(winPct(totals) * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [standings]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Season Standings</h1>
        <div className="opacity-80">Through Week {latestWeekWithPicks}</div>
      </header>

      {loading ? (
        <div className="text-sm text-zinc-400">Loading…</div>
      ) : (
        table
      )}

      <div className="text-sm text-zinc-500 mt-2">
        Win% treats pushes as losses.
      </div>
    </div>
  );
}

/**
 * Helper to guess the week number to feed the scoring RPC for a week_id.
 * We already computed the list of week numbers that have picks and sorted it.
 * Since week_id → week_number mapping isn’t directly available here, we pass
 * the max “through” week number so the RPC returns all finals we need.
 * If you prefer strict mapping, expose week_number from `picks` join and
 * pass that exact number instead.
 */
function throughWeekForWeekId(_weekId: number, sortedWeekNums: number[]): number {
  return sortedWeekNums.length ? sortedWeekNums[sortedWeekNums.length - 1] : 1;
}
