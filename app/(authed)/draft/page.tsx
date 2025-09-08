'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/* ------------------------------- constants ------------------------------- */

const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

// optional fallback for “who am I?” if profiles lookup fails
const DEFAULT_PLAYER =
  (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null;

// team logo base (same convention as the scoreboard)
const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

/* --------------------------------- types --------------------------------- */

type BoardRow = {
  home_short: string;
  away_short: string;
  fav_short: string | null; // favourite short code, may be null for pick-em
  spread: number | null;
  total: number | null;
};

type PickTableRow = {
  id: number;
  season_year: number;
  week_number: number;
  pick_number: number;
  player_display_name: string;
  team_short: string; // who they picked
  home_short: string;
  away_short: string;
  // line captured at pick time
  spread_at_pick: number | null;
  total_at_pick: number | null;
  created_at: string | null;
};

/* --------------------------------- utils --------------------------------- */

function toStr(x: unknown, fb = ''): string {
  return typeof x === 'string' ? x : x == null ? fb : String(x);
}
function toNumOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}
function asRec(x: unknown): Record<string, unknown> {
  return (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
}
function teamLogo(short?: string | null): string | null {
  if (!short) return null;
  return LOGO_BASE ? `${LOGO_BASE}/${short}.png` : `/teams/${short}.png`;
}
function pickEmText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return 'Pick’em';
  return n > 0 ? `+${n}` : `${n}`;
}

/* ---------------------------- snake order logic -------------------------- */

function onClockName(totalPicksSoFar: number): string {
  // 9 ATS picks total (3 each), then O/U picks (3 total) — still snake
  const perRound = PLAYERS.length;
  const round = Math.floor(totalPicksSoFar / perRound);
  const idxInRound = totalPicksSoFar % perRound;
  const forward = round % 2 === 0;
  const idx = forward ? idxInRound : perRound - 1 - idxInRound;
  return PLAYERS[idx]!;
}

/* -------------------------------- component ------------------------------- */

export default function DraftPage() {
  const [week, setWeek] = useState<number>(2);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [picks, setPicks] = useState<PickTableRow[]>([]);
  const [myName, setMyName] = useState<string | null>(null);

  /* -------------------------- who am I? (for guard) -------------------------- */
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id || null;
      if (!uid) {
        setMyName(DEFAULT_PLAYER);
        return;
      }
      // try profiles -> display_name
      const { data: prof } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', uid)
        .maybeSingle();

      const nm = toStr(prof?.display_name || DEFAULT_PLAYER || '');
      setMyName(nm || null);
    })();
  }, []);

  /* ------------------------------ load board ------------------------------ */

  async function loadBoard(w: number) {
    // You can swap this to your RPC if you prefer.
    const { data } = await supabase.rpc('get_week_draft_board', {
      p_year: YEAR,
      p_week: w,
    });

    const raw: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
    const mapped: BoardRow[] = raw.map((r) => {
      const o = asRec(r);
      return {
        home_short: toStr(o.home_short),
        away_short: toStr(o.away_short),
        fav_short: toStr(o.fav_short, '') || null,
        spread: toNumOrNull(o.spread),
        total: toNumOrNull(o.total),
      };
    });

    setBoard(mapped);
  }

  /* ------------------------------- load picks ------------------------------ */

  async function loadPicks(w: number) {
    // Your source here can be a view like picks_view filtered by year/week
    const { data } = await supabase
      .from('picks')
      .select(
        'id, season_year, week_number, pick_number, player_display_name, team_short, home_short, away_short, spread_at_pick, total_at_pick, created_at',
      )
      .eq('season_year', YEAR)
      .eq('week_number', w)
      .order('pick_number', { ascending: true });

    const rows: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
    const mapped: PickTableRow[] = rows.map((r) => {
      const o = asRec(r);
      return {
        id: toNumOrNull(o.id) ?? 0,
        season_year: toNumOrNull(o.season_year) ?? YEAR,
        week_number: toNumOrNull(o.week_number) ?? w,
        pick_number: toNumOrNull(o.pick_number) ?? 0,
        player_display_name: toStr(o.player_display_name),
        team_short: toStr(o.team_short),
        home_short: toStr(o.home_short),
        away_short: toStr(o.away_short),
        spread_at_pick: toNumOrNull(o.spread_at_pick),
        total_at_pick: toNumOrNull(o.total_at_pick),
        created_at: toStr(o.created_at, null as unknown as string),
      };
    });

    setPicks(mapped);
  }

  useEffect(() => {
    loadBoard(week);
    loadPicks(week);
  }, [week]);

  /* ------------------------------ realtime picks ------------------------------ */

  useEffect(() => {
    const ch = supabase
      .channel('draft-picks')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'picks' },
        (payload: RealtimePostgresChangesPayload<PickTableRow>) => {
          const rowU = payload.new as unknown;
          const r = asRec(rowU);
          const y = toNumOrNull(r.season_year) ?? YEAR;
          const w = toNumOrNull(r.week_number) ?? week;
          if (y !== YEAR || w !== week) return;

          const newRow: PickTableRow = {
            id: toNumOrNull(r.id) ?? 0,
            season_year: y,
            week_number: w,
            pick_number: toNumOrNull(r.pick_number) ?? 0,
            player_display_name: toStr(r.player_display_name),
            team_short: toStr(r.team_short),
            home_short: toStr(r.home_short),
            away_short: toStr(r.away_short),
            spread_at_pick: toNumOrNull(r.spread_at_pick),
            total_at_pick: toNumOrNull(r.total_at_pick),
            created_at: toStr(r.created_at, null as unknown as string),
          };

          setPicks((p) => [...p, newRow].sort((a, b) => a.pick_number - b.pick_number));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  /* ------------------------------ derived state ------------------------------ */

  const totalPicksSoFar = picks.length;
  const onClock = onClockName(totalPicksSoFar);
  const isMyTurn = myName != null && onClock === myName;

  /* --------------------------------- UI bits -------------------------------- */

  function FavBadge({ fav, spread }: { fav: string | null; spread: number | null }) {
    if (spread === 0) return <span className="text-xs px-1 rounded bg-zinc-700/60">Pick’em</span>;
    if (!fav || spread == null) return null;
    return (
      <span className="text-xs px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-400/30">
        Fav: {fav} ({pickEmText(spread)})
      </span>
    );
  }

  function GameRowView({ row }: { row: BoardRow }) {
    const homeLogo = teamLogo(row.home_short);
    const awayLogo = teamLogo(row.away_short);
    return (
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <img src={homeLogo || ''} alt={row.home_short} className="w-4 h-4 rounded-sm" />
          <span className="w-8 font-semibold">{row.home_short}</span>
          <span className="text-zinc-500">v</span>
          <img src={awayLogo || ''} alt={row.away_short} className="w-4 h-4 rounded-sm ml-2" />
          <span className="w-8 font-semibold">{row.away_short}</span>
        </div>
        <div className="flex items-center gap-3">
          <FavBadge fav={row.fav_short} spread={row.spread} />
          <span className="w-14 text-right tabular-nums">{pickEmText(row.spread)}</span>
          <span className="w-12 text-right tabular-nums">{row.total ?? '—'}</span>
        </div>
      </div>
    );
  }

  async function makePick(row: BoardRow, team_short: string) {
    // Guard on client: only the player on the clock (or no name known) can pick.
    if (!isMyTurn) return;

    // You likely already have a secure SQL function; keeping a simple insert here.
    await supabase.from('picks').insert([
      {
        season_year: YEAR,
        week_number: week,
        pick_number: totalPicksSoFar + 1,
        player_display_name: myName,
        team_short,
        home_short: row.home_short,
        away_short: row.away_short,
        spread_at_pick: row.spread,
        total_at_pick: row.total,
      },
    ]);
  }

  /* ---------------------------------- render --------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Draft Board</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm opacity-70">Week</label>
          <select
            className="border rounded p-1 bg-transparent"
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Board */}
      <section className="border rounded overflow-hidden">
        <div className="grid grid-cols-[1fr,80px,64px] text-xs px-3 py-2 bg-zinc-900/60 border-b">
          <div>Game</div>
          <div className="text-right">Spread</div>
          <div className="text-right">Total</div>
        </div>
        <div className="divide-y divide-zinc-800/60">
          {board.map((r, i) => (
            <div key={`${r.home_short}-${r.away_short}-${i}`}>
              <GameRowView row={r} />
            </div>
          ))}
        </div>
      </section>

      {/* Live draft */}
      <section className="space-y-3">
        <div className="text-sm text-zinc-400">
          On the clock: <span className="text-zinc-100 font-medium">{onClock}</span>
          {myName ? (
            <span className="ml-3">
              You are <span className="font-medium">{myName}</span> —{' '}
              {isMyTurn ? (
                <span className="text-emerald-400 font-medium">your turn</span>
              ) : (
                <span className="text-zinc-400">wait</span>
              )}
            </span>
          ) : null}
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {board.map((r) => (
            <div
              key={`${r.home_short}-${r.away_short}`}
              className="border rounded p-3 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <img src={teamLogo(r.home_short) || ''} alt={r.home_short} className="w-4 h-4" />
                <span className="font-semibold">{r.home_short}</span>
                <span className="text-zinc-500">v</span>
                <img src={teamLogo(r.away_short) || ''} alt={r.away_short} className="w-4 h-4" />
                <span className="font-semibold">{r.away_short}</span>
                <span className="ml-2 text-xs text-zinc-400">
                  ({pickEmText(r.spread)} / {r.total ?? '—'})
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                  disabled={!isMyTurn}
                  onClick={() => makePick(r, r.home_short)}
                >
                  Pick {r.home_short}
                </button>
                <button
                  className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                  disabled={!isMyTurn}
                  onClick={() => makePick(r, r.away_short)}
                >
                  Pick {r.away_short}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
