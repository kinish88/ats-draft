'use client';

import { useEffect, useMemo, useState } from 'react';
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
  game_id: number;
  home_short: string;
  away_short: string;
  home_line: number; // signed for HOME (PK=0)
  away_line: number; // signed for AWAY (PK=0)
  total: number | null;
};

type PickRow = {
  id: number;
  week_id: number;
  game_id: number | null;
  team_id: number | null;
  pick_number: number;
  player_display_name: string;
  spread_at_pick: number | null;
  created_at: string | null;
  home_short?: string | null;
  away_short?: string | null;
};

type WeekRow = { id: number };
type TeamRow = { id: number; short: string };

/* --------------------------------- utils --------------------------------- */

type R = Record<string, unknown>;
const asRec = (x: unknown): R => (x && typeof x === 'object' ? (x as R) : {});

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
  const [weekId, setWeekId] = useState<number | null>(null);

  const [board, setBoard] = useState<BoardRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);

  const [myName, setMyName] = useState<string | null>(null);

  // team maps
  const [shortToId, setShortToId] = useState<Map<string, number>>(new Map());
  const [idToShort, setIdToShort] = useState<Map<number, string>>(new Map());

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

  /* load team id map once */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('teams').select('id, short').order('short');
      const arr: TeamRow[] = (Array.isArray(data) ? data : []).map((r) => ({
        id: Number((r as TeamRow).id),
        short: String((r as TeamRow).short).toUpperCase(),
      }));
      const s2i = new Map<string, number>();
      const i2s = new Map<number, string>();
      for (const t of arr) {
        s2i.set(t.short, t.id);
        i2s.set(t.id, t.short);
      }
      setShortToId(s2i);
      setIdToShort(i2s);
    })();
  }, []);

  /* resolve week_id whenever week changes */
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('weeks')
        .select('id')
        .eq('season_year', YEAR)
        .eq('week_number', week)
        .maybeSingle();
      setWeekId((data as WeekRow | null)?.id ?? null);
    })();
  }, [week]);

  /* load board (by year/week) */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('get_week_draft_board', {
        p_year: YEAR,
        p_week: week,
      });
      const rows: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];

      const mapped: BoardRow[] = rows.map((r) => {
        const o = asRec(r);
        const home = toStr(o.home_short).toUpperCase();
        const away = toStr(o.away_short).toUpperCase();

        // Prefer explicit per-team fields if they ever appear
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

        // Fallback: derive from single home-signed 'spread'
        if (hLine == null || aLine == null) {
          const s = toNumOrNull(o.spread);
          if (s != null) {
            hLine = s;
            aLine = -s;
          }
        }

        if (hLine == null || aLine == null) {
          hLine = 0;
          aLine = 0;
        }

        const tot = toNumOrNull(o.total) ?? toNumOrNull(o.total_line);

        return {
          game_id: toNumOrNull(o.game_id) ?? 0,
          home_short: home,
          away_short: away,
          home_line: hLine,
          away_line: aLine,
          total: tot,
        };
      });

      setBoard(mapped);
    })();
  }, [week]);

  /* load picks for current week_id */
  async function loadPicksForWeekId(wid: number) {
    const { data } = await supabase
      .from('picks')
      .select(
        'id, week_id, game_id, team_id, pick_number, player_display_name, spread_at_pick, created_at, home_short, away_short',
      )
      .eq('week_id', wid)
      .order('pick_number', { ascending: true });

    const arr: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
    const mapped: PickRow[] = arr.map((r) => {
      const o = asRec(r);
      return {
        id: Number(o.id ?? 0),
        week_id: Number(o.week_id ?? wid),
        game_id: toNumOrNull(o.game_id),
        team_id: toNumOrNull(o.team_id),
        pick_number: Number(o.pick_number ?? 0),
        player_display_name: toStr(o.player_display_name),
        spread_at_pick: toNumOrNull(o.spread_at_pick),
        created_at: toStr(o.created_at, null as unknown as string),
        home_short: toStr(o.home_short, ''),
        away_short: toStr(o.away_short, ''),
      };
    });
    setPicks(mapped);
  }

  useEffect(() => {
    if (weekId == null) return;
    loadPicksForWeekId(weekId);
  }, [weekId]);

  /* realtime picks (filter by week_id) */
  useEffect(() => {
    if (weekId == null) return;

    const ch = supabase
      .channel('draft-picks')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'picks' },
        (payload: RealtimePostgresChangesPayload<PickRow>) => {
          const o = asRec(payload.new as unknown);
          const wid = toNumOrNull(o.week_id);
          if (wid !== weekId) return;

          const row: PickRow = {
            id: Number(o.id ?? 0),
            week_id: Number(o.week_id ?? weekId),
            game_id: toNumOrNull(o.game_id),
            team_id: toNumOrNull(o.team_id),
            pick_number: Number(o.pick_number ?? 0),
            player_display_name: toStr(o.player_display_name),
            spread_at_pick: toNumOrNull(o.spread_at_pick),
            created_at: toStr(o.created_at, null as unknown as string),
            home_short: toStr(o.home_short, ''),
            away_short: toStr(o.away_short, ''),
          };
          setPicks((p) => [...p, row].sort((a, b) => a.pick_number - b.pick_number));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [weekId]);

  /* derived */
  const totalPicksSoFar = picks.length;
  const onClock = onClockName(totalPicksSoFar, week);
  const isMyTurn = norm(myName) !== '' && norm(onClock) === norm(myName);

  // taken sides for this week: "game_id:team_id"
  const takenKey = useMemo(() => {
    const s = new Set<string>();
    for (const p of picks) {
      if (p.game_id != null && p.team_id != null) {
        s.add(`${p.game_id}:${p.team_id}`);
      }
    }
    return s;
  }, [picks]);

  /* helper: ensure we have a week_id before inserting */
  async function ensureWeekId(): Promise<number | null> {
    if (weekId != null) return weekId;

    // Try fetch
    {
      const { data } = await supabase
        .from('weeks')
        .select('id')
        .eq('season_year', YEAR)
        .eq('week_number', week)
        .maybeSingle();
      const wid = (data as WeekRow | null)?.id ?? null;
      if (wid != null) {
        setWeekId(wid);
        return wid;
      }
    }

    // Try create (safe if you seeded already; else will insert)
    const { data: ins, error } = await supabase
      .from('weeks')
      .insert([{ season_year: YEAR, week_number: week }])
      .select('id')
      .single();
    if (error) return null;
    const wid = (ins as WeekRow).id;
    setWeekId(wid);
    return wid;
  }

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

    const wid = await ensureWeekId();
    if (wid == null) {
      alert('No week row found/created for this week.');
      return;
    }

    const gameId = row.game_id || null;
    const teamId = shortToId.get(team_short.toUpperCase()) ?? null;
    const spread = team_short === row.home_short ? row.home_line : row.away_line;

    // prevent double-pick of the same side in UI
    if (gameId != null && teamId != null && takenKey.has(`${gameId}:${teamId}`)) {
      alert('That side has already been taken.');
      return;
    }

    const payload = {
      week_id: wid,
      game_id: gameId,
      team_id: teamId,
      pick_number: totalPicksSoFar + 1,
      player_display_name: myName,
      spread_at_pick: spread,
      home_short: row.home_short,
      away_short: row.away_short,
    };

    const key = `${row.game_id}:${row.home_short}-${row.away_short}`;
    try {
      setSubmittingKey(key);

      const { data, error } = await supabase
        .from('picks')
        .insert([payload])
        .select('*')
        .single();

      if (error) {
        alert(`Could not place pick: ${error.message}`);
        return;
      }

      if (data) {
        const d = asRec(data);
        const added: PickRow = {
          id: Number(d.id ?? 0),
          week_id: Number(d.week_id ?? wid),
          game_id: toNumOrNull(d.game_id),
          team_id: toNumOrNull(d.team_id),
          pick_number: Number(d.pick_number ?? totalPicksSoFar + 1),
          player_display_name: toStr(d.player_display_name),
          spread_at_pick: toNumOrNull(d.spread_at_pick),
          created_at: toStr(d.created_at, null as unknown as string),
          home_short: toStr(d.home_short, ''),
          away_short: toStr(d.away_short, ''),
        };
        setPicks((prev) => [...prev, added].sort((a, b) => a.pick_number - b.pick_number));
      }
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
            <div key={`${r.game_id}-${r.home_short}-${r.away_short}-${i}`}>
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
            const key = `${r.game_id}:${r.home_short}-${r.away_short}`;
            const homeId = shortToId.get(r.home_short) ?? null;
            const awayId = shortToId.get(r.away_short) ?? null;

            const homeTaken =
              r.game_id != null && homeId != null && takenKey.has(`${r.game_id}:${homeId}`);
            const awayTaken =
              r.game_id != null && awayId != null && takenKey.has(`${r.game_id}:${awayId}`);

            // IMPORTANT: do NOT disable on weekId === null; we resolve it on click
            const homeDisabled = !isMyTurn || submittingKey === key || homeTaken;
            const awayDisabled = !isMyTurn || submittingKey === key || awayTaken;

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
                    disabled={homeDisabled}
                    onClick={() => makePick(r, r.home_short)}
                  >
                    Pick {r.home_short} ({fmtSigned(r.home_line)})
                  </button>
                  <button
                    className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                    disabled={awayDisabled}
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
