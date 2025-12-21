'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { formatGameLabel } from '@/lib/formatGameLabel';

const YEAR = 2025;

/* ------------------------------- data types ------------------------------- */

type WeekRow = { week_number: number };

type GameRow = {
  id: number;
  home: string;           // short (e.g., 'PHI')
  away: string;           // short (e.g., 'DAL')
  home_score: number | null;
  away_score: number | null;
  live_home_score: number | null;
  live_away_score: number | null;
  is_final: boolean | null;
  is_live: boolean | null;
};

type SpreadPickRow = {
  pick_number: number;
  player_display_name: string; // 'Big Dawg' | 'Pud' | 'Kinish'
  team_short: string;          // the team they picked (short)
  spread: number | null;       // signed line for that team
  home_short: string;
  away_short: string;
};

type OuPickRow = {
  player_display_name: string;
  home_short: string;
  away_short: string;
  ou_choice: 'OVER' | 'UNDER';
  ou_total: number;
};

/** RPC result shapes (to avoid `any`) */
type RpcGameRow = {
  game_id?: number;
  id?: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  live_home_score?: number | null;
  live_away_score?: number | null;
  is_final?: boolean | null;
  is_live?: boolean | null;
};

type RpcSpreadRow = {
  pick_id?: number;
  pick_number: number | null;
  player: string;
  home_short: string;
  away_short: string;
  team_short: string;
  spread_at_pick: number | null;
};

type RpcOuRow = {
  player: string;
  home_short: string;
  away_short: string;
  pick_side: string;          // 'OVER' | 'UNDER'
  total_at_pick: number;      // numeric
};

/* --- type guard for realtime payloads (payload.new can be `{}`) --- */
type PartialGameUpdate = Partial<GameRow> & { id?: number };
function isGameUpdate(u: unknown): u is PartialGameUpdate {
  if (typeof u !== 'object' || u === null) return false;
  // Narrow using in-operator and a temporary typed view
  const v = u as { id?: unknown };
  return typeof v.id === 'number';
}

/* --------------------------------- utils --------------------------------- */

function signed(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return n > 0 ? `+${n}` : `${n}`;
}

function teamLogo(short?: string | null): string | null {
  if (!short) return null;
  // served from /public/teams/*.png
  return `/teams/${short}.png`;
}

type Outcome = 'win' | 'loss' | 'push' | 'pending';

function pickOutcomeATS(
  game: GameRow | undefined,
  pickedTeam: string,
  spreadForPick: number | null
): Outcome {
  if (!game || spreadForPick == null) return 'pending';

  const finalH = game.home_score;
  const finalA = game.away_score;
  const liveH  = game.live_home_score;
  const liveA  = game.live_away_score;

  const hasFinal = finalH != null && finalA != null;
  const hasLive  = liveH  != null && liveA  != null;

  const home = hasFinal ? (finalH as number) : hasLive ? (liveH as number) : null;
  const away = hasFinal ? (finalA as number) : hasLive ? (liveA as number) : null;

  if (home == null || away == null) return 'pending';

  const pickIsHome = pickedTeam === game.home;
  const pickScore  = pickIsHome ? home : away;
  const oppScore   = pickIsHome ? away : home;

  const adj = pickScore + spreadForPick;
  if (adj > oppScore) return 'win';
  if (adj < oppScore) return 'loss';
  return 'push';
}

function pickOutcomeOU(
  game: GameRow | undefined,
  choice: 'OVER' | 'UNDER',
  total: number
): Outcome {
  if (!game) return 'pending';

  const finalH = game.home_score;
  const finalA = game.away_score;
  const liveH  = game.live_home_score;
  const liveA  = game.live_away_score;

  const hasFinal = finalH != null && finalA != null;
  const hasLive  = liveH  != null && liveA  != null;

  const home = hasFinal ? (finalH as number) : hasLive ? (liveH as number) : null;
  const away = hasFinal ? (finalA as number) : hasLive ? (liveA as number) : null;

  if (home == null || away == null) return 'pending';

  const sum = home + away;
  if (sum === total) return 'push';
  if (choice === 'OVER') return sum > total ? 'win' : 'loss';
  return sum < total ? 'win' : 'loss';
}

function outcomeClass(o: Outcome): string {
  if (o === 'win')  return 'text-emerald-400';
  if (o === 'loss') return 'text-rose-400';
  if (o === 'push') return 'text-zinc-300';
  return 'text-zinc-400';
}

/* --------------------------------- cells --------------------------------- */

function TinyLogo({ url, alt }: { url: string | null | undefined; alt: string }) {
  if (!url) return <span className="inline-block w-4 h-4 mr-2 align-middle" />;
  return (
    <img
      alt={alt}
      src={url}
      className="inline-block w-4 h-4 mr-2 rounded-sm align-middle"
      loading="eager"
    />
  );
}

function StatusPill({ outcome }: { outcome: Outcome }) {
  const classes = outcomeClass(outcome);
  const text =
    outcome === 'pending' ? 'pending' : outcome === 'push' ? 'push' : outcome === 'win' ? 'win' : 'loss';
  return <span className={classes}>{text}</span>;
}

/* ---------------------------- stable player order ---------------------------- */

const PLAYERS_ORDERED = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* --------------------------------- page ---------------------------------- */

export default function ScoreboardPage() {
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [spreadPicks, setSpreadPicks] = useState<SpreadPickRow[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPickRow[]>([]);
  const [showBoard, setShowBoard] = useState(false);
  const [loading, setLoading] = useState(true);

  /* ------------------------------ data loading ----------------------------- */

  const loadWeeks = async () => {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    const list = (data as WeekRow[] | null)?.map(w => w.week_number) ?? [];
    setWeeks(list.length ? list : Array.from({ length: 18 }, (_, i) => i + 1));
  };

  const loadAll = async (wk: number) => {
    setLoading(true);

    const [gms, sp, ou] = await Promise.all([
      supabase.rpc('get_week_games_for_scoring', { p_year: YEAR, p_week: wk }),
      supabase.rpc('get_week_spread_picks_admin', { p_year: YEAR, p_week: wk }),
      supabase.rpc('get_week_ou_picks_admin',    { p_year: YEAR, p_week: wk }),
    ]);

    // normalize games: game_id -> id; default live/status to null if absent
    const gmsRaw: RpcGameRow[] = (gms.data as RpcGameRow[]) ?? [];
    const gmsNorm: GameRow[] = gmsRaw.map(r => ({
      id: Number(r.id ?? r.game_id),
      home: r.home,
      away: r.away,
      home_score: r.home_score ?? null,
      away_score: r.away_score ?? null,
      live_home_score: r.live_home_score ?? null,
      live_away_score: r.live_away_score ?? null,
      is_final:
        typeof r.is_final === 'boolean'
          ? r.is_final
          : (r.home_score != null && r.away_score != null),
      is_live: typeof r.is_live === 'boolean' ? r.is_live : null,
    }));
    setGames(gmsNorm);

    // map spread picks
    const spRaw: RpcSpreadRow[] = (sp.data as RpcSpreadRow[]) ?? [];
    const spNorm: SpreadPickRow[] = spRaw.map(r => ({
      pick_number: r.pick_number ?? 0,
      player_display_name: r.player,
      team_short: r.team_short,
      spread: r.spread_at_pick !== null && r.spread_at_pick !== undefined
        ? Number(r.spread_at_pick)
        : null,
      home_short: r.home_short,
      away_short: r.away_short,
    }));
    setSpreadPicks(spNorm);

    // map O/U picks
    const ouRaw: RpcOuRow[] = (ou.data as RpcOuRow[]) ?? [];
    const ouNorm: OuPickRow[] = ouRaw.map(r => ({
      player_display_name: r.player,
      home_short: r.home_short,
      away_short: r.away_short,
      ou_choice: (String(r.pick_side).toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER'),
      ou_total: Number(r.total_at_pick),
    }));
    setOuPicks(ouNorm);

    setLoading(false);
  };

  useEffect(() => {
    loadWeeks();
  }, []);

  useEffect(() => {
    loadAll(week);
  }, [week]);

  /* ------------------------------ live updates ----------------------------- */

  useEffect(() => {
    if (!games.length) return;

    const gameIdSet = new Set(games.map(g => g.id));
    const chan = supabase
      .channel('live-games')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games' },
        (payload: RealtimePostgresChangesPayload<GameRow>) => {
          const rowUnknown = payload.new as unknown;
          if (!isGameUpdate(rowUnknown) || !rowUnknown.id || !gameIdSet.has(rowUnknown.id)) return;

          setGames(prev =>
            prev.map(g => (g.id === rowUnknown.id ? ({ ...g, ...rowUnknown } as GameRow) : g))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chan);
    };
  }, [games]);

  /* ------------------------------ derived maps ----------------------------- */

  const gameByPair = useMemo(() => {
    const m = new Map<string, GameRow>();
    for (const g of games) m.set(`${g.home}-${g.away}`, g);
    return m;
  }, [games]);

  const picksByPlayer = useMemo(() => {
    const m = new Map<string, SpreadPickRow[]>();
    for (const name of PLAYERS_ORDERED) m.set(name, []);
    for (const p of spreadPicks) {
      const key = p.player_display_name ?? 'Unknown';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    for (const [, arr] of m) arr.sort((a, b) => (a.pick_number ?? 0) - (b.pick_number ?? 0));
    return m;
  }, [spreadPicks]);

  const ouByPlayer = useMemo(() => {
    const m = new Map<string, OuPickRow | null>();
    for (const name of PLAYERS_ORDERED) m.set(name, null);
    for (const r of ouPicks) m.set(r.player_display_name, r);
    return m;
  }, [ouPicks]);

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Week {week} Scoreboard</h1>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-sm opacity-70">Week</label>
            <select
              className="border rounded p-1 bg-transparent"
              value={week}
              onChange={(e) => setWeek(parseInt(e.target.value, 10))}
            >
              {weeks.map(w => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </div>

          <label className="text-sm flex items-center gap-2 select-none">
  <input
    type="checkbox"
    checked={showBoard}
    onChange={(e) => setShowBoard(e.target.checked)}
  />
  Show full scoreboard
</label>

        </div>
      </header>

      {/* ------------------------------- PICKS ------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Picks</h2>

        {loading ? (
          <div className="text-sm text-zinc-400">Loading…</div>
        ) : (
          PLAYERS_ORDERED.map(player => {
            const rows = picksByPlayer.get(player) ?? [];
            return (
              <div key={player} className="border rounded p-4">
                <div className="font-semibold mb-3">{player}</div>

                {rows.length === 0 ? (
                  <div className="text-sm text-zinc-400">No picks</div>
                ) : (
                  <div className="space-y-2">
                    {rows.map((r, idx) => {
                      const pairKey = `${r.home_short}-${r.away_short}`;
                      const g = gameByPair.get(pairKey);
                      const outcome = pickOutcomeATS(g, r.team_short, r.spread);

                      return (
                        <div key={`${player}-${idx}`} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TinyLogo url={teamLogo(r.team_short)} alt={r.team_short} />
                            <span className="w-14">{r.team_short}</span>
                            <span className="text-zinc-400 text-sm">
                              ({formatGameLabel(r.away_short, r.home_short)})
                            </span>
                          </div>

                          <div className="flex items-center gap-4">
                            <span className="w-10 text-right">{signed(r.spread)}</span>
                            <StatusPill outcome={outcome} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* ---------------------------- O/U TIE-BREAKERS ---------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">O/U Tie-breakers</h2>

        {PLAYERS_ORDERED.map(name => {
          const r = ouByPlayer.get(name) || null;
          if (!r) {
            return (
              <div key={name} className="border rounded p-3 text-sm text-zinc-400">
                {name}
              </div>
            );
          }

          const g = gameByPair.get(`${r.home_short}-${r.away_short}`);
          const outcome = pickOutcomeOU(g, r.ou_choice, r.ou_total);

          return (
            <div key={name} className="border rounded p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TinyLogo url={teamLogo(r.away_short)} alt={r.away_short} />
                <TinyLogo url={teamLogo(r.home_short)} alt={r.home_short} />
                <span className="mr-2">{name}</span>
                <span className="text-zinc-300">
                  {formatGameLabel(r.away_short, r.home_short)}
                </span>
                <span className="ml-3">{r.ou_choice}</span>
                <span className="ml-1">{r.ou_total}</span>
              </div>
              <StatusPill outcome={outcome} />
            </div>
          );
        })}
      </section>

      {/* --------------------------- FULL SCOREBOARD --------------------------- */}
      {showBoard && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">All Games</h2>
          {games.map(g => {
            const hasFinal = g.home_score != null && g.away_score != null;
            const hasLive  = g.live_home_score != null && g.live_away_score != null;
            const home = hasFinal ? g.home_score : hasLive ? g.live_home_score : null;
            const away = hasFinal ? g.away_score : hasLive ? g.live_away_score : null;

            return (
              <div key={g.id} className="border rounded p-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <TinyLogo url={teamLogo(g.away)} alt={g.away} />
                    <TinyLogo url={teamLogo(g.home)} alt={g.home} />
                    <span className="text-sm text-zinc-300">
                      {formatGameLabel(g.away, g.home)}
                    </span>
                </div>
                <div className="tabular-nums">
                  {home != null && away != null ? `${home} — ${away}` : '— —'}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
