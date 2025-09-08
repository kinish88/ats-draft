'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/* ------------------------------- constants ------------------------------- */

const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

const DEFAULT_PLAYER =
  (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null;

const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

/* --------------------------------- types --------------------------------- */

type BoardRow = {
  home_short: string;
  away_short: string;
  home_line: number; // signed for HOME (PK=0)
  away_line: number; // signed for AWAY (PK=0)
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
  spread_at_pick: number | null; // signed for the team picked
  total_at_pick: number | null;
  created_at: string | null;
};

/* --------------------------------- utils --------------------------------- */

type SafeRec = Record<string, unknown>;

function toStr(x: unknown, fb = ''): string {
  return typeof x === 'string' ? x : x == null ? fb : String(x);
}

function toNumOrNull(x: unknown): number | null {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string') {
    const s = x.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asRec(x: unknown): SafeRec {
  return (x && typeof x === 'object' ? (x as SafeRec) : {}) as SafeRec;
}

function teamLogo(short?: string | null): string | null {
  if (!short) return null;
  return LOGO_BASE ? `${LOGO_BASE}/${short}.png` : `/teams/${short}.png`;
}

function fmtSigned(n: number): string {
  if (n === 0) return 'Pick Em';
  return n > 0 ? `+${n}` : `${n}`;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/* ---------------------------- snake order logic -------------------------- */
function onClockName(totalPicksSoFar: number, week: number): string {
  const n = PLAYERS.length;
  const start = (week - 1) % n; // Week 1 starts PLAYERS[0], Week 2 starts PLAYERS[1], etc.
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
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  /* who am I? */
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
    const rows: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];

    const mapped: BoardRow[] = rows.map((r) => {
      const o = asRec(r);
      const home = toStr(o.home_short).toUpperCase();
      const away = toStr(o.away_short).toUpperCase();

      // Try explicit per-team fields first (support multiple possible names)
      let hLine =
        toNumOrNull(o.home_line) ??
        toNumOrNull(o.home_spread) ??
        toNumOrNull(o.spread_home) ??
        toNumOrNull(o.line_home);

      let aLine =
        toNumOrNull(o.away_line) ??
        toNumOrNull(o.away_spread) ??
        toNumOrNull(o.spread_away) ??
        toNumOrNull(o.line_away);

      // If explicit team lines missing, derive from a single 'spread' field.
      // Your SQL shows a numeric spread that is **home-signed**:
      //   e.g. GB home with -3.5 => home_line = -3.5, away_line = +3.5
      if (hLine == null || aLine == null) {
        const s = toNumOrNull(o.spread);
        if (s != null) {
          hLine = s;
          aLine = -s;
        }
      }

      // Last resort: pick'em
      if (hLine == null || aLine == null) {
        hLine = 0;
        aLine = 0;
      }

      // Total (allow 'total' or 'total_line')
      const tot = toNumOrNull(o.total) ?? toNumOrNull(o.total_line);

      return {
        home_short: home,
        away_short: away,
        home_line: hLine,
        away_line: aLine,
        total: tot,
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

    const arr: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
    const mapped: PickTableRow[] = arr.map((r) => {
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
          const rowObj = asRec(payload.new as unknown);
          const y = toNumOrNull(rowObj.season_year) ?? YEAR;
          const w = toNumOrNull(rowObj.week_number) ?? week;
          if (y !== YEAR || w !== week) return;

          const row: PickTableRow = {
            id: toNumOrNull(rowObj.id) ?? 0,
            season_year: y,
            week_number: w,
            pick_number: toNumOrNull(rowObj.pick_number) ?? 0,
            player_display_name: toStr(rowObj.player_display_name),
            team_short: toStr(rowObj.team_short),
            home_short: toStr(rowObj.home_short),
            away_short: toStr(rowObj.away_short),
            spread_at_pick: toNumOrNull(rowObj.spread_at_pick),
            total_at_pick: toNumOrNull(rowObj.total_at_pick),
            created_at: toStr(rowObj.created_at, null as unknown as string),
          };
          setPicks((p) => [...p, row].sort((a, b) => a.pick_number - b.pick_number));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  /* derived */
  const totalPicksSoFar = picks.length;
  const onClock = onClockName(totalPicksSoFar, week);
  const isMyTurn = norm(myName) !== '' && norm(onClock) === norm(myName);

  /* UI bits */

  function GameRow({ row }: { row: BoardRow }) {
    return (
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <img src={teamLogo(row.home_short) || ''} alt={row.home_short} className="w-4 h-4 rounded-sm" />
          <span className="w-8 font-semibold">{row.home_short}</span>
          <span className="ml-1 text-xs text-zinc-400">{fmtSigned(row.home_line)}</span>
          <span className="text-zinc-500 mx-2">v</span>
          <img src={teamLogo(row.away_short) || ''} alt={row.away_short} className="w-4 h-4 rounded-sm" />
          <span className="w-8 font-semibold">{row.away_short}</span>
          <span className="ml-1 text-xs text-zinc-400">{fmtSigned(row.away_line)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-12 text-right tabular-nums">{row.total ?? '—'}</span>
        </div>
      </div>
    );
  }

  async function makePick(row: BoardRow, team_short: string) {
    if (!isMyTurn) return;

    const teamLine = team_short === row.home_short ? row.home_line : row.away_line;
    const key = `${row.home_short}-${row.away_short}`;

    try {
      setSubmittingKey(key);

      const payload = {
        season_year: YEAR,
        week_number: week,
        pick_number: totalPicksSoFar + 1,
        player_display_name: myName,
        team_short,
        home_short: row.home_short,
        away_short: row.away_short,
        spread_at_pick: teamLine, // store the team-specific number
        total_at_pick: row.total,
      };

      const { data, error } = await supabase
        .from('picks')
        .insert([payload])
        .select('*')
        .single();

      if (error) {
        // Surface the exact reason (RLS, constraint, etc.)
        // eslint-disable-next-line no-alert
        alert(`Could not place pick: ${error.message}`);
        return;
      }

      if (data) {
        const d = asRec(data);
        const added: PickTableRow = {
          id: toNumOrNull(d.id) ?? 0,
          season_year: toNumOrNull(d.season_year) ?? YEAR,
          week_number: toNumOrNull(d.week_number) ?? week,
          pick_number: toNumOrNull(d.pick_number) ?? totalPicksSoFar + 1,
          player_display_name: toStr(d.player_display_name),
          team_short: toStr(d.team_short),
          home_short: toStr(d.home_short),
          away_short: toStr(d.away_short),
          spread_at_pick: toNumOrNull(d.spread_at_pick),
          total_at_pick: toNumOrNull(d.total_at_pick),
          created_at: toStr(d.created_at, null as unknown as string),
        };
        setPicks((prev) => [...prev, added].sort((a, b) => a.pick_number - b.pick_number));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-alert
      alert(`Could not place pick: ${msg}`);
    } finally {
      setSubmittingKey(null);
    }
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
        <div className="grid grid-cols-[1fr,64px] text-xs px-3 py-2 bg-zinc-900/60 border-b">
          <div>Game</div>
          <div className="text-right">Total</div>
        </div>
        <div className="divide-y divide-zinc-800/60">
          {board.map((r, i) => (
            <div key={`${r.home_short}-${r.away_short}-${i}`}>
              <GameRow row={r} />
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
            const key = `${r.home_short}-${r.away_short}`;
            const disabled = !isMyTurn || submittingKey === key;
            return (
              <div key={key} className="border rounded p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <img src={teamLogo(r.home_short) || ''} alt={r.home_short} className="w-4 h-4" />
                  <span className="font-semibold">{r.home_short}</span>
                  <span className="text-xs text-zinc-400 ml-1">{fmtSigned(r.home_line)}</span>
                  <span className="text-zinc-500 mx-2">v</span>
                  <img src={teamLogo(r.away_short) || ''} alt={r.away_short} className="w-4 h-4" />
                  <span className="font-semibold">{r.away_short}</span>
                  <span className="text-xs text-zinc-400 ml-1">{fmtSigned(r.away_line)}</span>
                  <span className="ml-3 text-xs text-zinc-500">/ {r.total ?? '—'}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                    disabled={disabled}
                    onClick={() => makePick(r, r.home_short)}
                  >
                    Pick {r.home_short} ({fmtSigned(r.home_line)})
                  </button>
                  <button
                    className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                    disabled={disabled}
                    onClick={() => makePick(r, r.away_short)}
                  >
                    Pick {r.away_short} ({fmtSigned(r.away_line)})
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
