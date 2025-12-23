'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { formatGameLabel } from '@/lib/formatGameLabel';
import { getTeamLogoUrl } from '@/lib/logos';
import ControlBar, { ControlBarItem } from '@/components/ControlBar';

const YEAR = 2025;
const PLAYERS_ORDERED = ['Big Dawg', 'Pud', 'Kinish'] as const;

/* ------------------------------- data types ------------------------------- */

type WeekRow = { week_number: number };

type GameRow = {
  id: number;
  home: string; // team short (e.g., PHI)
  away: string; // team short (e.g., DAL)
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
  week_id?: number;
};

type OuPickRow = {
  player_display_name: string;
  home_short: string;
  away_short: string;
  ou_choice: 'OVER' | 'UNDER';
  ou_total: number;
  week_id?: number;
};

/* --------------------------------- config -------------------------------- */

/* --------------------------------- utils --------------------------------- */

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
function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}
function signed(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return n > 0 ? `+${n}` : `${n}`;
}
function teamLogo(short?: string | null): string | null {
  return getTeamLogoUrl(short);
}

type Outcome = 'win' | 'loss' | 'push' | 'pending';

function pickOutcomeATS(
  game: GameRow | undefined,
  pickedTeam: string,
  spreadForPick: number | null
): Outcome {
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

function pickOutcomeOU(
  game: GameRow | undefined,
  choice: 'OVER' | 'UNDER',
  total: number
): Outcome {
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

function scoreInfo(
  game?: GameRow
): { text: string; isLive: boolean; isFinal: boolean } {
  const { home, away, isLive, isFinal } = scoreParts(game);
  if (home == null || away == null) return { text: '-', isLive, isFinal };
  return { text: `${home}-${away}`, isLive, isFinal };
}

function scoreParts(
  game?: GameRow
): { home: number | null; away: number | null; isLive: boolean; isFinal: boolean } {
  if (!game) return { home: null, away: null, isLive: false, isFinal: false };
  const hasFinal = game.home_score != null && game.away_score != null;
  const hasLive = game.live_home_score != null && game.live_away_score != null;

  const home = hasFinal ? game.home_score : hasLive ? game.live_home_score : null;
  const away = hasFinal ? game.away_score : hasLive ? game.live_away_score : null;

  return {
    isLive: Boolean(game.is_live) || (!hasFinal && hasLive),
    isFinal: Boolean(game.is_final) || hasFinal,
    home,
    away,
  };
}

/* --------------------------------- cells --------------------------------- */

function TinyLogo({
  url,
  alt,
  className,
}: {
  url: string | null;
  alt: string;
  className?: string;
}) {
  if (!url)
    return (
      <span className={`inline-block align-middle ${className || 'w-4 h-4 mr-2'}`} />
    );
  // Keep <img> to avoid next/image config churn.
  return (
    <img
      alt={alt}
      src={url}
      className={`inline-block rounded-sm align-middle ${
        className || 'w-4 h-4 mr-2'
      }`}
      loading="eager"
    />
  );
}

function StatusPill({ outcome }: { outcome: Outcome }) {
  const classes = outcomeClass(outcome);
  const text =
    outcome === 'pending'
      ? 'pending'
      : outcome === 'push'
      ? 'push'
      : outcome === 'win'
      ? 'win'
      : 'loss';
  return <span className={classes}>{text}</span>;
}

/* --------------------------------- page ---------------------------------- */

export default function ScoreboardPage() {
  const [week, setWeek] = useState<number | null>(null);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [spreadPicks, setSpreadPicks] = useState<SpreadPickRow[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPickRow[]>([]);
  const [showMyPicks, setShowMyPicks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(false);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const [mySpreadPicks, setMySpreadPicks] = useState<SpreadPickRow[]>([]);
  const [myOuPicks, setMyOuPicks] = useState<OuPickRow[]>([]);
  const [myGamesByPair, setMyGamesByPair] = useState<Map<string, GameRow>>(new Map());

  // NEW: block loadWeeks() from overwriting a week restored from URL/localStorage
  const initWeekRef = useRef(false);

  // Resolve signed-in display name for "My Picks"
  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData?.session?.user?.email?.toLowerCase() ?? null;
      if (!email) return;
      const { data } = await supabase
        .from('players')
        .select('display_name')
        .eq('email', email)
        .maybeSingle();
      const fromDb = typeof data?.display_name === 'string' ? data.display_name : null;
      const fallback =
        (sessionData?.session?.user?.user_metadata as Record<string, unknown> | undefined)
          ?.full_name;
      const resolved =
        fromDb ||
        (typeof fallback === 'string' ? fallback : null) ||
        sessionData?.session?.user?.email ||
        null;
      setUserDisplayName(resolved);
    })();
  }, []);

  /* ------------------------------ load weeks ------------------------------ */

  const loadWeeks = async () => {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    const arr = Array.isArray(data) ? (data as unknown[]) : [];
    const list = arr
      .map((w) =>
        w && typeof w === 'object'
          ? (w as WeekRow).week_number
          : undefined
      )
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => a - b);

    setWeeks(list.length ? list : Array.from({ length: 18 }, (_, i) => i + 1));

    // Only choose a default week if we DID NOT restore one earlier.
    if (week === null && !initWeekRef.current) {
      const { data: lastPick } = await supabase
        .from('picks')
        .select('week_id')
        .eq('season_year', YEAR)
        .order('week_id', { ascending: false })
        .limit(1)
        .maybeSingle();

      const def = lastPick?.week_id ?? (list.length ? list[list.length - 1] : 1);
      setWeek(def);
    }
  };

  /* ------------------------------- load all ------------------------------- */

  const loadAll = async (w: number) => {
    setLoading(true);

    // 1) Base RPC (final scores)
    const { data: base } = await supabase.rpc('get_week_games_for_scoring', {
      p_year: YEAR,
      p_week: w,
    });
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
        .select(
          'id,home,away,home_score,away_score,live_home_score,live_away_score,is_final,is_live'
        )
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

    // 3) Spread picks — direct from table
    const { data: sp } = await supabase
      .from('picks')
      .select(
        'pick_number, player_display_name, team_short, spread_at_pick, home_short, away_short'
      )
      .eq('season_year', YEAR)
      .eq('week_id', w)
      .order('pick_number', { ascending: true });

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

    // 4) O/U picks — RPC
    const { data: ou } = await supabase.rpc('get_week_ou_picks_admin', {
      p_year: YEAR,
      p_week: w,
    });
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

  /* --------------------------- restore chosen week ------------------------ */

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlWeek = params.get('week');
    const saved = localStorage.getItem('ats.week.scoreboard');
    const candidateStr = urlWeek ?? saved ?? '';
    const v = parseInt(candidateStr, 10);
    if (Number.isFinite(v) && v > 0) {
      initWeekRef.current = true; // <- prevents loadWeeks() default override
      setWeek(v);
    }
  }, []);

  /* -------------------------------- effects ------------------------------- */

  useEffect(() => {
    loadWeeks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (week != null) loadAll(week);
  }, [week]);

  // Load full-season picks for the signed-in user when requested
  useEffect(() => {
    if (!showMyPicks || !userDisplayName) return;
    let cancelled = false;

    const loadMySeason = async () => {
      setMyLoading(true);
      try {
        const weeksToUse =
          weeks.length > 0 ? weeks : Array.from({ length: 18 }, (_, i) => i + 1);

        // Spread picks for this user across the season
        const { data: sp } = await supabase
          .from('picks')
          .select(
            'week_id, pick_number, player_display_name, team_short, spread_at_pick, home_short, away_short'
          )
          .eq('season_year', YEAR)
          .eq('player_display_name', userDisplayName)
          .order('week_id', { ascending: true })
          .order('pick_number', { ascending: true });

        type PicksSelectRow = {
          week_id?: unknown;
          pick_number?: unknown;
          player_display_name?: unknown;
          team_short?: unknown;
          spread_at_pick?: unknown;
          home_short?: unknown;
          away_short?: unknown;
        };

        const mySpreads: SpreadPickRow[] = (Array.isArray(sp) ? (sp as unknown[]) : []).map(
          (r) => {
            const x = r as PicksSelectRow;
            return {
              week_id: toNumOrNull(x.week_id) ?? undefined,
              pick_number: toNumOrNull(x.pick_number) ?? 0,
              player_display_name: toStr(x.player_display_name),
              team_short: toStr(x.team_short),
              spread: toNumOrNull(x.spread_at_pick),
              home_short: toStr(x.home_short),
              away_short: toStr(x.away_short),
            };
          }
        );

        // O/U picks for this user across the season (per-week RPC)
        const ouList: OuPickRow[] = [];
        const normalizedUser = userDisplayName.trim().toLowerCase();
        for (const w of weeksToUse) {
          const { data: ou } = await supabase.rpc('get_week_ou_picks_admin', {
            p_year: YEAR,
            p_week: w,
          });
          const ouArr = Array.isArray(ou) ? (ou as unknown[]) : [];
          for (const r of ouArr) {
            const x = r as AdminOuRowUnknown;
            const playerName = toStr(x.player);
            if (!playerName || playerName.trim().toLowerCase() !== normalizedUser) continue;
            const sideRaw = toStr(x.pick_side).trim().toUpperCase();
            const side: 'OVER' | 'UNDER' = sideRaw === 'UNDER' ? 'UNDER' : 'OVER';
            ouList.push({
              week_id: w,
              player_display_name: playerName,
              home_short: toStr(x.home_short),
              away_short: toStr(x.away_short),
              ou_choice: side,
              ou_total: toNumOrNull(x.total_at_pick) ?? 0,
            });
          }
        }

        // Load games for any weeks that have picks (for outcomes)
        const weeksWithPicks = new Set<number>();
        for (const p of mySpreads) if (typeof p.week_id === 'number') weeksWithPicks.add(p.week_id);
        for (const p of ouList) if (typeof p.week_id === 'number') weeksWithPicks.add(p.week_id);

        const gamesMap = new Map<string, GameRow>();
        for (const w of weeksWithPicks) {
          const { data: base } = await supabase.rpc('get_week_games_for_scoring', {
            p_year: YEAR,
            p_week: w,
          });
          const baseArr = Array.isArray(base) ? (base as unknown[]) : [];
          for (const r of baseArr) {
            const row = r as RpcBaseGameRowUnknown;
            const id = toNumOrNull(row.game_id);
            const home = toStr(row.home);
            const away = toStr(row.away);
            const hs = toNumOrNull(row.home_score);
            const as = toNumOrNull(row.away_score);
            if (id == null || !home || !away) continue;
            const g: GameRow = {
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
            gamesMap.set(`${home}-${away}`, g);
          }
        }

        if (!cancelled) {
          setMySpreadPicks(mySpreads);
          setMyOuPicks(ouList);
          setMyGamesByPair(gamesMap);
        }
      } finally {
        if (!cancelled) setMyLoading(false);
      }
    };

    loadMySeason();

    return () => {
      cancelled = true;
    };
  }, [showMyPicks, userDisplayName, weeks]);

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
            home_score:
              typeof u?.home_score === 'number'
                ? (u.home_score as number)
                : undefined,
            away_score:
              typeof u?.away_score === 'number'
                ? (u.away_score as number)
                : undefined,
            live_home_score:
              typeof u?.live_home_score === 'number'
                ? (u.live_home_score as number)
                : undefined,
            live_away_score:
              typeof u?.live_away_score === 'number'
                ? (u.live_away_score as number)
                : undefined,
            is_final:
              typeof u?.is_final === 'boolean'
                ? (u.is_final as boolean)
                : undefined,
            is_live:
              typeof u?.is_live === 'boolean'
                ? (u.is_live as boolean)
                : undefined,
          };

          setGames((prev) =>
            prev.map((g) =>
              g.id === id
                ? {
                    ...g,
                    home: n.home ?? g.home,
                    away: n.away ?? g.away,
                    home_score: n.home_score ?? g.home_score,
                    away_score: n.away_score ?? g.away_score,
                    live_home_score: n.live_home_score ?? g.live_home_score,
                    live_away_score: n.live_away_score ?? g.live_away_score,
                    is_final:
                      typeof n.is_final === 'boolean' ? n.is_final : g.is_final,
                    is_live:
                      typeof n.is_live === 'boolean' ? n.is_live : g.is_live,
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
        .select(
          'id,home,away,home_score,away_score,live_home_score,live_away_score,is_final,is_live'
        )
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
            home_score:
              typeof r.home_score === 'number'
                ? (r.home_score as number)
                : g.home_score,
            away_score:
              typeof r.away_score === 'number'
                ? (r.away_score as number)
                : g.away_score,
            live_home_score:
              typeof r.live_home_score === 'number'
                ? (r.live_home_score as number)
                : g.live_home_score,
            live_away_score:
              typeof r.live_away_score === 'number'
                ? (r.live_away_score as number)
                : g.live_away_score,
            is_final:
              typeof r.is_final === 'boolean'
                ? (r.is_final as boolean)
                : g.is_final,
            is_live:
              typeof r.is_live === 'boolean' ? (r.is_live as boolean) : g.is_live,
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

  const norm = (s: string) => s.trim().toLowerCase();

  // spreads
  const picksByPlayer = useMemo(() => {
    const m = new Map<string, SpreadPickRow[]>();
    for (const name of PLAYERS_ORDERED) m.set(name, []);
    for (const p of spreadPicks) {
      const canonical =
        (PLAYERS_ORDERED as readonly string[]).find(
          (n) => norm(n) === norm(p.player_display_name)
        ) ?? p.player_display_name.trim();
      if (!m.has(canonical)) m.set(canonical, []);
      m.get(canonical)!.push(p);
    }
    for (const [, arr] of m)
      arr.sort((a, b) => (a.pick_number ?? 0) - (b.pick_number ?? 0));
    return m;
  }, [spreadPicks]);

  // O/U
  const ouByPlayer = useMemo(() => {
    const m = new Map<string, OuPickRow | null>();
    for (const name of PLAYERS_ORDERED) m.set(name, null);
    for (const r of ouPicks) {
      const canonical =
        (PLAYERS_ORDERED as readonly string[]).find(
          (n) => norm(n) === norm(r.player_display_name)
        ) ?? r.player_display_name.trim();
      m.set(canonical, r);
    }
    return m;
  }, [ouPicks]);

  const myWeeksGrouped = useMemo(() => {
    const grouped = new Map<number, { spreads: SpreadPickRow[]; ous: OuPickRow[] }>();
    for (const p of mySpreadPicks) {
      const w = p.week_id ?? 0;
      if (!grouped.has(w)) grouped.set(w, { spreads: [], ous: [] });
      grouped.get(w)!.spreads.push(p);
    }
    for (const p of myOuPicks) {
      const w = p.week_id ?? 0;
      if (!grouped.has(w)) grouped.set(w, { spreads: [], ous: [] });
      grouped.get(w)!.ous.push(p);
    }
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([weekNumber, data]) => ({
        weekNumber,
        spreads: data.spreads.sort((a, b) => (a.pick_number ?? 0) - (b.pick_number ?? 0)),
        ous: data.ous,
      }));
  }, [mySpreadPicks, myOuPicks]);

  const mySummary = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let pushes = 0;

    for (const p of mySpreadPicks) {
      const pairKey = `${p.home_short}-${p.away_short}`;
      const outcome = pickOutcomeATS(myGamesByPair.get(pairKey), p.team_short, p.spread);
      if (outcome === 'win') wins += 1;
      else if (outcome === 'loss') losses += 1;
      else if (outcome === 'push') pushes += 1;
    }

    for (const p of myOuPicks) {
      const pairKey = `${p.home_short}-${p.away_short}`;
      const outcome = pickOutcomeOU(myGamesByPair.get(pairKey), p.ou_choice, p.ou_total);
      if (outcome === 'win') wins += 1;
      else if (outcome === 'loss') losses += 1;
      else if (outcome === 'push') pushes += 1;
    }

    const counted = wins + losses + pushes;
    const winPct = counted ? (wins / counted) * 100 : null;
    return { wins, losses, pushes, winPct };
  }, [mySpreadPicks, myOuPicks, myGamesByPair]);

  const myTeamLeaders = useMemo(() => {
    const map = new Map<string, { picks: number; wins: number; losses: number; pushes: number }>();
    for (const p of mySpreadPicks) {
      const team = p.team_short?.trim().toUpperCase();
      if (!team) continue;
      const pairKey = `${p.home_short}-${p.away_short}`;
      const outcome = pickOutcomeATS(myGamesByPair.get(pairKey), p.team_short, p.spread);
      const entry = map.get(team) ?? { picks: 0, wins: 0, losses: 0, pushes: 0 };
      entry.picks += 1;
      if (outcome === 'win') entry.wins += 1;
      else if (outcome === 'loss') entry.losses += 1;
      else if (outcome === 'push') entry.pushes += 1;
      map.set(team, entry);
    }

    const topBy = (prop: 'picks' | 'wins' | 'losses') => {
      let best: { team: string; data: { picks: number; wins: number; losses: number; pushes: number } } | null = null;
      for (const [team, data] of map.entries()) {
        if (!best || data[prop] > best.data[prop]) best = { team, data };
      }
      return best;
    };

    const shape = (item: ReturnType<typeof topBy>) => {
      if (!item) return null;
      const total = item.data.wins + item.data.losses + item.data.pushes;
      const winPct = total ? (item.data.wins / total) * 100 : null;
      const lossPct = total ? (item.data.losses / total) * 100 : null;
      return {
        team: item.team,
        picks: item.data.picks,
        wins: item.data.wins,
        losses: item.data.losses,
        pushes: item.data.pushes,
        winPct,
        lossPct,
        logo: teamLogo(item.team),
      };
    };

    return {
      mostPicked: shape(topBy('picks')),
      mostWins: shape(topBy('wins')),
      mostLosses: shape(topBy('losses')),
    };
  }, [mySpreadPicks, myGamesByPair]);

  /* -------------------------------- render -------------------------------- */

  const resolvedWeek = week ?? (weeks.length ? Math.max(...weeks) : 1);
  const weekOptions =
    weeks.length > 0 ? weeks : Array.from({ length: 18 }, (_, i) => i + 1);
  const handleWeekSelect = (value: number) => {
    setWeek(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('ats.week.scoreboard', String(value));
      const params = new URLSearchParams(window.location.search);
      params.set('week', String(value));
      window.history.replaceState({}, '', `?${params.toString()}`);
    }
  };
  const controlItems: ControlBarItem[] = [
    {
      type: 'week',
      ariaLabel: 'Select week for scoreboard',
      value: resolvedWeek,
      options: weekOptions,
      onChange: handleWeekSelect,
    },
    {
      type: 'toggle',
      label: 'My Picks (season)',
      ariaLabel: 'Show only my picks for the season',
      checked: showMyPicks,
      onChange: (next) => setShowMyPicks(next),
    },
  ];
  if (userDisplayName) {
    controlItems.push({
      type: 'text',
      text: `Signed in as ${userDisplayName}`,
      className: 'text-xs sm:text-sm',
    });
  }

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

      <ControlBar items={controlItems} />

      {showMyPicks ? (
        <>
          <section className="border rounded p-4 space-y-2">
            <h2 className="text-lg font-medium">My Season Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-zinc-200">
              <div>Wins: {mySummary.wins}</div>
              <div>Losses: {mySummary.losses}</div>
              <div>Pushes: {mySummary.pushes}</div>
              <div>Win %: {mySummary.winPct != null ? formatPercent(mySummary.winPct) : '-'}</div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-200">
              <span className="text-xs uppercase tracking-wide text-zinc-400">Leaders</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Most Picked</span>
                {myTeamLeaders.mostPicked ? (
                  <>
                    <TinyLogo url={myTeamLeaders.mostPicked.logo} alt={myTeamLeaders.mostPicked.team} className="w-5 h-5 mr-0" />
                    <span>{myTeamLeaders.mostPicked.team}</span>
                    <span className="text-xs text-zinc-400">
                      ({myTeamLeaders.mostPicked.picks} picks, {myTeamLeaders.mostPicked.winPct != null ? formatPercent(myTeamLeaders.mostPicked.winPct) : '0%'} W%)
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-zinc-500">-</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-emerald-300">Top Winner</span>
                {myTeamLeaders.mostWins ? (
                  <>
                    <TinyLogo url={myTeamLeaders.mostWins.logo} alt={myTeamLeaders.mostWins.team} className="w-5 h-5 mr-0" />
                    <span>{myTeamLeaders.mostWins.team}</span>
                    <span className="text-xs text-zinc-400">
                      ({myTeamLeaders.mostWins.wins} W, {myTeamLeaders.mostWins.winPct != null ? formatPercent(myTeamLeaders.mostWins.winPct) : '0%'} W%)
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-zinc-500">-</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-300">Top Loser</span>
                {myTeamLeaders.mostLosses ? (
                  <>
                    <TinyLogo url={myTeamLeaders.mostLosses.logo} alt={myTeamLeaders.mostLosses.team} className="w-5 h-5 mr-0" />
                    <span>{myTeamLeaders.mostLosses.team}</span>
                    <span className="text-xs text-zinc-400">
                      ({myTeamLeaders.mostLosses.losses} L, {myTeamLeaders.mostLosses.lossPct != null ? formatPercent(myTeamLeaders.mostLosses.lossPct) : '0%'} L%)
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-zinc-500">-</span>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">My Picks (Season)</h2>
            {myLoading ? (
              <div className="text-sm text-zinc-400">Loading your picks.</div>
            ) : myWeeksGrouped.length === 0 ? (
              <div className="text-sm text-zinc-400">No picks found for this season.</div>
            ) : (
              myWeeksGrouped.map(({ weekNumber, spreads, ous }) => (
                <div key={weekNumber} className="border rounded p-4 space-y-3">
                  <div className="font-semibold text-sm text-zinc-200">Week {weekNumber}</div>
                  {spreads.length === 0 && ous.length === 0 ? (
                    <div className="text-sm text-zinc-400">No picks logged.</div>
                  ) : (
                    <div className="space-y-3">
                      {spreads.map((r, idx) => {
                        const pairKey = `${r.home_short}-${r.away_short}`;
                        const g = myGamesByPair.get(pairKey);
                        const outcome = pickOutcomeATS(g, r.team_short, r.spread);
                        const s = scoreParts(g);
                        const scoreText =
                          s.away == null || s.home == null ? '- -' : `${s.away}-${s.home}`;
                        const scoreClass =
                          s.isLive ? 'score-live' : s.isFinal ? 'score-final' : 'text-zinc-300';

                        return (
                          <div
                            key={`${weekNumber}-${idx}`}
                            className="flex flex-col gap-1 border border-zinc-800/60 rounded p-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <TinyLogo url={teamLogo(r.team_short)} alt={r.team_short} />
                                <span className="font-semibold">{r.team_short}</span>
                                <span className="text-sm text-zinc-400">{signed(r.spread)}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 text-sm text-zinc-300">
                                  <TinyLogo url={teamLogo(r.away_short)} alt={r.away_short} />
                                  <span className={`tabular-nums ${scoreClass}`}>{scoreText}</span>
                                  <TinyLogo url={teamLogo(r.home_short)} alt={r.home_short} />
                                </div>
                                <StatusPill outcome={outcome} />
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {ous.map((ouPick, idx) => {
                        const pairKey = `${ouPick.home_short}-${ouPick.away_short}`;
                        const g = myGamesByPair.get(pairKey);
                        const outcome = pickOutcomeOU(g, ouPick.ou_choice, ouPick.ou_total);
                        const s = scoreParts(g);
                        const scoreText =
                          s.away == null || s.home == null ? '- -' : `${s.away}-${s.home}`;
                        const scoreClass =
                          s.isLive ? 'score-live' : s.isFinal ? 'score-final' : 'text-zinc-300';
                        return (
                          <div
                            key={`ou-${weekNumber}-${idx}`}
                            className="border-t border-zinc-800/60 pt-2"
                          >
                            <div className="text-xs italic text-zinc-400 mb-1">Over / Under</div>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-sm text-zinc-300">
                                <TinyLogo url={teamLogo(ouPick.away_short)} alt={ouPick.away_short} />
                                <span className={`tabular-nums ${scoreClass}`}>{scoreText}</span>
                                <TinyLogo url={teamLogo(ouPick.home_short)} alt={ouPick.home_short} />
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-semibold text-sm">
                                  {`${ouPick.ou_choice} ${ouPick.ou_total}`}
                                </span>
                                <StatusPill outcome={outcome} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>
        </>
      ) : (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Picks</h2>

          {loading ? (
            <div className="text-sm text-zinc-400">Loading.</div>
          ) : (
            (PLAYERS_ORDERED as readonly string[]).map((player) => {
              const rows = picksByPlayer.get(player) ?? [];
              const ouPick = ouByPlayer.get(player) || null;
              return (
                <div key={player} className="border rounded p-4">
                  <div className="font-semibold mb-3">{player}</div>

                  {rows.length === 0 && !ouPick ? (
                    <div className="text-sm text-zinc-400">No picks</div>
                  ) : (
                    <div className="space-y-3">
                      {rows.map((r, idx) => {
                        const pairKey = `${r.home_short}-${r.away_short}`;
                        const g = gameByPair.get(pairKey);
                        const outcome = pickOutcomeATS(g, r.team_short, r.spread);
                        const s = scoreParts(g);
                        const scoreText =
                          s.away == null || s.home == null ? '- -' : `${s.away}-${s.home}`;
                        const scoreClass =
                          s.isLive ? 'score-live' : s.isFinal ? 'score-final' : 'text-zinc-300';

                        return (
                          <div
                            key={`${player}-${idx}`}
                            className="flex flex-col gap-1 border border-zinc-800/60 rounded p-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <TinyLogo url={teamLogo(r.team_short)} alt={r.team_short} />
                                <span className="font-semibold">{r.team_short}</span>
                                <span className="text-sm text-zinc-400">{signed(r.spread)}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 text-sm text-zinc-300">
                                  <TinyLogo url={teamLogo(r.away_short)} alt={r.away_short} />
                                  <span className={`tabular-nums ${scoreClass}`}>{scoreText}</span>
                                  <TinyLogo url={teamLogo(r.home_short)} alt={r.home_short} />
                                </div>
                                <StatusPill outcome={outcome} />
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {ouPick
                        ? (() => {
                            const pairKey = `${ouPick.home_short}-${ouPick.away_short}`;
                            const g = gameByPair.get(pairKey);
                            const outcome = pickOutcomeOU(g, ouPick.ou_choice, ouPick.ou_total);
                            const s = scoreParts(g);
                            const scoreText =
                              s.away == null || s.home == null ? '- -' : `${s.away}-${s.home}`;
                            const scoreClass =
                              s.isLive ? 'score-live' : s.isFinal ? 'score-final' : 'text-zinc-300';
                            return (
                              <div className="border-t border-zinc-800/60 pt-2">
                                <div className="text-xs italic text-zinc-400 mb-1">Over / Under</div>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2 text-sm text-zinc-300">
                                    <TinyLogo url={teamLogo(ouPick.away_short)} alt={ouPick.away_short} />
                                    <span className={`tabular-nums ${scoreClass}`}>{scoreText}</span>
                                    <TinyLogo url={teamLogo(ouPick.home_short)} alt={ouPick.home_short} />
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="font-semibold text-sm">
                                      {`${ouPick.ou_choice} ${ouPick.ou_total}`}
                                    </span>
                                    <StatusPill outcome={outcome} />
                                  </div>
                                </div>
                              </div>
                            );
                          })()
                        : null}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      )}

    </div>
  );
}
