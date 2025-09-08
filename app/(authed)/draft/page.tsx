'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/* ------------------------------- constants ------------------------------- */

const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

// fallback for “who am I?” if a profiles row isn’t found
const DEFAULT_PLAYER =
  (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null;

// team logos
const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

/* --------------------------------- types --------------------------------- */

type BoardRow = {
  home_short: string;
  away_short: string;
  fav_short: string | null; // favourite team short, null for PK
  spread: number | null;    // line shown in feeds (fav’s signed line). PK => 0
  total: number | null;
};

type PickTableRow = {
  id: number;
  season_year: number;
  week_number: number;
  pick_number: number;
  player_display_name: string;
  team_short: string;
  home_short: string;
  away_short: string;
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

function fmtSigned(n: number): string {
  if (n === 0) return 'Pick Em';
  return n > 0 ? `+${n}` : `${n}`;
}

// Given a game’s fav+spread, return the team-specific line
function lineForTeam(team: string, fav: string | null, spread: number | null): number {
  if (spread == null || fav == null) return 0;
  // our spread is signed for the favourite (e.g., fav -3.5)
  return team === fav ? spread : -spread;
}

/* ---------------------------- snake order logic -------------------------- */
/** Rotate weekly. Week 1 starts PLAYERS[0], Week 2 starts PLAYERS[1], etc.
 *  Within the week we snake per round. */
function onClockName(totalPicksSoFar: number, week: number): string {
  const n = PLAYERS.length;                 // players per round
  const start = (week - 1) % n;             // rotate weekly
  const round = Math.floor(totalPicksSoFar / n);
  const idxInRound = totalPicksSoFar % n;
  const forward = round % 2 === 0;

  const offset = forward ? idxInRound : n - 1 - idxInRound;
  const playerIdx = (start + offset) % n;
  return PLAYERS[playerIdx]!;
}

/* -------------------------------- component ------------------------------- */

export default function DraftPage() {
  const [week, setWeek] = useState<number>(2);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [picks, setPicks] = useState<PickTableRow[]>([]);
  const [myName, setMyName] = useState<string | null>(null);

  /* who am I? (for client-side turn guard) */
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id || null;
      if (!uid) {
        setMyName(DEFAULT_PLAYER);
        return;
      }
      const { data: prof } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', uid)
        .maybeSingle();
      const nm = toStr(prof?.display_name || DEFAULT_PLAYER || '');
      setMyName(nm || null);
    })();
  }, []);

  /* load board */
  async function loadBoard(w: number) {
    const { data } = await supabase.rpc('get_week_draft_board', { p_year: YEAR, p_week: w });
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

  /* load picks */
  async function loadPicks(w: number) {
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

  /* realtime picks */
  useEffect(() => {
    const ch = supabase
      .channel('draft-picks')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'picks' },
        (payload: RealtimePostgresChangesPayload<PickTableRow>) => {
          const o = asRec(payload.new as unknown);
          const y = toNumOrNull(o.season_year) ?? YEAR;
          const w = toNumOrNull(o.week_number) ?? week;
          if (y !== YEAR || w !== week) return;

          const row: PickTableRow = {
            id: toNumOrNull(o.id) ?? 0,
            season_year: y,
            week_number: w,
            pick_number: toNumOrNull(o.pick_number) ?? 0,
            player_display_name: toStr(o.player_display_name),
            team_short: toStr(o.team_short),
            home_short: toStr(o.home_short),
            away_short: toStr(o.away_short),
            spread_at_pick: toNumOrNull(o.spread_at_pick),
            total_at_pick: toNumOrNull(o.total_at_pick),
            created_at: toStr(o.created_at, null as unknown as string),
          };
          setPicks((p) => [...p, row].sort((a, b) => a.pick_number - b.pick_number));
        },
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  /* derived */
  const totalPicksSoFar = picks.length;
  const onClock = onClockName(totalPicksSoFar, week);
  const isMyTurn = myName != null && onClock === myName;

  /* UI helpers */
  function GameRowView({ row }: { row: BoardRow }) {
    const hLine = lineForTeam(row.home_short, row.fav_short, row.spread);
    const aLine = lineForTeam(row.away_short, row.fav_short, row.spread);
    return (
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <img src={teamLogo(row.home_short) || ''} alt={row.home_short} className="w-4 h-4 rounded-sm" />
          <span className="w-8 font-semibold">{row.home_short}</span>
          <span className="ml-1 text-xs text-zinc-400">{fmtSigned(hLine)}</span>
          <span className="text-zinc-500 mx-2">v</span>
          <img src={teamLogo(row.away_short) || ''} alt={row.away_short} className="w-4 h-4 rounded-sm" />
          <span className="w-8 font-semibold">{row.away_short}</span>
          <span className="ml-1 text-xs text-zinc-400">{fmtSigned(aLine)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-14 text-right tabular-nums">{row.spread == null ? '—' : row.spread}</span>
          <span className="w-12 text-right tabular-nums">{row.total ?? '—'}</span>
        </div>
      </div>
    );
  }

  async function makePick(row: BoardRow, team_short: string) {
    if (!isMyTurn) return; // client-side guard
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

  /* render */
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
          {board.map((r) => {
            const hLine = lineForTeam(r.home_short, r.fav_short, r.spread);
            const aLine = lineForTeam(r.away_short, r.fav_short, r.spread);
            return (
              <div key={`${r.home_short}-${r.away_short}`} className="border rounded p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <img src={teamLogo(r.home_short) || ''} alt={r.home_short} className="w-4 h-4" />
                  <span className="font-semibold">{r.home_short}</span>
                  <span className="text-xs text-zinc-400 ml-1">{fmtSigned(hLine)}</span>
                  <span className="text-zinc-500 mx-2">v</span>
                  <img src={teamLogo(r.away_short) || ''} alt={r.away_short} className="w-4 h-4" />
                  <span className="font-semibold">{r.away_short}</span>
                  <span className="text-xs text-zinc-400 ml-1">{fmtSigned(aLine)}</span>
                  <span className="ml-3 text-xs text-zinc-500">/ {r.total ?? '—'}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                    disabled={!isMyTurn}
                    onClick={() => makePick(r, r.home_short)}
                  >
                    Pick {r.home_short} ({fmtSigned(hLine)})
                  </button>
                  <button
                    className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                    disabled={!isMyTurn}
                    onClick={() => makePick(r, r.away_short)}
                  >
                    Pick {r.away_short} ({fmtSigned(aLine)})
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
