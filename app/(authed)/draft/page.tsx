'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

const YEAR = 2025;
const PLAYERS = ['Big Dawg', 'Pud', 'Kinish'] as const;
const LOGO_BASE = (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

/* ----------------------------- types ----------------------------- */

type BoardRow = { home: string; away: string; spread: number | null; total: number | null };
type DraftBoardRpcRow = { home_short?: unknown; away_short?: unknown; spread?: unknown; total?: unknown };

type PickRow = {
  id: number;
  season_year: number;
  week_number: number;
  pick_number: number;
  player_display_name: string;
  team_short: string;
  home_short: string;
  away_short: string;
  spread_at_pick: number | null;
};

type PickTableRow = {
  id: number;
  season_year: number;
  week_number: number;
  pick_number: number;
  player_display_name?: string | null;
  player_name?: string | null;
  team_short: string;
  home_short: string;
  away_short: string;
  spread_at_pick: number | null;
};

type OuPickRow = {
  id: number;
  season_year: number;
  week_number: number;
  player_display_name: string;
  home_short: string;
  away_short: string;
  pick_side: 'OVER' | 'UNDER';
  total_at_pick: number | null;
};

type OuTableRow = {
  id: number;
  season_year: number;
  week_number: number;
  player_display_name?: string | null;
  player_name?: string | null;
  home_short: string;
  away_short: string;
  pick_side: 'OVER' | 'UNDER';
  total_at_pick: number | null;
};

/* ----------------------------- utils ----------------------------- */

function teamLogo(short?: string | null) {
  if (!short) return null;
  return LOGO_BASE ? `${LOGO_BASE}/${short}.png` : `/teams/${short}.png`;
}
function TinyLogo({ s }: { s: string }) {
  const url = teamLogo(s);
  return url ? <img src={url} alt={s} className="w-5 h-5 rounded-sm" /> : <span className="w-5 h-5" />;
}
function matchup(h: string, a: string) {
  return `${h} v ${a}`;
}
function signed(n: number | null | undefined) {
  if (n == null) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}
function isPickTableRow(x: unknown): x is PickTableRow {
  return (
    isRecord(x) &&
    typeof x.id === 'number' &&
    typeof x.season_year === 'number' &&
    typeof x.week_number === 'number' &&
    typeof x.pick_number === 'number' &&
    typeof x.team_short === 'string' &&
    typeof x.home_short === 'string' &&
    typeof x.away_short === 'string'
  );
}
function isOuTableRow(x: unknown): x is OuTableRow {
  return (
    isRecord(x) &&
    typeof x.id === 'number' &&
    typeof x.season_year === 'number' &&
    typeof x.week_number === 'number' &&
    typeof x.home_short === 'string' &&
    typeof x.away_short === 'string' &&
    (x.pick_side === 'OVER' || x.pick_side === 'UNDER')
  );
}

/** Rotate players by week so Week1 starts at index 0, Week2 at 1, Week3 at 2, then repeat. */
function rotatedPlayersByWeek(players: readonly string[], week: number): string[] {
  const offset = ((Math.max(1, week) - 1) % players.length);
  return [...players.slice(offset), ...players.slice(0, offset)];
}

/** Build 3-player snake order for 9 picks, starting from week-based rotation. */
function snakeOrderForWeek(week: number): string[] {
  const r = rotatedPlayersByWeek(PLAYERS as readonly string[], week);
  // forward, reverse, forward
  return [r[0], r[1], r[2], r[2], r[1], r[0], r[0], r[1], r[2]];
}

/* ------------------------------ page ----------------------------- */

export default function DraftPage() {
  const [week, setWeek] = useState<number>(2);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPickRow[]>([]);
  const [making, setMaking] = useState(false);

  const onScreenPairsRef = useRef<Set<string>>(new Set());

  const snakeOrder = useMemo(() => snakeOrderForWeek(week), [week]);

  const nextPickNumber = useMemo(() => {
    const taken = new Set(picks.map(p => p.pick_number));
    for (let i = 1; i <= 9; i++) if (!taken.has(i)) return i;
    return null;
  }, [picks]);

  const currentPlayer: string | null = useMemo(() => {
    if (nextPickNumber == null) return null;
    return snakeOrder[nextPickNumber - 1] ?? null;
  }, [nextPickNumber, snakeOrder]);

  const availablePairs = useMemo(() => {
    const pickedPairs = new Set(picks.map(p => `${p.home_short}-${p.away_short}`));
    return new Set(board.map(b => `${b.home}-${b.away}`).filter(k => !pickedPairs.has(k)));
  }, [board, picks]);

  async function loadAll(w: number) {
    // 1) Board (lines) — correct fields: home_short / away_short
    const { data: b } = await supabase.rpc('get_week_draft_board', { p_year: YEAR, p_week: w });
    const rows = (Array.isArray(b) ? (b as DraftBoardRpcRow[]) : []);
    const boardRows: BoardRow[] = rows.map((r) => ({
      home: String(r.home_short ?? ''),
      away: String(r.away_short ?? ''),
      spread: r.spread == null ? null : Number(r.spread),
      total: r.total == null ? null : Number(r.total),
    }));
    setBoard(boardRows);
    onScreenPairsRef.current = new Set(boardRows.map(r => `${r.home}-${r.away}`));

    // 2) Picks so far
    const { data: sp } = await supabase
      .from('v_pick_results')
      .select('id,season_year,week_number,pick_number,player_display_name,player_name,team_short,home_short,away_short,spread_at_pick')
      .eq('season_year', YEAR)
      .eq('week_number', w)
      .order('pick_number', { ascending: true });

    const spRows: unknown[] = Array.isArray(sp) ? sp : [];
    setPicks(
      spRows.filter(isPickTableRow).map((r): PickRow => ({
        id: r.id,
        season_year: r.season_year,
        week_number: r.week_number,
        pick_number: r.pick_number,
        player_display_name: (r.player_display_name ?? r.player_name ?? '') || '',
        team_short: r.team_short,
        home_short: r.home_short,
        away_short: r.away_short,
        spread_at_pick: r.spread_at_pick,
      }))
    );

    // 3) O/U so far
    const { data: ou } = await supabase
      .from('v_ou_results')
      .select('id,season_year,week_number,player_display_name,player_name,home_short,away_short,pick_side,total_at_pick')
      .eq('season_year', YEAR)
      .eq('week_number', w);

    const ouRows: unknown[] = Array.isArray(ou) ? ou : [];
    setOuPicks(
      ouRows.filter(isOuTableRow).map((r): OuPickRow => ({
        id: r.id,
        season_year: r.season_year,
        week_number: r.week_number,
        player_display_name: (r.player_display_name ?? r.player_name ?? '') || '',
        home_short: r.home_short,
        away_short: r.away_short,
        pick_side: r.pick_side,
        total_at_pick: r.total_at_pick,
      }))
    );
  }

  useEffect(() => { loadAll(week); }, [week]);

  // realtime: picks + O/U with safe guards
  useEffect(() => {
    const ch = supabase
      .channel('draft-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'picks' },
        (payload: RealtimePostgresChangesPayload<PickTableRow>) => {
          const rowUnknown = payload.new as unknown;
          if (!isPickTableRow(rowUnknown)) return;
          if (rowUnknown.season_year !== YEAR || rowUnknown.week_number !== week) return;

          const mapped: PickRow = {
            id: rowUnknown.id,
            season_year: rowUnknown.season_year,
            week_number: rowUnknown.week_number,
            pick_number: rowUnknown.pick_number,
            player_display_name: (rowUnknown.player_display_name ?? rowUnknown.player_name ?? '') || '',
            team_short: rowUnknown.team_short,
            home_short: rowUnknown.home_short,
            away_short: rowUnknown.away_short,
            spread_at_pick: rowUnknown.spread_at_pick,
          };

          setPicks(prev => {
            const existing = prev.find(p => p.id === mapped.id);
            if (existing) return prev.map(p => (p.id === mapped.id ? mapped : p));
            return [...prev, mapped].sort((a, b) => a.pick_number - b.pick_number);
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ou_picks' },
        (payload: RealtimePostgresChangesPayload<OuTableRow>) => {
          const rowUnknown = payload.new as unknown;
          if (!isOuTableRow(rowUnknown)) return;
          if (rowUnknown.season_year !== YEAR || rowUnknown.week_number !== week) return;

          const mapped: OuPickRow = {
            id: rowUnknown.id,
            season_year: rowUnknown.season_year,
            week_number: rowUnknown.week_number,
            player_display_name: (rowUnknown.player_display_name ?? rowUnknown.player_name ?? '') || '',
            home_short: rowUnknown.home_short,
            away_short: rowUnknown.away_short,
            pick_side: rowUnknown.pick_side,
            total_at_pick: rowUnknown.total_at_pick,
          };

          setOuPicks(prev => {
            const existing = prev.find(p => p.id === mapped.id);
            if (existing) return prev.map(p => (p.id === mapped.id ? mapped : p));
            return [...prev, mapped];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [week]);

  async function makeSpreadPick(team: string) {
    if (!currentPlayer || nextPickNumber == null) return;
    setMaking(true);
    try {
      const { error } = await supabase.rpc('make_spread_pick', {
        p_year: YEAR,
        p_week: week,
        p_pick_number: nextPickNumber,
        p_player: currentPlayer,
        p_team_short: team,
      });
      if (error) alert(error.message);
    } finally {
      setMaking(false);
    }
  }

  async function makeOuPick(choice: 'OVER' | 'UNDER', pair: { home: string; away: string }) {
    if (!currentPlayer) return;
    setMaking(true);
    try {
      const { error } = await supabase.rpc('make_ou_pick', {
        p_year: YEAR,
        p_week: week,
        p_player: currentPlayer,
        p_home_short: pair.home,
        p_away_short: pair.away,
        p_choice: choice,
      });
      if (error) alert(error.message);
    } finally {
      setMaking(false);
    }
  }

  const playerHasOu = useMemo(() => new Set(ouPicks.map(o => o.player_display_name)), [ouPicks]);

  const atsLeft: Record<string, number> = {
    'Big Dawg': 3 - picks.filter(p => p.player_display_name === 'Big Dawg').length,
    'Pud': 3 - picks.filter(p => p.player_display_name === 'Pud').length,
    'Kinish': 3 - picks.filter(p => p.player_display_name === 'Kinish').length,
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Draft Board</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm opacity-70">Week</label>
          <select
            className="border rounded p-1 bg-transparent"
            value={week}
            onChange={e => setWeek(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: 18 }, (_, i) => i + 1).map(w => (
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Board */}
      <section className="space-y-2">
        <p className="text-sm text-zinc-400">
          Showing <em>current market</em> numbers from <code>game_lines</code>. Picks store the line at pick-time.
        </p>
        <div className="border rounded overflow-hidden">
          <div className="grid grid-cols-12 px-3 py-2 bg-zinc-900/50 text-sm font-medium">
            <div className="col-span-10">Game</div>
            <div className="col-span-1 text-right">Spread</div>
            <div className="col-span-1 text-right">Total</div>
          </div>
          {board.map((r) => (
            <div key={`${r.home}-${r.away}`} className="grid grid-cols-12 px-3 py-2 border-t border-zinc-800 text-sm">
              <div className="col-span-10 flex items-center gap-2">
                <TinyLogo s={r.home} />
                <span className="w-10">{r.home}</span>
                <span className="opacity-50">v</span>
                <TinyLogo s={r.away} />
                <span className="w-10">{r.away}</span>
              </div>
              <div className="col-span-1 text-right">{signed(r.spread)}</div>
              <div className="col-span-1 text-right">{r.total ?? '—'}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Interactive draft */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Live Draft</h2>
          <div className="text-sm">
            {PLAYERS.map(name => (
              <span key={name} className={`ml-4 ${currentPlayer === name ? 'font-semibold' : ''}`}>
                {name} ({Math.max(0, atsLeft[name] ?? 0)} left)
              </span>
            ))}
          </div>
        </div>

        {/* Picks so far */}
        <div className="border rounded">
          <div className="px-3 py-2 bg-zinc-900/50 text-sm font-medium">Picks</div>
          {picks.length === 0 ? (
            <div className="px-3 py-3 text-sm text-zinc-400">No picks yet.</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {picks.map(p => (
                <div key={p.id} className="px-3 py-2 text-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-right mr-2 opacity-60">{p.pick_number}.</span>
                    <span className="w-24">{p.player_display_name}</span>
                    <TinyLogo s={p.team_short} />
                    <span className="w-8 font-semibold">{p.team_short}</span>
                    <span className="opacity-60">({matchup(p.home_short, p.away_short)})</span>
                  </div>
                  <div className="tabular-nums">{signed(p.spread_at_pick)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* On the clock + buttons */}
        {nextPickNumber !== null && nextPickNumber <= 9 ? (
          <div className="border rounded p-3">
            <div className="mb-3">
              <span className="text-sm opacity-70 mr-2">On the clock:</span>
              <span className="font-semibold">{currentPlayer}</span>
              <span className="ml-3 text-sm opacity-70">Pick #{nextPickNumber}</span>
            </div>

            <div className="grid md:grid-cols-2 gap-2">
              {board.map((g) => {
                const key = `${g.home}-${g.away}`;
                const taken = !availablePairs.has(key);
                return (
                  <div key={key} className={`border rounded p-2 ${taken ? 'opacity-40' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TinyLogo s={g.home} /><span className="w-8">{g.home}</span>
                        <span className="opacity-50">v</span>
                        <TinyLogo s={g.away} /><span className="w-8">{g.away}</span>
                      </div>
                      <div className="text-sm opacity-70">({signed(g.spread)} / {g.total ?? '—'})</div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="px-2 py-1 border rounded hover:bg-zinc-800 disabled:opacity-50"
                        disabled={taken || making}
                        onClick={() => makeSpreadPick(g.home)}
                      >
                        Pick {g.home}
                      </button>
                      <button
                        className="px-2 py-1 border rounded hover:bg-zinc-800 disabled:opacity-50"
                        disabled={taken || making}
                        onClick={() => makeSpreadPick(g.away)}
                      >
                        Pick {g.away}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="border rounded p-3">
            <div className="mb-3 font-medium">ATS complete — O/U tie-breakers</div>
            {(['Big Dawg','Pud','Kinish'] as string[]).map(name => {
              const already = playerHasOu.has(name);
              const nextOu = (['Big Dawg','Pud','Kinish'] as string[]).find(n => !playerHasOu.has(n)) ?? null;
              const meOnClock = !already && name === nextOu;

              return (
                <div key={name} className={`flex items-center justify-between py-2 border-t border-zinc-800 ${meOnClock ? 'bg-zinc-900/50' : ''}`}>
                  <div className="px-3">{name}</div>
                  <div className="flex items-center gap-2 px-3">
                    {already ? (
                      <span className="text-sm opacity-70">done</span>
                    ) : (
                      board.map(g => (
                        <div key={`${name}-${g.home}-${g.away}`} className="flex items-center gap-2">
                          <span className="text-sm opacity-70">{matchup(g.home, g.away)}</span>
                          <button
                            className="px-2 py-1 border rounded hover:bg-zinc-800 disabled:opacity-50"
                            disabled={making}
                            onClick={() => makeOuPick('OVER', { home: g.home, away: g.away })}
                          >OVER</button>
                          <button
                            className="px-2 py-1 border rounded hover:bg-zinc-800 disabled:opacity-50"
                            disabled={making}
                            onClick={() => makeOuPick('UNDER', { home: g.home, away: g.away })}
                          >UNDER</button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
