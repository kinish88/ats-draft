'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { whoIsOnClock, totalAtsPicks, type Player } from '@/lib/draftOrder';
import toast, { Toaster } from 'react-hot-toast';

/* ------------------------------- constants ------------------------------- */

const YEAR = 2025;
const BASE_ORDER = ['Big Dawg', 'Pud', 'Kinish'] as const;
type Starter = typeof BASE_ORDER[number];

function coerceStarter(s: string | null): Starter {
  return (BASE_ORDER as readonly string[]).includes(s ?? '') ? (s as Starter) : BASE_ORDER[0];
}

const DEFAULT_PLAYER =
  (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null;

const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

/* --------------------------------- utils --------------------------------- */

const norm = (s: string) => s.trim().toLowerCase();

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
function teamLogo(short?: string | null): string {
  const s = (short || '').toUpperCase();
  if (!s) return '';
  return LOGO_BASE ? `${LOGO_BASE}/${s}.png` : `/teams/${s}.png`;
}
function fmtSigned(n: number | null | undefined): string {
  if (n == null || n === 0) return 'Pick Em';
  return n > 0 ? `+${n}` : `${n}`;
}

/* --------------------------------- types --------------------------------- */

type BoardRow = {
  game_id: number;
  home_short: string;
  away_short: string;
  home_line: number;
  away_line: number;
  total: number | null;
};

type PickViewRow = {
  pick_id: number;
  created_at: string | null;
  pick_number: number;
  season_year: number;
  week_number: number;
  player: string;
  home_short: string;
  away_short: string;
  picked_team_short: string | null;
  line_at_pick: number | null;
  total_at_pick: number | null;
  ou_side?: 'OVER' | 'UNDER' | null;
  game_id_hint?: number | null;
};

/* -------------------------------- component ------------------------------- */

export default function DraftPage() {
  const [week, setWeek] = useState<number | null>(null);
  const [starter, setStarter] = useState<string | null>(null);

  const [board, setBoard] = useState<BoardRow[]>([]);
  const [picks, setPicks] = useState<PickViewRow[]>([]);
  const [myName, setMyName] = useState<string | null>(null);

  // load current open week from helper view
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('current_open_week')
        .select('week_id')
        .maybeSingle();
      if (!error && data?.week_id) setWeek(Number(data.week_id));
    })();
  }, []);

  // identify current user display name (or default)
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id || null;
      if (!uid) {
        setMyName(DEFAULT_PLAYER);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', uid)
        .maybeSingle();
      setMyName(toStr(data?.display_name || DEFAULT_PLAYER || ''));
    })();
  }, []);

  /* DB: fetch week starter */
  async function loadStarter(w: number) {
    const { data } = await supabase
      .from('weeks')
      .select('starter_player')
      .eq('season_year', YEAR)
      .eq('week_number', w)
      .maybeSingle();
    setStarter(toStr(data?.starter_player || ''));
  }

  /* load board */
  async function loadBoard(w: number) {
    const { data } = await supabase.rpc('get_week_draft_board', {
      p_year: YEAR,
      p_week: w,
    });
    const rows: unknown[] = Array.isArray(data) ? data : [];
    const mapped: BoardRow[] = rows.map((r) => {
      const o = asRec(r);
      return {
        game_id: Number(o.game_id ?? 0),
        home_short: toStr(o.home_short),
        away_short: toStr(o.away_short),
        home_line: Number(toNumOrNull(o.home_line) ?? 0),
        away_line: Number(toNumOrNull(o.away_line) ?? 0),
        total: toNumOrNull(o.total),
      };
    });
    setBoard(mapped);
  }

  /* load picks (spread + O/U merged for display) */
  const lastCountRef = useRef(0);
  async function loadPicksMerged(w: number, allowToast = false) {
    // spreads
    const { data } = await supabase.rpc('get_week_picks', {
      p_year: YEAR,
      p_week: w,
    });
    const spreadArr: unknown[] = Array.isArray(data) ? data : [];
    const spreadMapped: PickViewRow[] = spreadArr.map((r) => {
      const o = asRec(r);
      return {
        pick_id: Number(o.pick_id ?? 0),
        created_at: toStr(o.created_at, null as unknown as string),
        pick_number: Number(toNumOrNull(o.pick_number) ?? 0),
        season_year: YEAR,
        week_number: w,
        player: toStr(o.player),
        home_short: toStr(o.home_short),
        away_short: toStr(o.away_short),
        picked_team_short: toStr(o.picked_team_short, '') || null,
        line_at_pick: toNumOrNull(o.line_at_pick),
        total_at_pick: toNumOrNull(o.total_at_pick),
        ou_side: null,
        game_id_hint: Number(toNumOrNull(o.game_id)) || null,
      };
    });

    // o/u
    const { data: ouRaw } = await supabase.rpc('get_week_ou_picks_admin', {
      p_year: YEAR,
      p_week: w,
    });
    const ouArr: unknown[] = Array.isArray(ouRaw) ? ouRaw : [];
    const ouMapped: PickViewRow[] = ouArr.map((r, idx) => {
      const o = asRec(r);
      return {
        pick_id: 10_000 + idx,
        created_at: null,
        pick_number: 100 + idx,
        season_year: YEAR,
        week_number: w,
        player: toStr(o.player),
        home_short: toStr(o.home_short),
        away_short: toStr(o.away_short),
        picked_team_short: null,
        line_at_pick: null,
        total_at_pick: toNumOrNull(o.total_at_pick),
        ou_side: (toStr(o.pick_side).toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER') as
          | 'OVER'
          | 'UNDER',
        game_id_hint: null,
      };
    });

    const merged = [...spreadMapped, ...ouMapped].sort((a, b) =>
      a.pick_number === b.pick_number
        ? (a.created_at ?? '').localeCompare(b.created_at ?? '')
        : a.pick_number - b.pick_number
    );

    // toast for new pick
    if (allowToast && merged.length > lastCountRef.current) {
      const latest = merged[merged.length - 1];
      if (latest) {
        if (latest.picked_team_short) {
          const line = latest.line_at_pick ?? 0;
          const tone = line === 0 ? 'neutral' : line > 0 ? 'positive' : 'negative';
          const msg = `${latest.player} picked ${latest.picked_team_short} (${fmtSigned(line)})`;
          const logo = teamLogo(latest.picked_team_short);
          toast.custom(
            (t) => (
              <div className={`toast-pop ${tone} ${t.visible ? 'in' : 'out'}`}>
                {logo ? <img src={logo} alt="" className="w-5 h-5 rounded-sm" /> : null}
                <span>{msg}</span>
              </div>
            ),
            { duration: 4000 }
          );
        } else if (latest.total_at_pick != null && latest.ou_side) {
          const msg = `${latest.player} picked ${latest.ou_side} ${latest.total_at_pick} — ${latest.home_short} v ${latest.away_short}`;
          toast.custom(
            (t) => <div className={`toast-pop neutral ${t.visible ? 'in' : 'out'}`}>{msg}</div>,
            { duration: 4000 }
          );
        }
      }
    }
    lastCountRef.current = merged.length;
    setPicks(merged);
  }

  // load all for selected week
  useEffect(() => {
    if (!week) return;
    loadStarter(week);
    loadBoard(week);
    loadPicksMerged(week);
  }, [week]);

  // realtime
  useEffect(() => {
    if (!week) return;
    const ch = supabase
      .channel('draft-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'picks' }, () =>
        loadPicksMerged(week, true)
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ou_picks' }, () =>
        loadPicksMerged(week, true)
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ou_picks' }, () =>
        loadPicksMerged(week, true)
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_lines' }, () =>
        loadBoard(week)
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [week]);

  /* ------------------------------ derived -------------------------------- */

  // order for rounds based on starter for the week
  const playersR1Names: string[] = useMemo(() => {
    const s: Starter = coerceStarter(starter);
    const idx = BASE_ORDER.indexOf(s);
    return [...BASE_ORDER.slice(idx), ...BASE_ORDER.slice(0, idx)];
  }, [starter]);

  const playersR1: Player[] = useMemo(
    () => playersR1Names.map((n) => ({ id: n, display_name: n })),
    [playersR1Names]
  );

  const spreadPicksCount = useMemo(
    () => picks.filter((p) => p.picked_team_short != null).length,
    [picks]
  );
  const atsTotal = totalAtsPicks(playersR1.length); // 9
  const ouPhase = spreadPicksCount >= atsTotal;

  const ouPicksCount = useMemo(
    () => picks.filter((p) => p.total_at_pick != null).length,
    [picks]
  );
  // O/U order continues snake: last spread picker first
  const ouOrder = useMemo(() => [playersR1Names[2], playersR1Names[1], playersR1Names[0]], [
    playersR1Names,
  ]);

  // who is on the clock
  const { player: onClockPlayerSpread } = whoIsOnClock({
    current_pick_number: Math.min(spreadPicksCount, atsTotal - 1),
    players: playersR1,
  });
  const onClockSpread = onClockPlayerSpread.display_name;
  const onClockOu = ouPhase && ouPicksCount < ouOrder.length ? ouOrder[ouPicksCount] : '';
  const draftComplete = ouPhase && ouPicksCount >= ouOrder.length;
  const onClock = draftComplete ? '' : ouPhase ? onClockOu : onClockSpread;

  const isMyTurn =
    !draftComplete && myName != null && norm(onClock) === norm(myName);

  const pickedTeams = useMemo(() => {
    const s = new Set<string>();
    for (const p of picks) {
      if (p.picked_team_short) s.add(p.picked_team_short.toUpperCase());
    }
    return s;
  }, [picks]);

  const myOuAlreadyPicked = useMemo(() => {
    if (!myName) return false;
    const me = norm(myName);
    return picks.some((p) => p.total_at_pick != null && norm(p.player) === me);
  }, [picks, myName]);

  /* -------------------------------- actions ------------------------------- */

  async function makeSpreadPick(row: BoardRow, team_short: string) {
    if (!isMyTurn || ouPhase) return;
    const teamLine = team_short === row.home_short ? row.home_line : row.away_line;
    const { error } = await supabase.from('picks').insert([
      {
        season_year: YEAR,
        pick_number: spreadPicksCount + 1,
        player_display_name: myName,
        team_short,
        home_short: row.home_short,
        away_short: row.away_short,
        spread_at_pick: teamLine,
        game_id: row.game_id,
      },
    ]);
    if (error) {
      alert(`Could not place pick: ${error.message}`);
    } else {
      loadPicksMerged(week!, true);
    }
  }

  async function makeOuPick(row: BoardRow, side: 'OVER' | 'UNDER') {
    if (!isMyTurn || !ouPhase || myOuAlreadyPicked || row.total == null || !myName) return;
    const { error } = await supabase.rpc('make_ou_pick_by_shorts', {
      p_year: YEAR,
      p_week: week,
      p_player: myName,
      p_home: row.home_short,
      p_away: row.away_short,
      p_side: side,
    });
    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('uq') || msg.includes('unique')) {
        alert('That game or player already has an O/U pick');
      } else {
        alert(`Could not place O/U pick: ${error.message}`);
      }
    } else {
      loadPicksMerged(week!, true);
    }
  }

  if (!week) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Toaster position="bottom-center" />
        <div className="opacity-70">Loading current draft week…</div>
      </div>
    );
  }

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <Toaster position="bottom-center" />
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Draft Board</h1>
        <div className="text-sm opacity-70">Week {week}</div>
      </header>

      {/* On the clock / phase banner */}
      {!draftComplete ? (
        <div className="text-sm">
          {!ouPhase ? (
            <span className="text-zinc-400">
              On the clock:{' '}
              <span className="text-zinc-100 font-medium">{onClock}</span>
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
            </span>
          ) : (
            <span className="text-amber-400">
              O/U phase — order: {ouOrder.join(' → ')}.{' '}
              {myName ? (
                <>
                  You are <span className="font-medium">{myName}</span> —{' '}
                  {isMyTurn ? (
                    <span className="text-emerald-400 font-medium">your turn</span>
                  ) : myOuAlreadyPicked ? (
                    <span className="text-zinc-400">you’re done</span>
                  ) : (
                    <span className="text-zinc-400">wait</span>
                  )}
                </>
              ) : null}
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-3 py-2 rounded bg-zinc-900/50 border border-zinc-800">
          <span className="text-emerald-400 font-semibold tracking-wide">
            🏈 PICKS ARE IN 🏈
          </span>
        </div>
      )}

      {/* ================= GAME LINES (table) ================= */}
      <section className="border rounded overflow-hidden max-w-4xl mx-auto w-full">
        <div className="px-3 py-2 text-xs bg-zinc-900/60 border-b border-zinc-800 uppercase tracking-wide">
          Game Lines
        </div>
        <table className="w-full text-sm table-fixed">
          <thead className="bg-zinc-900/30 text-zinc-400">
            <tr>
              <th className="w-3/4 text-left px-3 py-2">Game</th>
              <th className="w-1/4 text-right px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {board.map((g) => (
              <tr key={g.game_id} className="hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <img
                      src={teamLogo(g.home_short) || ''}
                      alt={g.home_short}
                      className="w-5 h-5 rounded-sm"
                    />
                    <span className="font-semibold">{g.home_short}</span>
                    <span className="text-xs text-zinc-400 ml-1">{fmtSigned(g.home_line)}</span>
                    <span className="text-zinc-500 mx-2">v</span>
                    <img
                      src={teamLogo(g.away_short) || ''}
                      alt={g.away_short}
                      className="w-5 h-5 rounded-sm"
                    />
                    <span className="font-semibold">{g.away_short}</span>
                    <span className="text-xs text-zinc-400 ml-1">{fmtSigned(g.away_line)}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-xs text-zinc-400">
                  O/U <span className="text-zinc-200">{g.total ?? '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ================= MAKE PICKS (2-col grid) ================= */}
      <section className="max-w-4xl mx-auto w-full">
        <div className="px-3 py-2 text-xs bg-zinc-900/60 border border-zinc-800 rounded-t uppercase tracking-wide">
          Make Picks
        </div>

        <div className="grid md:grid-cols-2 gap-3 border border-t-0 border-zinc-800 rounded-b p-3">
          {board.map((g) => {
            const homeTaken = pickedTeams.has(g.home_short.toUpperCase());
            const awayTaken = pickedTeams.has(g.away_short.toUpperCase());
            const showSpreadButtons = !ouPhase;
            const showOuButtons = ouPhase;

            return (
              <div key={g.game_id} className="border rounded p-3 bg-zinc-950/50">
                <div className="text-sm text-zinc-300 mb-2">
                  {g.home_short} vs {g.away_short}
                </div>

                {showSpreadButtons && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                      disabled={!isMyTurn || homeTaken}
                      onClick={() => makeSpreadPick(g, g.home_short)}
                    >
                      Pick {g.home_short} ({fmtSigned(g.home_line)})
                    </button>
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                      disabled={!isMyTurn || awayTaken}
                      onClick={() => makeSpreadPick(g, g.away_short)}
                    >
                      Pick {g.away_short} ({fmtSigned(g.away_line)})
                    </button>
                  </div>
                )}

                {showOuButtons && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                      disabled={!isMyTurn || g.total == null || myOuAlreadyPicked}
                      onClick={() => makeOuPick(g, 'OVER')}
                    >
                      OVER {g.total ?? '—'}
                    </button>
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                      disabled={!isMyTurn || g.total == null || myOuAlreadyPicked}
                      onClick={() => makeOuPick(g, 'UNDER')}
                    >
                      UNDER {g.total ?? '—'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Picks feed (unchanged) */}
      <section className="border rounded overflow-hidden max-w-4xl mx-auto w-full">
        <div className="px-3 py-2 text-xs bg-zinc-900/60 border-b">Picks</div>
        <ul className="divide-y divide-zinc-800/60">
          {picks.length === 0 ? (
            <li className="px-3 py-2 text-zinc-400">No picks yet.</li>
          ) : (
            picks.map((p) => {
              const isSpread = p.picked_team_short != null;
              return (
                <li key={`${p.pick_id}-${p.pick_number}`} className="px-3 py-2">
                  <strong>{p.player}</strong>{' '}
                  {isSpread ? (
                    <>
                      picked <strong>{p.picked_team_short}</strong>{' '}
                      {p.line_at_pick != null ? fmtSigned(p.line_at_pick) : ''} — {p.home_short} v {p.away_short}
                    </>
                  ) : (
                    <>
                      O/U — <strong>{p.home_short} v {p.away_short}</strong> {p.ou_side} {p.total_at_pick ?? '—'}
                    </>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </section>

      {/* Toast styles */}
      <style jsx global>{`
        .toast-pop {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
          color: #e5e7eb;
          background: #27272a;
          transform: translateY(8px);
          opacity: 0;
          transition: transform 250ms ease, opacity 250ms ease;
          font-size: 0.9rem;
        }
        .toast-pop.in {
          transform: translateY(0);
          opacity: 1;
        }
        .toast-pop.out {
          transform: translateY(8px);
          opacity: 0;
        }
        .toast-pop.positive {
          background: #064e3b;
          border-color: #065f46;
          color: #d1fae5;
        }
        .toast-pop.negative {
          background: #7f1d1d;
          border-color: #991b1b;
          color: #fee2e2;
        }
        .toast-pop.neutral {
          background: #27272a;
          border-color: #3f3f46;
          color: #e5e7eb;
        }
      `}</style>
    </div>
  );
}
