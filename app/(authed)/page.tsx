'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

const YEAR = 2025;

/* ------------------------------- DB row types ------------------------------ */

type WeekRow = { week_number: number };

type GameRow = {
  id: number;
  season_year: number;
  week_number: number;
  home: string;                 // short, e.g., 'PHI'
  away: string;                 // short, e.g., 'DAL'
  kickoff: string | null;
  home_score: number | null;    // final
  away_score: number | null;    // final
  live_home_score: number | null;
  live_away_score: number | null;
  is_final: boolean | null;
  is_live: boolean | null;
};

type SpreadPickAdminRow = {
  pick_id: number;
  pick_number: number;
  player: string;          // 'Big Dawg' | 'Pud' | 'Kinish'
  home_short: string;
  away_short: string;
  team_short: string;
  spread_at_pick: number | null;
};

type OuPickAdminRow = {
  player: string;          // 'Big Dawg' | 'Pud' | 'Kinish'
  home_short: string;
  away_short: string;
  pick_side: 'OVER' | 'UNDER';
  total_at_pick: number;
};

type TeamLogoRow = { short_name: string; logo_url: string | null };

/* ---------------------------------- utils --------------------------------- */

type Outcome = 'win' | 'loss' | 'push' | 'pending';

function signed(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return n > 0 ? `+${n}` : `${n}`;
}

function outcomeClass(o: Outcome): string {
  if (o === 'win') return 'text-emerald-400';
  if (o === 'loss') return 'text-rose-400';
  if (o === 'push') return 'text-amber-300';
  return 'text-zinc-400';
}

function bestScore(g?: GameRow | null): { home: number | null; away: number | null; tag: 'LIVE' | 'FINAL' | null } {
  if (!g) return { home: null, away: null, tag: null };
  const hasLive = g.live_home_score != null && g.live_away_score != null;
  const hasFinal = g.home_score != null && g.away_score != null;

  if (hasLive && !g.is_final) {
    return { home: g.live_home_score!, away: g.live_away_score!, tag: 'LIVE' };
  }
  if (hasFinal) {
    return { home: g.home_score!, away: g.away_score!, tag: 'FINAL' };
  }
  // fallbacks
  if (hasLive) return { home: g.live_home_score!, away: g.live_away_score!, tag: 'LIVE' };
  if (hasFinal) return { home: g.home_score!, away: g.away_score!, tag: 'FINAL' };
  return { home: null, away: null, tag: null };
}

function pickOutcomeATS(game: GameRow | undefined, pickedTeam: string, spreadForPick: number | null): Outcome {
  if (!game || spreadForPick == null) return 'pending';
  const { home, away } = bestScore(game);
  if (home == null || away == null) return 'pending';

  const pickIsHome = pickedTeam === game.home;
  const pickScore = pickIsHome ? home : away;
  const oppScore = pickIsHome ? away : home;

  const adjusted = pickScore + spreadForPick;
  if (adjusted > oppScore) return 'win';
  if (adjusted < oppScore) return 'loss';
  return 'push';
}

function pickOutcomeOU(game: GameRow | undefined, choice: 'OVER' | 'UNDER', total: number): Outcome {
  if (!game) return 'pending';
  const { home, away } = bestScore(game);
  if (home == null || away == null) return 'pending';

  const sum = home + away;
  if (sum === total) return 'push';
  if (choice === 'OVER') return sum > total ? 'win' : 'loss';
  return sum < total ? 'win' : 'loss';
}

/* --------------------------------- cells ---------------------------------- */

function TinyLogo({ url, alt }: { url: string | null | undefined; alt: string }) {
  if (!url) return <span className="inline-block w-5 h-5 mr-2 align-middle" />;
  return (
    <img
      alt={alt}
      src={url}
      className="inline-block w-5 h-5 mr-2 rounded-sm align-middle"
      loading="eager"
    />
  );
}

function StatusPill({ outcome }: { outcome: Outcome }) {
  const text = outcome === 'pending' ? 'pending' : outcome === 'push' ? 'push' : outcome === 'win' ? 'win' : 'loss';
  return <span className={`${outcomeClass(outcome)} tabular-nums`}>{text}</span>;
}

function ScoreText({ g }: { g?: GameRow }) {
  const { home, away, tag } = bestScore(g);
  if (home == null || away == null) return <span className="text-zinc-400 tabular-nums">— —</span>;
  return (
    <span className="tabular-nums">
      {home} — {away}
      {tag ? <span className="ml-2 text-[10px] opacity-70">{tag}</span> : null}
    </span>
  );
}

/* --------------------------------- page ----------------------------------- */

export default function ScoreboardPage() {
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [spreadPicks, setSpreadPicks] = useState<SpreadPickAdminRow[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPickAdminRow[]>([]);
  const [logoMap, setLogoMap] = useState<Record<string, string>>({});
  const [showBoard, setShowBoard] = useState(false);
  const playersOrdered = ['Big Dawg', 'Pud', 'Kinish'];

  /* ------------------------------- data loads ------------------------------ */

  const loadWeeks = useCallback(async () => {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    const list = (data as WeekRow[] | null)?.map((w) => w.week_number) ?? [];
    setWeeks(list.length ? list : Array.from({ length: 18 }, (_, i) => i + 1));
  }, []);

  const loadLogos = useCallback(async () => {
    const { data, error } = await supabase.from('teams').select('short_name, logo_url');
    if (!error && data) {
      const map: Record<string, string> = {};
      (data as TeamLogoRow[]).forEach((t) => {
        if (t.logo_url) map[t.short_name] = t.logo_url;
      });
      setLogoMap(map);
    }
  }, []);

  const teamLogo = useCallback(
    (short: string | null | undefined): string | null => {
      if (!short) return null;
      return logoMap[short] ?? `/teams/${short}.png`;
    },
    [logoMap]
  );

  const loadAll = useCallback(
    async (w: number) => {
      // 1) games (directly from table so we get LIVE + FINAL fields)
      const gq = await supabase
        .from('games')
        .select(
          'id, season_year, week_number, kickoff, home, away, home_score, away_score, live_home_score, live_away_score, is_final, is_live'
        )
        .eq('season_year', YEAR)
        .eq('week_number', w)
        .order('kickoff', { ascending: true });

      const gameRows = (gq.data as GameRow[]) ?? [];
      setGames(gameRows);

      // 2) spread picks (admin RPC has real team shorts + spread)
      const sp = await supabase.rpc('get_week_spread_picks_admin', { p_year: YEAR, p_week: w });
      setSpreadPicks((sp.data as SpreadPickAdminRow[]) ?? []);

      // 3) O/U picks (admin RPC: home/away + side + total)
      const ou = await supabase.rpc('get_week_ou_picks_admin', { p_year: YEAR, p_week: w });
      setOuPicks((ou.data as OuPickAdminRow[]) ?? []);
    },
    []
  );

  useEffect(() => {
    loadWeeks();
    loadLogos();
  }, [loadWeeks, loadLogos]);

  useEffect(() => {
    loadAll(week);
  }, [week, loadAll]);

  /* ------------------------------ realtime sync ---------------------------- */

  useEffect(() => {
    if (!games.length) return;

    const ids = new Set(games.map((g) => g.id));

    const chan = supabase
      .channel('games-live')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games' },
        (payload: RealtimePostgresChangesPayload<GameRow>) => {
          const row = payload.new as Partial<GameRow>;
          if (!row || typeof row.id !== 'number' || !ids.has(row.id)) return;
          setGames((prev) => prev.map((g) => (g.id === row.id ? { ...g, ...row } as GameRow : g)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chan);
    };
  }, [games]);

  /* ------------------------------ derived maps ---------------------------- */

  const gameByPair = useMemo(() => {
    const m = new Map<string, GameRow>();
    for (const g of games) m.set(`${g.home}-${g.away}`, g);
    return m;
  }, [games]);

  const picksByPlayer = useMemo(() => {
    const m = new Map<string, SpreadPickAdminRow[]>();
    for (const name of playersOrdered) m.set(name, []);
    for (const p of spreadPicks) {
      const key = p.player ?? 'Unknown';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    for (const [, arr] of m) arr.sort((a, b) => (a.pick_number ?? 0) - (b.pick_number ?? 0));
    return m;
  }, [playersOrdered, spreadPicks]);

  const ouByPlayer = useMemo(() => {
    const m = new Map<string, OuPickAdminRow | null>();
    for (const name of playersOrdered) m.set(name, null);
    for (const r of ouPicks) m.set(r.player, r);
    return m;
  }, [playersOrdered, ouPicks]);

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      {/* header */}
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
              {weeks.map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
          </div>
          <label className="text-sm flex items-center gap-2 select-none">
            <input type="checkbox" checked={showBoard} onChange={(e) => setShowBoard(e.target.checked)} />
            Show full scoreboard
          </label>
        </div>
      </header>

      {/* PICKS grouped by player */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Picks</h2>

        {playersOrdered.map((player) => {
          const rows = picksByPlayer.get(player) ?? [];
          return (
            <div key={player} className="border rounded p-4">
              <div className="font-semibold mb-3">{player}</div>

              {rows.length === 0 ? (
                <div className="text-sm text-zinc-400">No picks</div>
              ) : (
                <div className="space-y-2">
                  {rows.map((r) => {
                    const g = gameByPair.get(`${r.home_short}-${r.away_short}`);
                    const outcome = pickOutcomeATS(g, r.team_short, r.spread_at_pick ?? null);

                    return (
                      <div key={r.pick_id} className="flex items-center justify-between">
                        {/* left: logos + matchup + picked team */}
                        <div className="flex items-center gap-2">
                          <TinyLogo url={teamLogo(r.home_short)} alt={r.home_short} />
                          <TinyLogo url={teamLogo(r.away_short)} alt={r.away_short} />
                          <span className="text-zinc-300 text-sm">
                            {r.home_short} v {r.away_short}
                          </span>
                          <span className="ml-3">Pick: {r.team_short}</span>
                          <span className="ml-2 text-zinc-400 text-sm">{signed(r.spread_at_pick)}</span>
                        </div>

                        {/* right: score + status */}
                        <div className="flex items-center gap-4">
                          <ScoreText g={g} />
                          <StatusPill outcome={outcome} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* O/U TIE-BREAKERS */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">O/U Tie-breakers</h2>
        {playersOrdered.map((name) => {
          const r = ouByPlayer.get(name) || null;
          if (!r) {
            return (
              <div key={name} className="border rounded p-3 text-sm text-zinc-400">
                {name}: (no pick)
              </div>
            );
          }
          const g = gameByPair.get(`${r.home_short}-${r.away_short}`);
          const outcome = pickOutcomeOU(g, r.pick_side, r.total_at_pick);

          return (
            <div key={name} className="border rounded p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* exactly two logos (home & away), not duplicated */}
                <TinyLogo url={teamLogo(r.home_short)} alt={r.home_short} />
                <TinyLogo url={teamLogo(r.away_short)} alt={r.away_short} />
                <span className="mr-2">{name}</span>
                <span className="text-zinc-300">
                  {r.home_short} v {r.away_short}
                </span>
                <span className="ml-3">{r.pick_side}</span>
                <span className="ml-1">{r.total_at_pick}</span>
              </div>

              <div className="flex items-center gap-4">
                <ScoreText g={g} />
                <StatusPill outcome={outcome} />
              </div>
            </div>
          );
        })}
      </section>

      {/* FULL SCOREBOARD (optional) */}
      {showBoard && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">All Games</h2>
          {games.map((g) => (
            <div key={g.id} className="border rounded p-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TinyLogo url={teamLogo(g.home)} alt={g.home} />
                <span className="w-10">{g.home}</span>
                <span className="text-sm text-zinc-500">v</span>
                <TinyLogo url={teamLogo(g.away)} alt={g.away} />
                <span className="w-10">{g.away}</span>
              </div>
              <ScoreText g={g} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
