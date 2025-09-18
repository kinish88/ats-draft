'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  whoIsOnClock,
  totalAtsPicks,
  type Player,
} from '@/lib/draftOrder';

/* ------------------------------- constants ------------------------------- */

const YEAR = 2025;

// Week-1 round-1 order for the league
const PLAYERS_R1: readonly string[] = ['Kinish', 'Big Dawg', 'Pud'] as const;

const DEFAULT_PLAYER =
  (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null;

const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

// Optional NFL logo (falls back to 🏈 emoji if missing)
const NFL_LOGO = (process.env.NEXT_PUBLIC_NFL_LOGO || '/nfl.svg').trim();

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

type AdminOuRowUnknown = {
  player?: unknown;
  home_short?: unknown;
  away_short?: unknown;
  pick_side?: unknown;
  total_at_pick?: unknown;
  game_id?: unknown;
};

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
function teamLogo(short?: string | null): string | null {
  if (!short) return null;
  return LOGO_BASE ? `${LOGO_BASE}/${short}.png` : `/teams/${short}.png`;
}
function fmtSigned(n: number): string {
  if (n === 0) return 'Pick Em';
  return n > 0 ? `+${n}` : `${n}`;
}

// Week resolving that won’t “jump”
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function resolveInitialWeek(): number {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('week');
  if (fromUrl) return clamp(parseInt(fromUrl, 10) || 1, 1, 18);

  const stored = localStorage.getItem('ats.week');
  if (stored) return clamp(parseInt(stored, 10) || 1, 1, 18);

  return 1; // sensible default
}

/* -------------------------------- component ------------------------------- */

export default function DraftPage() {
  const [week, setWeek] = useState<number>(2); // temp initial, corrected on mount

  // robust week bootstrapping + react to back/forward
  useEffect(() => {
    setWeek(resolveInitialWeek());
    const onPop = () => setWeek(resolveInitialWeek());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const [board, setBoard] = useState<BoardRow[]>([]);
  const [picks, setPicks] = useState<PickViewRow[]>([]);
  const [myName, setMyName] = useState<string | null>(null);

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
    const { data } = await supabase.rpc('get_week_draft_board', {
      p_year: YEAR,
      p_week: w,
    });
    const rows: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];

    const mapped: BoardRow[] = rows.map((r) => {
      const o = asRec(r);
      const home = toStr(o.home_short);
      const away = toStr(o.away_short);

      // prefer already-signed per-team numbers
      let hLine =
        toNumOrNull(o.home_line) ??
        toNumOrNull(o.home_spread) ??
        toNumOrNull(o.spread_home);
      let aLine =
        toNumOrNull(o.away_line) ??
        toNumOrNull(o.away_spread) ??
        toNumOrNull(o.spread_away);

      // derive sign if needed
      if (hLine == null || aLine == null) {
        const raw = toNumOrNull(o.spread);
        const favShort = toStr(o.favorite_short, '').toUpperCase();
        const favIsHome: boolean | null =
          favShort
            ? favShort === home.toUpperCase()
            : typeof o.favorite_is_home === 'boolean'
            ? Boolean(o.favorite_is_home)
            : typeof o.is_home_favorite === 'boolean'
            ? Boolean(o.is_home_favorite)
            : null;

        if (raw != null) {
          const mag = Math.abs(raw);
          if (favIsHome === true) {
            hLine = -mag;
            aLine = +mag;
          } else if (favIsHome === false) {
            hLine = +mag;
            aLine = -mag;
          } else {
            hLine = raw;
            aLine = -raw;
          }
        }
      }

      if (hLine == null || aLine == null) {
        hLine = 0;
        aLine = 0;
      }

      return {
        game_id: Number(o.game_id ?? o.id ?? 0),
        home_short: home,
        away_short: away,
        home_line: hLine,
        away_line: aLine,
        total: toNumOrNull(o.total),
      };
    });

    setBoard(mapped);
  }

  /* load picks (spread + O/U) */
  async function loadPicksMerged(w: number) {
    // A) spread picks
    const { data } = await supabase.rpc('get_week_picks', {
      p_year: YEAR,
      p_week: w,
    });
    const spreadArr: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
    const spreadMapped: PickViewRow[] = spreadArr.map((r) => {
      const o = asRec(r);
      return {
        pick_id: Number(o.pick_id ?? 0),
        created_at: toStr(o.created_at, null as unknown as string),
        pick_number: Number(toNumOrNull(o.pick_number) ?? 0), // 1..9
        season_year: Number(toNumOrNull(o.season_year) ?? YEAR),
        week_number: Number(toNumOrNull(o.week_number) ?? w),
        player: toStr(o.player),
        home_short: toStr(o.home_short),
        away_short: toStr(o.away_short),
        picked_team_short: toStr(o.picked_team_short, '') || null,
        line_at_pick: toNumOrNull(o.line_at_pick),
        total_at_pick: toNumOrNull(o.total_at_pick),
        ou_side: null,
        game_id_hint: Number(toNumOrNull(o.game_id)),
      };
    });

    // B) O/U picks
    const { data: ouRaw } = await supabase.rpc('get_week_ou_picks_admin', {
      p_year: YEAR,
      p_week: w,
    });
    const ouArr: unknown[] = Array.isArray(ouRaw) ? (ouRaw as unknown[]) : [];

    const findGameId = (homeShort: string, awayShort: string): number | null => {
      const item = board.find(
        (b) =>
          norm(b.home_short) === norm(homeShort) &&
          norm(b.away_short) === norm(awayShort)
      );
      return item?.game_id ?? null;
    };

    const ouMapped: PickViewRow[] = ouArr.map((r, idx) => {
      const x = r as AdminOuRowUnknown;
      const side: 'OVER' | 'UNDER' =
        toStr(x.pick_side).trim().toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
      const home = toStr(x.home_short);
      const away = toStr(x.away_short);
      const gid =
        Number(toNumOrNull(x.game_id)) ?? (findGameId(home, away) ?? null);

      return {
        pick_id: 10_000 + idx, // synthetic id
        created_at: null,
        pick_number: 100 + idx, // sort after 1..9
        season_year: YEAR,
        week_number: w,
        player: toStr(x.player),
        home_short: home,
        away_short: away,
        picked_team_short: null,
        line_at_pick: null,
        total_at_pick: toNumOrNull(x.total_at_pick),
        ou_side: side,
        game_id_hint: gid,
      };
    });

    // C) merge + stable sort
    const merged = [...spreadMapped, ...ouMapped].sort((a, b) =>
      a.pick_number === b.pick_number
        ? (a.created_at ?? '').localeCompare(b.created_at ?? '')
        : a.pick_number - b.pick_number
    );

    setPicks(merged);
  }

  useEffect(() => {
    loadBoard(week);
    loadPicksMerged(week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  /* realtime */
  useEffect(() => {
    const ch = supabase
      .channel('draft-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'picks' }, () => {
        loadPicksMerged(week);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ou_picks' }, () => {
        loadPicksMerged(week);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ou_picks' }, () => {
        loadPicksMerged(week);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games' }, () => {
        loadBoard(week);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_lines' }, () => {
        loadBoard(week);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  /* ------------------------------ derived -------------------------------- */

  // count by type
  const spreadPicksCount = useMemo(
    () => picks.filter((p) => p.picked_team_short != null).length,
    [picks]
  );
  const ouPicksCount = useMemo(
    () => picks.filter((p) => p.total_at_pick != null).length,
    [picks]
  );

  const playersR1: Player[] = useMemo(
    () => PLAYERS_R1.map((name) => ({ id: name, display_name: name })),
    []
  );

  const atsTotal = totalAtsPicks(playersR1.length); // 3 players * 3 rounds = 9
  const totalPicksThisWeek = atsTotal + playersR1.length; // + 3 O/U = 12
  const totalPicksMade = spreadPicksCount + ouPicksCount;

  const ouPhase = spreadPicksCount >= atsTotal;
  const draftComplete = totalPicksMade >= totalPicksThisWeek;

  // Build global current_pick_number for whoIsOnClock
  const currentPickNumber = draftComplete
    ? totalPicksThisWeek
    : ouPhase
    ? atsTotal + ouPicksCount
    : spreadPicksCount;

  const { player: onClockPlayer } = whoIsOnClock({
    current_pick_number: Math.min(currentPickNumber, totalPicksThisWeek - 1),
    players: playersR1,
  });

  const onClock = draftComplete ? '' : onClockPlayer.display_name;
  const isMyTurn = !draftComplete && myName != null && norm(onClock) === norm(myName);

  // Have I already made my O/U?
  const myOuAlreadyPicked = useMemo(() => {
    if (!myName) return false;
    const me = norm(myName);
    return picks.some((p) => p.total_at_pick != null && norm(p.player) === me);
  }, [picks, myName]);

  // Disable ATS buttons for picked teams
  const pickedTeams = useMemo(() => {
    const s = new Set<string>();
    for (const p of picks) {
      if (p.picked_team_short) s.add(p.picked_team_short.toUpperCase());
    }
    return s;
  }, [picks]);

  // Disable O/U for already-taken games
  const takenOuGameIds = useMemo(() => {
    const s = new Set<number>();
    for (const p of picks) {
      if (p.total_at_pick != null && p.game_id_hint != null) {
        s.add(p.game_id_hint);
      }
    }
    return s;
  }, [picks]);

  // Group by player for the small scoreboard
  const picksByPlayer = useMemo(() => {
    const map = new Map<string, PickViewRow[]>();
    for (const name of PLAYERS_R1) map.set(name, []);
    for (const p of picks) {
      const key =
        (((PLAYERS_R1 as readonly string[]).find((n) => norm(n) === norm(p.player)) ?? p.player) || 'Unknown');
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.pick_number - b.pick_number);
    }
    return Array.from(map.entries());
  }, [picks]);

  /* ------------------------------- handlers ------------------------------- */

  async function makePick(row: BoardRow, team_short: string) {
    if (!isMyTurn || draftComplete || ouPhase) return;

    const teamLine =
      team_short === row.home_short ? row.home_line : row.away_line;

    const { error } = await supabase.from('picks').insert([
      {
        season_year: YEAR,
        pick_number: spreadPicksCount + 1, // 1..9 during spread phase
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
      return;
    }

    loadPicksMerged(week);
  }

  async function handleOuPick(
    game: { id: number; home: string; away: string },
    side: 'OVER' | 'UNDER',
    playerName: string | null
  ) {
    if (!isMyTurn || draftComplete || !ouPhase || !playerName) return;

    const { error } = await supabase.rpc('make_ou_pick_by_shorts', {
      p_year: YEAR,
      p_week: week,
      p_player: playerName,
      p_home: game.home,
      p_away: game.away,
      p_side: side,
    });

    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('uq_ou_picks_week_game')) {
        alert(`That game's O/U has already been taken.`);
      } else if (msg.includes('uq_ou_picks_player_week')) {
        alert(`You already made your O/U pick this week.`);
      } else {
        alert(`Could not place O/U pick: ${error.message}`);
      }
    } else {
      loadPicksMerged(week);
    }
  }

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Draft Board</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm opacity-70">Week</label>
          <select
            className="border rounded p-1 bg-transparent"
            value={week}
            onChange={(e) => {
              const w = clamp(parseInt(e.target.value, 10) || 1, 1, 18);
              setWeek(w);
              localStorage.setItem('ats.week', String(w));
              const params = new URLSearchParams(window.location.search);
              params.set('week', String(w));
              window.history.replaceState({}, '', `?${params.toString()}`);
            }}
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
            <div key={`${r.game_id}-${i}`}>
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <img src={teamLogo(r.home_short) || ''} alt={r.home_short} className="w-4 h-4 rounded-sm" />
                  <span className="w-8 font-semibold">{r.home_short}</span>
                  <span className="ml-1 text-xs text-zinc-400">{fmtSigned(r.home_line)}</span>
                  <span className="text-zinc-500 mx-2">v</span>
                  <img src={teamLogo(r.away_short) || ''} alt={r.away_short} className="w-4 h-4 rounded-sm" />
                  <span className="w-8 font-semibold">{r.away_short}</span>
                  <span className="ml-1 text-xs text-zinc-400">{fmtSigned(r.away_line)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-12 text-right tabular-nums">{r.total ?? '—'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Live draft */}
      <section className="space-y-4">
        {/* On the clock / Picks are in */}
        {!draftComplete ? (
          <div className="text-sm text-zinc-400">
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
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 py-2 rounded bg-zinc-900/50 border border-zinc-800">
            {/* If /nfl.svg exists this shows; otherwise users will see 🏈 */}
            <img
              src={NFL_LOGO}
              alt="NFL"
              className="h-5 w-5"
              onError={(e) => ((e.currentTarget.style.display = 'none'))}
            />
            <span className="text-emerald-400 font-semibold tracking-wide">
              🏈 PICKS ARE IN 🏈
            </span>
            <img
              src={NFL_LOGO}
              alt="NFL"
              className="h-5 w-5"
              onError={(e) => ((e.currentTarget.style.display = 'none'))}
            />
          </div>
        )}

        {/* Picks feed */}
        <div className="border rounded overflow-hidden">
          <div className="px-3 py-2 text-xs bg-zinc-900/60 border-b">Picks</div>
          <ul className="divide-y divide-zinc-800/60">
            {picks.length === 0 ? (
              <li className="px-3 py-2 text-zinc-400">No picks yet.</li>
            ) : (
              picks.map((p) => {
                const isSpread = p.picked_team_short != null;
                const line = isSpread
                  ? p.line_at_pick == null
                    ? 'Pick Em'
                    : fmtSigned(p.line_at_pick)
                  : p.total_at_pick != null
                  ? `${p.ou_side ?? ''} ${p.total_at_pick}`
                  : '';

                return (
                  <li key={`${p.pick_id}-${p.pick_number}`} className="px-3 py-2">
                    <strong>{p.player}</strong>{' '}
                    {isSpread ? (
                      <>
                        picked <strong>{p.picked_team_short}</strong> ({line}) — {p.home_short} v {p.away_short}
                      </>
                    ) : (
                      <>
                        O/U — <strong>{p.home_short} v {p.away_short}</strong> {line}
                      </>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* Grouped by player */}
        <div className="grid md:grid-cols-3 gap-3">
          {picksByPlayer.map(([player, list]) => (
            <div key={player} className="border rounded p-3">
              <div className="font-medium mb-2">{player}</div>
              {list.length === 0 ? (
                <div className="text-sm text-zinc-400">—</div>
              ) : (
                <ul className="text-sm space-y-1">
                  {list.map((p) => (
                    <li key={`${player}-${p.pick_id}-${p.pick_number}`}>
                      {p.picked_team_short ? (
                        <>
                          {p.picked_team_short}{' '}
                          <span className="text-zinc-400">
                            {p.line_at_pick != null ? `(${fmtSigned(p.line_at_pick)})` : ''} — {p.home_short} v {p.away_short}
                          </span>
                        </>
                      ) : (
                        <>
                          O/U{' '}
                          <span className="text-zinc-400">
                            {p.home_short} v {p.away_short} — {p.ou_side ?? ''} {p.total_at_pick ?? '—'}
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* O/U phase banner (only while running) */}
        {!draftComplete && ouPhase && (
          <div className="text-sm text-amber-400">
            O/U phase started — spread picks are now locked. Make your OVER/UNDER pick.
          </div>
        )}

        {/* Pick buttons */}
        <div className="grid md:grid-cols-2 gap-3">
          {board.map((r) => {
            const homeTaken = pickedTeams.has(r.home_short.toUpperCase());
            const awayTaken = pickedTeams.has(r.away_short.toUpperCase());
            const ouTaken = takenOuGameIds.has(r.game_id);

            return (
              <div key={r.game_id} className="border rounded p-3 flex flex-col gap-2">
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
                  {/* Spread */}
                  <button
                    className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                    disabled={draftComplete || !isMyTurn || ouPhase || homeTaken}
                    onClick={() => makePick(r, r.home_short)}
                    title={
                      draftComplete
                        ? 'Draft complete'
                        : ouPhase
                        ? 'O/U phase has started'
                        : homeTaken
                        ? 'Already taken'
                        : 'Pick home'
                    }
                  >
                    Pick {r.home_short} ({fmtSigned(r.home_line)})
                  </button>
                  <button
                    className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                    disabled={draftComplete || !isMyTurn || ouPhase || awayTaken}
                    onClick={() => makePick(r, r.away_short)}
                    title={
                      draftComplete
                        ? 'Draft complete'
                        : ouPhase
                        ? 'O/U phase has started'
                        : awayTaken
                        ? 'Already taken'
                        : 'Pick away'
                    }
                  >
                    Pick {r.away_short} ({fmtSigned(r.away_line)})
                  </button>

                  {/* O/U */}
                  <button
                    className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                    disabled={draftComplete || !isMyTurn || !ouPhase || myOuAlreadyPicked || r.total == null || ouTaken}
                    onClick={() =>
                      handleOuPick(
                        { id: r.game_id, home: r.home_short, away: r.away_short },
                        'OVER',
                        myName || onClock
                      )
                    }
                    title={
                      draftComplete
                        ? 'Draft complete'
                        : !ouPhase
                        ? 'O/U phase not started yet'
                        : myOuAlreadyPicked
                        ? 'You already made your O/U pick'
                        : r.total == null
                        ? 'No total available for this game'
                        : ouTaken
                        ? 'That game’s O/U is already taken'
                        : 'Pick OVER'
                    }
                  >
                    OVER {r.total ?? '—'}
                  </button>
                  <button
                    className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                    disabled={draftComplete || !isMyTurn || !ouPhase || myOuAlreadyPicked || r.total == null || ouTaken}
                    onClick={() =>
                      handleOuPick(
                        { id: r.game_id, home: r.home_short, away: r.away_short },
                        'UNDER',
                        myName || onClock
                      )
                    }
                    title={
                      draftComplete
                        ? 'Draft complete'
                        : !ouPhase
                        ? 'O/U phase not started yet'
                        : myOuAlreadyPicked
                        ? 'You already made your O/U pick'
                        : r.total == null
                        ? 'No total available for this game'
                        : ouTaken
                        ? 'That game’s O/U is already taken'
                        : 'Pick UNDER'
                    }
                  >
                    UNDER {r.total ?? '—'}
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
