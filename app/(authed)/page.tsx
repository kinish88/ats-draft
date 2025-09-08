'use client';

import { useEffect, useMemo, useState } from 'react';
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

type BaseGameIdRow = { game_id: number };

type AdminSpreadRow = {
  pick_id?: number;
  pick_number: number;
  player: string;
  home_short: string;
  away_short: string;
  team_short: string;
  spread_at_pick: number | null;
};

type SpreadPickRow = {
  pick_number: number;
  player_display_name: string;
  team_short: string;
  spread: number | null;
  home_short: string;
  away_short: string;
};

type AdminOuRow = {
  player: string;
  home_short: string;
  away_short: string;
  pick_side: string;     // may be mixed case / whitespace
  total_at_pick: number;
};

type OuPickRow = {
  player_display_name: string;
  home_short: string;
  away_short: string;
  ou_choice: 'OVER' | 'UNDER';
  ou_total: number;
};

function isGameRow(x: unknown): x is GameRow {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.id === 'number' && typeof r.home === 'string' && typeof r.away === 'string';
}

/* --------------------------------- config -------------------------------- */

const LOGO_BASE = (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

/* --------------------------------- utils --------------------------------- */

function signed(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return n > 0 ? `+${n}` : `${n}`;
}

function teamLogo(short?: string | null): string | null {
  if (!short) return null;
  return LOGO_BASE ? `${LOGO_BASE}/${short}.png` : `/teams/${short}.png`;
}

function matchup(a?: string, b?: string): string {
  if (!a || !b) return '';
  return `${a} v ${b}`;
}

type Outcome = 'win' | 'loss' | 'push' | 'pending';

function pickOutcomeATS(game: GameRow | undefined, pickedTeam: string, spreadForPick: number | null): Outcome {
  if (!game) return 'pending';
  const hasFinal = game.home_score != null && game.away_score != null;
  const hasLive = game.live_home_score != null && game.live_away_score != null;

  const home = hasFinal ? game.home_score : hasLive ? game.live_home_score : null;
  const away = hasFinal ? game.away_score : hasLive ? game.live_away_score : null;

  if (home == null || away == null) return 'pending';
  if (spreadForPick == null) return 'pending';

  const pickIsHome = pickedTeam === game.home;
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

  const sum = (home ?? 0) + (away ?? 0);
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

function scoreInfo(game?: GameRow): { text: string; isLive: boolean; isFinal: boolean } {
  if (!game) return { text: '—', isLive: false, isFinal: false };
  const hasFinal = game.home_score != null && game.away_score != null;
  const hasLive = game.live_home_score != null && game.live_away_score != null;

  const home = hasFinal ? game.home_score : hasLive ? game.live_home_score : null;
  const away = hasFinal ? game.away_score : hasLive ? game.live_away_score : null;

  if (home == null || away == null) return { text: '—', isLive: false, isFinal: false };
  return {
    text: `${home}–${away}`,
    isLive: Boolean(game.is_live) || (!hasFinal && hasLive),
    isFinal: Boolean(game.is_final) || hasFinal,
  };
}

/* --------------------------------- cells --------------------------------- */

function TinyLogo({ url, alt, className }: { url: string | null; alt: string; className?: string }) {
  if (!url) return <span className={`inline-block align-middle ${className || 'w-4 h-4 mr-2'}`} />;
  return <img alt={alt} src={url} className={`inline-block rounded-sm align-middle ${className || 'w-4 h-4 mr-2'}`} loading="eager" />;
}

function StatusPill({ outcome }: { outcome: Outcome }) {
  const classes = outcomeClass(outcome);
  const text = outcome === 'pending' ? 'pending' : outcome === 'push' ? 'push' : outcome === 'win' ? 'win' : 'loss';
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

  /* ------------------------------ load weeks ------------------------------ */

  const loadWeeks = async () => {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    const list = Array.isArray(data) ? (data as WeekRow[]).map(w => w.week_number) : [];
    setWeeks(list.length ? list : Array.from({ length: 18 }, (_, i) => i + 1));
  };

  /* ------------------------------- load all ------------------------------- */

  const loadAll = async (w: number) => {
    setLoading(true);

    // 1) ids for the week
    const { data: baseGames } = await supabase.rpc('get_week_games_for_scoring', { p_year: YEAR, p_week: w });
    const ids = (Array.isArray(baseGames) ? (baseGames as BaseGameIdRow[]) : []).map(r => Number(r.game_id));

    // 2) full game rows (include live columns)
    let fullGames: GameRow[] = [];
    if (ids.length) {
      const { data: rows } = await supabase
        .from('games')
        .select('id,home,away,home_score,away_score,live_home_score,live_away_score,is_final,is_live')
        .in('id', ids);

      fullGames = (rows ?? []).map(r => ({
        id: Number(r.id),
        home: r.home,
        away: r.away,
        home_score: r.home_score ?? null,
        away_score: r.away_score ?? null,
        live_home_score: r.live_home_score ?? null,
        live_away_score: r.live_away_score ?? null,
        is_final: (typeof r.is_final === 'boolean'
          ? r.is_final
          : (r.home_score != null && r.away_score != null)) as boolean,
        is_live: (typeof r.is_live === 'boolean' ? r.is_live : null) as boolean | null,
      }));
    }
    setGames(fullGames);

    // 3) picks
    const [{ data: sp }, { data: ou }] = await Promise.all([
      supabase.rpc('get_week_spread_picks_admin', { p_year: YEAR, p_week: w }),
      supabase.rpc('get_week_ou_picks_admin', { p_year: YEAR, p_week: w }),
    ]);

    const spMapped: SpreadPickRow[] = (Array.isArray(sp) ? (sp as AdminSpreadRow[]) : []).map(r => ({
      pick_number: r.pick_number,
      player_display_name: r.player,
      team_short: r.team_short,
      spread: r.spread_at_pick,
      home_short: r.home_short,
      away_short: r.away_short,
    }));
    setSpreadPicks(spMapped);

    const ouMapped: OuPickRow[] = (Array.isArray(ou) ? (ou as AdminOuRow[]) : []).map(r => {
      const side = String(r.pick_side).trim().toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
      return {
        player_display_name: r.player,
        home_short: r.home_short,
        away_short: r.away_short,
        ou_choice: side,
        ou_total: r.total_at_pick,
      };
    });
    setOuPicks(ouMapped);

    setLoading(false);
  };

  useEffect(() => {
    loadWeeks();
  }, []);

  useEffect(() => {
    loadAll(week);
  }, [week]);

  /* ------------------------------ realtime live --------------------------- */

  useEffect(() => {
    if (!games.length) return;

    const idSet = new Set(games.map(g => g.id));
    const chan = supabase
      .channel('live-games')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games' },
        (payload: RealtimePostgresChangesPayload<GameRow>) => {
          const rowUnknown = payload.new as unknown;
          if (!isGameRow(rowUnknown) || !idSet.has(rowUnknown.id)) return;
          setGames(prev => prev.map(g => (g.id === rowUnknown.id ? { ...g, ...rowUnknown } : g)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chan);
    };
  }, [games]);

  /* ------------------------------ derived maps ---------------------------- */

  const playersOrdered = ['Big Dawg', 'Pud', 'Kinish'];

  const gameByPair = useMemo(() => {
    const m = new Map<string, GameRow>();
    for (const g of games) m.set(`${g.home}-${g.away}`, g);
    return m;
  }, [games]);

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
    for (const r of ouPicks) m.set(r.player_display_name, r);
    return m;
  }, [ouPicks]);

  /* -------------------------------- render -------------------------------- */

  const nflLogo = teamLogo('NFL');

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* small global styles for live flash + final bold */}
      <style jsx global>{`
        @keyframes scoreFlash { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
        .score-live { animation: scoreFlash 1s ease-in-out infinite; }
        .score-final { font-weight: 700; }
      `}</style>

      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TinyLogo url={nflLogo} alt="NFL" className="w-6 h-6" />
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
                      const s = scoreInfo(g);

                      return (
                        <div key={`${player}-${idx}`} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {/* one logo = picked team */}
                            <TinyLogo url={teamLogo(r.team_short)} alt={r.team_short} />
                            {/* Short code in bold (better on mobile) */}
                            <span className="font-semibold">{r.team_short}</span>
                            <span className="text-zinc-400 text-sm">({matchup(r.home_short, r.away_short)})</span>
                          </div>

                          <div className="flex items-center gap-4">
                            <span className="w-12 text-right">{signed(r.spread)}</span>
                            <span className={`tabular-nums text-sm text-zinc-300 ${s.isLive ? 'score-live' : s.isFinal ? 'score-final' : ''}`}>
                              {s.text}
                            </span>
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
          const s = scoreInfo(g);

          return (
            <div key={name} className="border rounded p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* each team once */}
                <TinyLogo url={teamLogo(r.home_short)} alt={r.home_short} />
                <TinyLogo url={teamLogo(r.away_short)} alt={r.away_short} />
                <span className="font-semibold">{name}</span>
                <span className="text-zinc-300">{matchup(r.home_short, r.away_short)}</span>
                <span className="ml-3">{r.ou_choice}</span>
                <span className="ml-1">{r.ou_total}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className={`tabular-nums text-sm text-zinc-300 ${s.isLive ? 'score-live' : s.isFinal ? 'score-final' : ''}`}>
                  {s.text}
                </span>
                <StatusPill outcome={outcome} />
              </div>
            </div>
          );
        })}
      </section>

      {/* --------------------------- FULL SCOREBOARD --------------------------- */}
      {showBoard && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">All Games</h2>
          {games.length === 0 ? (
            <div className="text-sm text-zinc-400">No games</div>
          ) : (
            games.map(g => {
              const s = scoreInfo(g);
              return (
                <div key={g.id} className="border rounded p-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TinyLogo url={teamLogo(g.home)} alt={g.home} />
                    <span className="w-10">{g.home}</span>
                    <span className="text-sm text-zinc-500">v</span>
                    <TinyLogo url={teamLogo(g.away)} alt={g.away} />
                    <span className="w-10">{g.away}</span>
                  </div>
                  <div className={`tabular-nums ${s.isLive ? 'score-live' : s.isFinal ? 'score-final' : ''}`}>
                    {s.text}
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}
