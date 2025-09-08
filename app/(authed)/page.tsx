'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// ---------- constants ----------
const YEAR = 2025;
const LOGO_BASE = (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE ?? '').replace(/\/?$/, '/');

// Short -> Full (for the bold team name on the pick)
const TEAM_FULL: Record<string, string> = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers',
  SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};

// Full -> Short fallback (if the RPC returns full team names)
const FULL_TO_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(TEAM_FULL).map(([s, f]) => [f.toLowerCase(), s])
);

// ---------- types ----------
type WeekRow = { week_number: number };

type GameRow = {
  id: number;
  home: string; // short e.g. 'BUF'
  away: string; // short e.g. 'BAL'
  home_score: number | null;
  away_score: number | null;
  live_home_score: number | null;
  live_away_score: number | null;
  is_final: boolean | null;
  is_live: boolean | null;
};

type RawGame = Partial<GameRow> & { id?: number; game_id?: number; home: string; away: string; kickoff?: string };

type SpreadPickPublic = {
  pick_number: number;
  picker: string;          // display name
  picked_team: string;     // short or full
  matchup: string;         // "BUF v BAL"
  spread_at_pick: number | null;
};

type OuPickPublic = {
  picker: string;          // display name
  matchup: string;         // "BUF v BAL"
  pick_side: 'OVER' | 'UNDER';
  total_at_pick: number;
};

type Outcome = 'win' | 'loss' | 'push' | 'pending';

// ---------- utils ----------

function hasId(obj: unknown): obj is { id: number } {
  return !!obj && typeof (obj as { id?: unknown }).id === 'number';
}

function parseMatchup(m: string): { home: string; away: string } | null {
  const parts = m.split(' v ');
  if (parts.length !== 2) return null;
  return { home: parts[0].trim().toUpperCase(), away: parts[1].trim().toUpperCase() };
}

function toShortTeam(nameOrShort: string): string {
  const s = nameOrShort.toUpperCase();
  if (TEAM_FULL[s]) return s; // already short
  const short = FULL_TO_SHORT[nameOrShort.toLowerCase()];
  return short ?? s;
}

function logoUrl(short?: string | null): string | null {
  if (!short) return null;
  return `${LOGO_BASE}${short}.png`;
}

function crestUrl(): string | null {
  return `${LOGO_BASE}NFL.png`;
}

function signed(n: number | null | undefined): string {
  if (n == null) return '';
  return n > 0 ? `+${n}` : `${n}`;
}

function outcomeClass(o: Outcome): string {
  if (o === 'win') return 'text-emerald-400';
  if (o === 'loss') return 'text-rose-400';
  if (o === 'push') return 'text-zinc-300';
  return 'text-zinc-400';
}

function calcATSPending(game?: GameRow | null): boolean {
  if (!game) return true;
  const hasFinal = game.home_score != null && game.away_score != null;
  const hasLive = game.live_home_score != null && game.live_away_score != null;
  return !(hasFinal || hasLive);
}

function pickOutcomeATS(game: GameRow | undefined, pickedShort: string, spreadForPick: number | null): Outcome {
  if (!game || spreadForPick == null) return 'pending';
  const hasFinal = game.home_score != null && game.away_score != null;
  const hasLive = game.live_home_score != null && game.live_away_score != null;
  const home = hasFinal ? game.home_score : hasLive ? game.live_home_score : null;
  const away = hasFinal ? game.away_score : hasLive ? game.live_away_score : null;
  if (home == null || away == null) return 'pending';

  const pickIsHome = pickedShort === game.home;
  const pickScore = pickIsHome ? home : away;
  const oppScore = pickIsHome ? away : home;

  const adj = (pickScore ?? 0) + spreadForPick;
  if (adj > (oppScore ?? 0)) return 'win';
  if (adj < (oppScore ?? 0)) return 'loss';
  return 'push';
}

function pickOutcomeOU(game: GameRow | undefined, choice: 'OVER' | 'UNDER', total: number): Outcome {
  if (!game) return 'pending';
  const hasFinal = game.home_score != null && game.away_score != null;
  const hasLive = game.live_home_score != null && game.live_away_score != null;
  const home = hasFinal ? game.home_score : hasLive ? game.live_home_score : null;
  const away = hasFinal ? game.away_score : hasLive ? game.live_away_score : null;
  if (home == null || away == null) return 'pending';

  const sum = home + away;
  if (sum === total) return 'push';
  return choice === 'OVER' ? (sum > total ? 'win' : 'loss') : (sum < total ? 'win' : 'loss');
}

// ---------- tiny cells ----------
function TinyLogo({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return <span className="inline-block w-4 h-4 mr-2 align-middle" />;
  return <img alt={alt} src={url} className="inline-block w-4 h-4 mr-2 rounded-sm align-middle" loading="eager" />;
}

function StatusPill({ outcome }: { outcome: Outcome }) {
  const txt = outcome === 'pending' ? 'pending' : outcome;
  return <span className={outcomeClass(outcome)}>{txt}</span>;
}

// ============================== PAGE =======================================
export default function ScoreboardPage() {
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [spreadPicks, setSpreadPicks] = useState<SpreadPickPublic[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPickPublic[]>([]);
  const [showBoard, setShowBoard] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // ---- load weeks once
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
      const arr = (data ?? []) as WeekRow[];
      const list = arr.map(w => w.week_number);
      setWeeks(list.length ? list : Array.from({ length: 18 }, (_, i) => i + 1));
    })();
  }, []);

  // ---- load all data for week
  const loadAll = async (w: number) => {
    setLoading(true);
    const [sp, ou, gms] = await Promise.all([
      supabase.rpc('get_week_spread_picks', { p_year: YEAR, p_week: w }),
      supabase.rpc('get_week_ou_picks', { p_year: YEAR, p_week: w }),
      supabase.rpc('get_week_games_for_scoring', { p_year: YEAR, p_week: w }),
    ]);

    // games
    const gmsRaw: unknown[] = (gms.data ?? []) as unknown[];
    const gmsNorm: GameRow[] = (gmsRaw as RawGame[]).map((r) => ({
      id: Number(r.id ?? r.game_id),
      home: r.home.toUpperCase(),
      away: r.away.toUpperCase(),
      home_score: r.home_score ?? null,
      away_score: r.away_score ?? null,
      live_home_score: (r as RawGame).live_home_score ?? null,
      live_away_score: (r as RawGame).live_away_score ?? null,
      is_final: (r as RawGame).is_final ?? (r.home_score != null && r.away_score != null),
      is_live: (r as RawGame).is_live ?? null,
    }));
    setGames(gmsNorm);

    // spread picks
    setSpreadPicks(((sp.data ?? []) as SpreadPickPublic[]).map(p => ({
      ...p,
      picker: p.picker, // keep as-is
      picked_team: toShortTeam(p.picked_team),
    })));

    // ou picks
    setOuPicks(((ou.data ?? []) as OuPickPublic[]).map(r => ({
      ...r,
      pick_side: r.pick_side === 'UNDER' ? 'UNDER' : 'OVER',
    })));

    setLoading(false);
  };

  useEffect(() => {
    loadAll(week);
  }, [week]);

  // ---- realtime: update any games in our current list
  useEffect(() => {
  if (!games.length) return;

  const idSet = new Set(games.map(g => g.id));

  const chan = supabase
    .channel('scoreboard-games')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games' },
      (payload: RealtimePostgresChangesPayload<Partial<GameRow>>) => {
        const row = payload.new;
        if (!hasId(row) || !idSet.has(row.id)) return;

        setGames(prev =>
          prev.map(g => (g.id === row.id ? { ...g, ...(row as Partial<GameRow>) } : g))
        );
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(chan);
  };
}, [games]);


  // ---- derived
  const gameByPair = useMemo(() => {
    const m = new Map<string, GameRow>();
    for (const g of games) m.set(`${g.home}-${g.away}`, g);
    return m;
  }, [games]);

  const playersOrdered = ['Big Dawg', 'Pud', 'Kinish'];

  const picksByPlayer = useMemo(() => {
    const groups = new Map<string, SpreadPickPublic[]>();
    for (const name of playersOrdered) groups.set(name, []);
    for (const p of spreadPicks) {
      const arr = groups.get(p.picker) ?? [];
      arr.push(p);
      groups.set(p.picker, arr);
    }
    for (const [, arr] of groups) arr.sort((a, b) => (a.pick_number ?? 0) - (b.pick_number ?? 0));
    return groups;
  }, [spreadPicks]);

  const ouByPlayer = useMemo(() => {
    const m = new Map<string, OuPickPublic | null>();
    for (const name of playersOrdered) m.set(name, null);
    for (const r of ouPicks) m.set(r.picker, r);
    return m;
  }, [ouPicks]);

  // ============================== RENDER ===================================

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* header with NFL crest */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TinyLogo url={crestUrl()} alt="NFL" />
          <h1 className="text-2xl font-semibold">Week {week} Scoreboard</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-sm opacity-70">Week</label>
            <select
              className="border rounded p-1 bg-transparent"
              value={week}
              onChange={(e) => setWeek(parseInt(e.target.value, 10))}
            >
              {weeks.map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </div>
          <label className="text-sm flex items-center gap-2 select-none">
            <input type="checkbox" checked={showBoard} onChange={(e) => setShowBoard(e.target.checked)} />
            Show full scoreboard
          </label>
        </div>
      </header>

      {/* --------------------- PICKS grouped by player ---------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Picks</h2>
        {loading ? (
          <div className="text-sm text-zinc-400">Loading…</div>
        ) : (
          playersOrdered.map((player) => {
            const rows = picksByPlayer.get(player) ?? [];
            return (
              <div key={player} className="border rounded p-4">
                <div className="font-semibold mb-3">{player}</div>
                {rows.length === 0 ? (
                  <div className="text-sm text-zinc-400">No picks</div>
                ) : (
                  <div className="space-y-2">
                    {rows.map((r) => {
                      const parsed = parseMatchup(r.matchup);
                      const home = parsed?.home ?? '';
                      const away = parsed?.away ?? '';
                      const pairKey = `${home}-${away}`;
                      const g = gameByPair.get(pairKey);
                      const outcome = pickOutcomeATS(g, r.picked_team, r.spread_at_pick);

                      const hasFinal = g?.home_score != null && g?.away_score != null;
                      const hasLive = g?.live_home_score != null && g?.live_away_score != null;
                      const sHome = hasFinal ? g?.home_score : hasLive ? g?.live_home_score : null;
                      const sAway = hasFinal ? g?.away_score : hasLive ? g?.live_away_score : null;

                      const pickShort = r.picked_team;
                      const pickFull = TEAM_FULL[pickShort] ?? r.picked_team;

                      return (
                        <div key={`${player}-${r.pick_number}`} className="flex items-center justify-between">
                          {/* left: pick badge */}
                          <div className="flex items-center gap-2">
                            <TinyLogo url={logoUrl(pickShort)} alt={pickShort} />
                            <span className="font-medium">{pickFull}</span>
                            <span className="text-zinc-400 text-sm ml-2">
                              ({home} v {away})
                            </span>
                          </div>

                          {/* right: spread, score, result */}
                          <div className="flex items-center gap-4">
                            <span className="w-12 text-right tabular-nums">{signed(r.spread_at_pick)}</span>
                            <span className="w-16 text-right tabular-nums">
                              {sHome != null && sAway != null ? `${sHome} — ${sAway}` : '— —'}
                            </span>
                            <StatusPill outcome={calcATSPending(g) ? 'pending' : outcome} />
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

      {/* ----------------------- O/U TIE-BREAKERS -------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">O/U Tie-breakers</h2>
        {playersOrdered.map((name) => {
          const r = ouByPlayer.get(name);
          if (!r) {
            return (
              <div key={name} className="border rounded p-3 text-sm text-zinc-400">
                {name}
              </div>
            );
          }
          const parsed = parseMatchup(r.matchup);
          const home = parsed?.home ?? '';
          const away = parsed?.away ?? '';
          const g = gameByPair.get(`${home}-${away}`);
          const outcome = pickOutcomeOU(g, r.pick_side, r.total_at_pick);

          const hasFinal = g?.home_score != null && g?.away_score != null;
          const hasLive = g?.live_home_score != null && g?.live_away_score != null;
          const sHome = hasFinal ? g?.home_score : hasLive ? g?.live_home_score : null;
          const sAway = hasFinal ? g?.away_score : hasLive ? g?.live_away_score : null;

          return (
            <div key={name} className="border rounded p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* Single crest for O/U “pick” */}
                <TinyLogo url={crestUrl()} alt="NFL" />
                <span className="mr-2">{name}</span>
                <span className="text-zinc-300">({home} v {away})</span>
                <span className="ml-3">{r.pick_side}</span>
                <span className="ml-1">{r.total_at_pick}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="w-16 text-right tabular-nums">
                  {sHome != null && sAway != null ? `${sHome} — ${sAway}` : '— —'}
                </span>
                <StatusPill outcome={outcome} />
              </div>
            </div>
          );
        })}
      </section>

      {/* ------------------------- FULL SCOREBOARD -------------------------- */}
      {showBoard && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">All Games</h2>
          {games.map((g) => {
            const hasFinal = g.home_score != null && g.away_score != null;
            const hasLive = g.live_home_score != null && g.live_away_score != null;
            const sHome = hasFinal ? g.home_score : hasLive ? g.live_home_score : null;
            const sAway = hasFinal ? g.away_score : hasLive ? g.live_away_score : null;

            return (
              <div key={g.id} className="border rounded p-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TinyLogo url={logoUrl(g.home)} alt={g.home} />
                  <span className="w-10">{g.home}</span>
                  <span className="text-sm text-zinc-500">v</span>
                  <TinyLogo url={logoUrl(g.away)} alt={g.away} />
                  <span className="w-10">{g.away}</span>
                </div>
                <div className="tabular-nums">
                  {sHome != null && sAway != null ? `${sHome} — ${sAway}` : '— —'}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
