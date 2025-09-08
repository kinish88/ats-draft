'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

const YEAR = 2025;

/* ------------------------------- data types ------------------------------- */

type WeekRow = { week_number: number };

type GameRow = {
  id: number;
  home: string;           // short, e.g. 'PHI'
  away: string;           // short, e.g. 'DAL'
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
  spread: number | null;       // line for that team (signed)
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

/* --------------------------------- utils --------------------------------- */

function signed(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n > 0) return `+${n}`;
  return `${n}`;
}

function teamLogo(short: string | null | undefined): string | null {
  if (!short) return null;
  return `/teams/${short}.png`;
}

function matchup(a?: string, b?: string): string {
  if (!a || !b) return '';
  return `${a} v ${b}`;
}

type Outcome = 'win' | 'loss' | 'push' | 'pending';

function pickOutcomeATS(
  game: GameRow | undefined,
  pickedTeam: string,
  spreadForPick: number | null
): Outcome {
  if (!game) return 'pending';
  const finalH = game.home_score;
  const finalA = game.away_score;
  const liveH = game.live_home_score;
  const liveA = game.live_away_score;

  const hasFinal = finalH != null && finalA != null;
  const hasLive = liveH != null && liveA != null;

  const home = hasFinal ? (finalH as number) : hasLive ? (liveH as number) : null;
  const away = hasFinal ? (finalA as number) : hasLive ? (liveA as number) : null;

  if (home == null || away == null) return 'pending';
  if (spreadForPick == null) return 'pending';

  const pickIsHome = pickedTeam === game.home;
  const pickScore = pickIsHome ? home : away;
  const oppScore = pickIsHome ? away : home;

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
  const liveH = game.live_home_score;
  const liveA = game.live_away_score;

  const hasFinal = finalH != null && finalA != null;
  const hasLive = liveH != null && liveA != null;

  const home = hasFinal ? (finalH as number) : hasLive ? (liveH as number) : null;
  const away = hasFinal ? (finalA as number) : hasLive ? (liveA as number) : null;

  if (home == null || away == null) return 'pending';

  const sum = home + away;
  if (sum === total) return 'push';
  if (choice === 'OVER') return sum > total ? 'win' : 'loss';
  return sum < total ? 'win' : 'loss';
}

function outcomeClass(o: Outcome): string {
  if (o === 'win') return 'text-emerald-400';
  if (o === 'loss') return 'text-rose-400';
  if (o === 'push') return 'text-zinc-300';
  return 'text-zinc-400';
}

/* --------------------------------- cells --------------------------------- */

function TinyLogo({ url, alt }: { url: string | null | undefined; alt: string }) {
  if (!url) return <span className="inline-block w-4 h-4 mr-2 align-middle" />;
  // (keep <img> to avoid next/image warnings without config)
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
  return <span className={`${classes}`}>{text}</span>;
}

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
      supabase.rpc('get_week_ou_picks_admin', { p_year: YEAR, p_week: wk }),
    ]);

    setGames((gms.data as GameRow[]) ?? []);
    setSpreadPicks((sp.data as SpreadPickRow[]) ?? []);
    setOuPicks((ou.data as OuPickRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadWeeks();
  }, []);

  useEffect(() => {
    loadAll(week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          const row = payload.new;
          if (!row || !gameIdSet.has(row.id)) return;

          setGames(prev =>
            prev.map(g => (g.id === row.id ? { ...g, ...row } : g))
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

  const playersOrdered = ['Big Dawg', 'Pud', 'Kinish'];

  const picksByPlayer = useMemo(() => {
    const m = new Map<string, SpreadPickRow[]>();
    for (const name of playersOrdered) m.set(name, []);
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
    for (const name of playersOrdered) m.set(name, null);
    for (const r of ouPicks) {
      m.set(r.player_display_name, r);
    }
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
          playersOrdered.map(player => {
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
                      const outcome = pickOutcomeATS(g, r.team_short, r.spread ?? null);

                      return (
                        <div key={`${player}-${idx}`} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TinyLogo url={teamLogo(r.team_short)} alt={r.team_short} />
                            <span className="w-14">{r.team_short}</span>
                            <span className="text-zinc-400 text-sm">
                              ({matchup(r.home_short, r.away_short)})
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

        {playersOrdered.map(name => {
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
                <TinyLogo url={teamLogo(r.home_short)} alt={r.home_short} />
                <TinyLogo url={teamLogo(r.away_short)} alt={r.away_short} />
                <span className="mr-2">{name}</span>
                <span className="text-zinc-300">{matchup(r.home_short, r.away_short)}</span>
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
            const hasLive = g.live_home_score != null && g.live_away_score != null;

            const home = hasFinal ? g.home_score : hasLive ? g.live_home_score : null;
            const away = hasFinal ? g.away_score : hasLive ? g.live_away_score : null;

            return (
              <div key={g.id} className="border rounded p-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TinyLogo url={teamLogo(g.home)} alt={g.home} />
                  <span className="w-10">{g.home}</span>
                  <span className="text-sm text-zinc-500">v</span>
                  <TinyLogo url={teamLogo(g.away)} alt={g.away} />
                  <span className="w-10">{g.away}</span>
                </div>
                <div className="tabular-nums">
                  {home != null && away != null ? `${home} — ${away}` : '— —'}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* no duplicate in-page nav links anymore */}
    </div>
  );
}
