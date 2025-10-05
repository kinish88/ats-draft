'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

type SafeRec = Record<string, unknown>;
type PicksRow = {
  week_id: number;
  pick_number: number;
  player_display_name: string;
  team_short: string;
  spread_at_pick: number | null;
  home_short: string;
  away_short: string;
};
type RpcGameRow = {
  game_id: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
};
type Totals = { weekWins: number; w: number; l: number; pu: number };

const norm = (s: string) => s.trim().toUpperCase();
const toStr = (x: unknown, fb = '') => (typeof x === 'string' ? x : x == null ? fb : String(x));
const toNumOrNull = (x: unknown) => {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};
const keyPair = (h: string, a: string) => `${norm(h)}-${norm(a)}`;

type Outcome = 'win' | 'loss' | 'push' | 'pending';
function atsOutcome(g: RpcGameRow | undefined, team: string, line: number | null): Outcome {
  if (!g || line == null) return 'pending';
  const hs = toNumOrNull(g.home_score);
  const as = toNumOrNull(g.away_score);
  if (hs == null || as == null) return 'pending';
  const isHome = norm(team) === norm(g.home);
  const adj = (isHome ? hs : as) + line;
  const opp = isHome ? as : hs;
  if (adj > opp) return 'win';
  if (adj < opp) return 'loss';
  return 'push';
}

export default function StandingsPage() {
  const [throughWeek, setThroughWeek] = useState(1);
  const [loading, setLoading] = useState(true);
  const [totalsByPlayer, setTotalsByPlayer] = useState<Map<string, Totals>>(
    () => new Map(PLAYERS.map((p) => [p, { weekWins: 0, w: 0, l: 0, pu: 0 }]))
  );

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Pull picks (joined to weeks to get week_number)
      const { data: picksRows } = await supabase
        .from('picks')
        .select(
          'week_id, pick_number, player_display_name, team_short, spread_at_pick, home_short, away_short, weeks!inner(id, season_year, week_number)'
        )
        .eq('season_year', YEAR)
        .order('week_id', { ascending: true })
        .order('pick_number', { ascending: true });

      const picks: PicksRow[] = (Array.isArray(picksRows) ? picksRows : []).map((r) => {
        const o = r as SafeRec;
        return {
          week_id: Number(o.week_id ?? 0),
          pick_number: Number(o.pick_number ?? 0),
          player_display_name: toStr(o.player_display_name),
          team_short: toStr(o.team_short),
          spread_at_pick: toNumOrNull(o.spread_at_pick),
          home_short: toStr(o.home_short),
          away_short: toStr(o.away_short),
        };
      });

      const weekIdToNum = new Map<number, number>();
      for (const r of (Array.isArray(picksRows) ? picksRows : []) as SafeRec[]) {
        const wk = r['weeks'] as SafeRec | undefined;
        const id = typeof r['week_id'] === 'number' ? (r['week_id'] as number) : null;
        const num =
          wk && typeof wk['week_number'] === 'number' ? (wk['week_number'] as number) : null;
        if (id != null && num != null) weekIdToNum.set(id, num);
      }

      if (!picks.length) {
        setThroughWeek(1);
        setTotalsByPlayer(new Map(PLAYERS.map((p) => [p, { weekWins: 0, w: 0, l: 0, pu: 0 }])));
        setLoading(false);
        return;
      }

      const maxWeek = Math.max(...Array.from(weekIdToNum.values()));
      setThroughWeek(maxWeek);

      // group picks by week
      const byWeek = new Map<number, PicksRow[]>();
      for (const p of picks) {
        const arr = byWeek.get(p.week_id) ?? [];
        arr.push(p);
        byWeek.set(p.week_id, arr);
      }

      const totals = new Map<string, Totals>(
        PLAYERS.map((p) => [p, { weekWins: 0, w: 0, l: 0, pu: 0 }])
      );

      // score week by week against week’s games
      for (const [weekId, list] of byWeek) {
        const weekNum = weekIdToNum.get(weekId) ?? maxWeek;

        const { data: gameRows } = await supabase.rpc('get_week_games_for_scoring', {
          p_year: YEAR,
          p_week: weekNum,
        });
        const games: RpcGameRow[] = (Array.isArray(gameRows) ? gameRows : []).map((r) => {
          const o = r as SafeRec;
          return {
            game_id: Number(o.game_id ?? 0),
            home: toStr(o.home),
            away: toStr(o.away),
            home_score: toNumOrNull(o.home_score),
            away_score: toNumOrNull(o.away_score),
          };
        });
        const gameMap = new Map<string, RpcGameRow>();
        for (const g of games) gameMap.set(keyPair(g.home, g.away), g);

        const weekAgg = new Map<string, { w: number; l: number; pu: number }>(
          PLAYERS.map((p) => [p, { w: 0, l: 0, pu: 0 }])
        );

        for (const p of list) {
          const player =
            (PLAYERS as readonly string[]).find(
              (n) => n.toLowerCase() === p.player_display_name.toLowerCase()
            ) ?? p.player_display_name;

          const g = gameMap.get(keyPair(p.home_short, p.away_short));
          const out = atsOutcome(g, p.team_short, p.spread_at_pick);

          const t = totals.get(player)!;
          const wk = weekAgg.get(player)!;

          if (out === 'win') {
            t.w += 1;
            wk.w += 1;
          } else if (out === 'loss') {
            t.l += 1;
            wk.l += 1;
          } else if (out === 'push') {
            t.pu += 1;
            wk.pu += 1;
          }

          totals.set(player, t);
          weekAgg.set(player, wk);
        }

        // 3–0 only for a Week Win
        for (const [name, wk] of weekAgg) {
          if (wk.w === 3 && wk.l === 0 && wk.pu === 0) {
            const t = totals.get(name)!;
            t.weekWins += 1;
            totals.set(name, t);
          }
        }
      }

      setTotalsByPlayer(totals);
      setLoading(false);
    })();
  }, []);

  const rows = useMemo(() => {
    return PLAYERS.map((name) => {
      const t = totalsByPlayer.get(name) ?? { weekWins: 0, w: 0, l: 0, pu: 0 };
      const denom = t.w + t.l + t.pu; // pushes count as losses in %
      const pct = denom > 0 ? (t.w / denom) * 100 : 0;
      return { name, ...t, pct: pct.toFixed(1) + '%' };
    });
  }, [totalsByPlayer]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <header className="flex items-baseline justify-between mb-4">
        <h1 className="text-4xl font-semibold">Season Standings</h1>
        <div className="text-zinc-300">Through Week {throughWeek}</div>
      </header>

      <div className="overflow-x-auto">
        <div className="min-w-[720px] border rounded overflow-hidden">
          {/* SINGLE header row */}
          <div className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] bg-zinc-900/70 text-zinc-200 px-4 py-3 text-sm font-semibold">
            <div>PLAYER</div>
            <div className="text-center">WEEK WINS</div>
            <div className="text-center">ATS W</div>
            <div className="text-center">ATS L</div>
            <div className="text-center">ATS PU</div>
            <div className="text-center">WIN %</div>
          </div>

          {/* BODY rows */}
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
                  <div className="text-center tabular-nums">{r.pct}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm text-zinc-400">Win% treats pushes as losses.</p>
    </div>
  );
}
