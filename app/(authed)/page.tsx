'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;
const PLAYERS_ORDERED = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* ------------------------------- data types ------------------------------- */

type WeekRow = { week_number: number };

type GameRow = {
  id: number;
  home: string;           // short code (e.g. PHI)
  away: string;           // short code (e.g. DAL)
  home_score: number | null;
  away_score: number | null;
  live_home_score: number | null;
  live_away_score: number | null;
  is_final: boolean | null;
  is_live: boolean | null;
};

type RpcBaseGameRowUnknown = {
  game_id?: unknown;
  home?: unknown;
  away?: unknown;
  home_score?: unknown;
  away_score?: unknown;
};

type DbGameUnknown = {
  id?: unknown;
  home?: unknown;
  away?: unknown;
  home_score?: unknown;
  away_score?: unknown;
  live_home_score?: unknown;
  live_away_score?: unknown;
  is_final?: unknown;
  is_live?: unknown;
};

type AdminSpreadRowUnknown = {
  pick_id?: unknown;
  pick_number?: unknown;
  player?: unknown;
  home_short?: unknown;
  away_short?: unknown;
  team_short?: unknown;
  spread_at_pick?: unknown;
};

type AdminOuRowUnknown = {
  player?: unknown;
  home_short?: unknown;
  away_short?: unknown;
  pick_side?: unknown;
  total_at_pick?: unknown;
};

type SpreadPickRow = {
  pick_number: number;
  player_display_name: string;
  team_short: string;     // picked team short
  spread: number | null;  // signed line for picked team
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

/* --------------------------------- config -------------------------------- */

const LOGO_BASE = (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

/* --------------------------------- utils --------------------------------- */

function getField(o: unknown, key: string): unknown {
  if (!o || typeof o !== 'object') return undefined;
  return (o as Record<string, unknown>)[key];
}

function toNumOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}
function toStr(x: unknown, fallback = ''): string {
  return typeof x === 'string' ? x : x == null ? fallback : String(x);
}
function toBoolOrNull(x: unknown): boolean | null {
  if (typeof x === 'boolean') return x;
  return null;
}

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
  // Keep <img> to avoid next/image config churn; warnings are fine.
  return (
    <img
      alt={alt}
      src={url}
      className={`inline-block rounded-sm align-middle ${className || 'w-4 h-4 mr-2'}`}
      loading="eager"
    />
  );
}

function StatusPill({ outcome }: { outcome: Outcome }) {
  const classes = outcomeClass(outcome);
  const text = outcome === 'pending' ? 'pending' : outcome === 'push' ? 'push' : outcome === 'win' ? 'win' : 'loss';
  return <span className={`${classes}`}>{text}</span>;
}

/* --------------------------------- page ---------------------------------- */

export default function ScoreboardPage() {
  const [week, setWeek] = useState<number | null>(null);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [spreadPicks, setSpreadPicks] = useState<SpreadPickRow[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPickRow[]>([]);
  const [showBoard, setShowBoard] = useState(false);
  const [loading, setLoading] = useState(true);

  /* ------------------------------ load weeks ------------------------------ */

  const loadWeeks = async () => {
  const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const list = arr
    .map((w) => (w && typeof w === 'object' ? (w as { week_number: number }).week_number : undefined))
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);

  setWeeks(list.length ? list : Array.from({ length: 18 }, (_, i) => i + 1));

  // Set default to the latest available week on first load
  if (week === null) {
    const def = list.length ? list[list.length - 1] : 1;
    setWeek(def);
  }
};


  /* ------------------------------- load all ------------------------------- */

  const loadAll = async (w: number) => {
    setLoading(true);

    // 1) Base RPC (finals)
    const { data: base } = await supabase.rpc('get_week_games_for_scoring', { p_year: YEAR, p_week: w });
    const baseArr = Array.isArray(base) ? (base as unknown[]) : [];

    const baseMapped = baseArr
      .map((r): GameRow | null => {
        const row = r as RpcBaseGameRowUnknown;
        const id = toNumOrNull(row.game_id);
        const home = toStr(row.home);
        const away = toStr(row.away);
        const hs = toNumOrNull(row.home_score);
        const as = toNumOrNull(row.away_score);
        if (id == null || !home || !away) return null;
        return {
          id,
          home,
          away,
          home_score: hs,
          away_score: as,
          live_home_score: null,
          live_away_score: null,
          is_final: hs != null && as != null ? true : null,
          is_live: null,
        };
      })
      .filter((g): g is GameRow => g !== null);

    let merged = baseMapped;

    // 2) Merge in live/status from games table
    const ids = merged.map((g) => g.id);
    if (ids.length) {
      const { data: liveRows } = await supabase
        .from('games')
        .select('id,home,away,home_score,away_score,live_home_score,live_away_score,is_final,is_live')
        .in('id', ids);

      const liveArr = Array.isArray(liveRows) ? (liveRows as unknown[]) : [];
      if (liveArr.length) {
        const byId = new Map<number, DbGameUnknown>();
        for (const r of liveArr) {
          const rr = r as DbGameUnknown;
          const id = toNumOrNull(rr.id);
          if (id != null) byId.set(id, rr);
        }

        merged = merged.map((g) => {
          const r = byId.get(g.id);
          if (!r) return g;
          const hs = toNumOrNull(r.home_score);
          const as = toNumOrNull(r.away_score);
          const lhs = toNumOrNull(r.live_home_score);
          const las = toNumOrNull(r.live_away_score);
          const fin = toBoolOrNull(r.is_final);
          const liv = toBoolOrNull(r.is_live);

          return {
            id: g.id,
            home: toStr(r.home, g.home),
            away: toStr(r.away, g.away),
            home_score: hs ?? g.home_score,
            away_score: as ?? g.away_score,
            live_home_score: lhs ?? g.live_home_score,
            live_away_score: las ?? g.live_away_score,
            is_final: fin ?? g.is_final,
            is_live: liv ?? g.is_live,
          };
        });
      }
    }

    setGames(merged);

    // 3) Picks  — direct from table, no RPC
// 3) Picks — direct from table, no RPC
const { data: sp, error: spErr } = await supabase
  .from('picks')
  .select('pick_number, player_display_name, team_short, spread_at_pick, home_short, away_short')
  .eq('season_year', YEAR)
  .eq('week_id', w)
  .order('pick_number', { ascending: true });

if (spErr) console.error('spread picks fetch error', spErr);

// Define a safe shape for reads (no `any`)
type PicksSelectRow = {
  pick_number?: unknown;
  player_display_name?: unknown;
  team_short?: unknown;
  spread_at_pick?: unknown;
  home_short?: unknown;
  away_short?: unknown;
};

const spArr = Array.isArray(sp) ? (sp as unknown[]) : [];

const spMapped: SpreadPickRow[] = spArr.map((r) => {
  const x = r as PicksSelectRow;
  return {
    pick_number: toNumOrNull(x.pick_number) ?? 0,
    player_display_name: toStr(x.player_display_name),
    team_short: toStr(x.team_short),
    spread: toNumOrNull(x.spread_at_pick),
    home_short: toStr(x.home_short),
    away_short: toStr(x.away_short),
  };
});

setSpreadPicks(spMapped);

// OU block can stay as-is (it doesn’t use `any`)


// keep OU as-is
const { data: ou } = await supabase.rpc('get_week_ou_picks_admin', { p_year: YEAR, p_week: w });
const ouArr = Array.isArray(ou) ? (ou as unknown[]) : [];
const ouMapped: OuPickRow[] = ouArr.map((r) => {
  const x = r as AdminOuRowUnknown;
  const sideRaw = toStr(x.pick_side).trim().toUpperCase();
  const side: 'OVER' | 'UNDER' = sideRaw === 'UNDER' ? 'UNDER' : 'OVER';
  return {
    player_display_name: toStr(x.player),
    home_short: toStr(x.home_short),
    away_short: toStr(x.away_short),
    ou_choice: side,
    ou_total: toNumOrNull(x.total_at_pick) ?? 0,
  };
});
setOuPicks(ouMapped);


    setLoading(false);
  };

  useEffect(() => {
    loadWeeks();
  }, []);

  useEffect(() => {
  if (week != null) loadAll(week);
}, [week]);


  /* ------------------------------ realtime live --------------------------- */

  // keep a stable Set of the game IDs currently on screen
  const idSetRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    idSetRef.current = new Set(games.map((g) => g.id));
  }, [games]);

  // Subscribe ONCE to games updates
  useEffect(() => {
    const chan = supabase
      .channel('live-games')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games' },
        (payload) => {
          const u = payload.new as Record<string, unknown> | null;
          const id = typeof u?.id === 'number' ? (u.id as number) : null;
          if (id == null || !idSetRef.current.has(id)) return;

          const n = {
            home: typeof u?.home === 'string' ? (u.home as string) : undefined,
            away: typeof u?.away === 'string' ? (u.away as string) : undefined,
            home_score: typeof u?.home_score === 'number' ? (u.home_score as number) : undefined,
            away_score: typeof u?.away_score === 'number' ? (u.away_score as number) : undefined,
            live_home_score: typeof u?.live_home_score === 'number' ? (u.live_home_score as number) : undefined,
            live_away_score: typeof u?.live_away_score === 'number' ? (u.live_away_score as number) : undefined,
            is_final: typeof u?.is_final === 'boolean' ? (u.is_final as boolean) : undefined,
            is_live: typeof u?.is_live === 'boolean' ? (u.is_live as boolean) : undefined,
          };

          setGames((prev) =>
            prev.map((g) =>
              g.id === id
                ? {
                    ...g,
                    home: typeof n.home === 'string' ? n.home : g.home,
                    away: typeof n.away === 'string' ? n.away : g.away,
                    home_score: typeof n.home_score === 'number' ? n.home_score : g.home_score,
                    away_score: typeof n.away_score === 'number' ? n.away_score : g.away_score,
                    live_home_score: typeof n.live_home_score === 'number' ? n.live_home_score : g.live_home_score,
                    live_away_score: typeof n.live_away_score === 'number' ? n.live_away_score : g.live_away_score,
                    is_final: typeof n.is_final === 'boolean' ? n.is_final : g.is_final,
                    is_live: typeof n.is_live === 'boolean' ? n.is_live : g.is_live,
                  }
                : g
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chan);
    };
  }, []);

  // Fallback: poll every 15s (re-created when week changes)
  useEffect(() => {
    let cancelled = false;
    if (!games.length) return;

    const ids = games.map((g) => g.id);
    const tick = async () => {
      const { data } = await supabase
        .from('games')
        .select('id,home,away,home_score,away_score,live_home_score,live_away_score,is_final,is_live')
        .in('id', ids);

      if (!data || cancelled) return;

      const byId = new Map<number, Record<string, unknown>>();
      for (const r of data as unknown[]) {
        const rec = r as Record<string, unknown>;
        const id = typeof rec.id === 'number' ? (rec.id as number) : null;
        if (id != null) byId.set(id, rec);
      }

      setGames((prev) =>
        prev.map((g) => {
          const r = byId.get(g.id);
          if (!r) return g;
          return {
            ...g,
            home: typeof r.home === 'string' ? (r.home as string) : g.home,
            away: typeof r.away === 'string' ? (r.away as string) : g.away,
            home_score: typeof r.home_score === 'number' ? (r.home_score as number) : g.home_score,
            away_score: typeof r.away_score === 'number' ? (r.away_score as number) : g.away_score,
            live_home_score:
              typeof r.live_home_score === 'number' ? (r.live_home_score as number) : g.live_home_score,
            live_away_score:
              typeof r.live_away_score === 'number' ? (r.live_away_score as number) : g.live_away_score,
            is_final: typeof r.is_final === 'boolean' ? (r.is_final as boolean) : g.is_final,
            is_live: typeof r.is_live === 'boolean' ? (r.is_live as boolean) : g.is_live,
          };
        })
      );
    };

    const iv = setInterval(tick, 15000);
    void tick();

    return () => {
      cancelled = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, games.length]);

  /* ------------------------------ derived maps ---------------------------- */

  const gameByPair = useMemo(() => {
    const m = new Map<string, GameRow>();
    for (const g of games) m.set(`${g.home}-${g.away}`, g);
    return m;
  }, [games]);

  const picksByPlayer = useMemo(() => {
    const m = new Map<string, SpreadPickRow[]>();
    for (const name of PLAYERS_ORDERED) m.set(name, []);
    for (const p of spreadPicks) {
      const key = p.player_display_name || 'Unknown';
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

  const nflLogo = teamLogo('NFL');

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* styles for live flash + final bold */}
      <style jsx global>{`
        @keyframes scoreFlash {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }
        .score-live {
          animation: scoreFlash 1s ease-in-out infinite;
        }
        .score-final {
          font-weight: 700;
        }
      `}</style>

      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TinyLogo url={nflLogo} alt="NFL" className="w-6 h-6" />
          <h1 className="text-2xl font-semibold">Games</h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-sm opacity-70">Week</label>
            <select
  className="border rounded p-1 bg-transparent"
  value={week ?? (weeks.length ? Math.max(...weeks) : 1)}
  onChange={(e) => setWeek(parseInt(e.target.value, 10))}
>
  {weeks.map((w) => (
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
          (PLAYERS_ORDERED as readonly string[]).map((player) => {
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
                            <TinyLogo url={teamLogo(r.team_short)} alt={r.team_short} />
                            <span className="font-semibold">{r.team_short}</span>
                            <span className="text-zinc-400 text-sm">({matchup(r.home_short, r.away_short)})</span>
                          </div>

                          <div className="flex items-center gap-4">
                            <span className="w-12 text-right">{signed(r.spread)}</span>
                            <span
                              className={`tabular-nums text-sm text-zinc-300 ${
                                s.isLive ? 'score-live' : s.isFinal ? 'score-final' : ''
                              }`}
                            >
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

        {(PLAYERS_ORDERED as readonly string[]).map((name) => {
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
                <TinyLogo url={teamLogo(r.home_short)} alt={r.home_short} />
                <TinyLogo url={teamLogo(r.away_short)} alt={r.away_short} />
                <span className="font-semibold">{name}</span>
                <span className="text-zinc-300">{matchup(r.home_short, r.away_short)}</span>
                <span className="ml-3">{r.ou_choice}</span>
                <span className="ml-1">{r.ou_total}</span>
              </div>
              <div className="flex items-center gap-4">
                <span
                  className={`tabular-nums text-sm text-zinc-300 ${
                    s.isLive ? 'score-live' : s.isFinal ? 'score-final' : ''
                  }`}
                >
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
            games.map((g) => {
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