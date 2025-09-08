'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;
const PLAYERS = ['Big Dawg', 'Pud', 'Kinish'] as const;
const LOGO_BASE = (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

type BoardRow = { home: string; away: string; spread: number | null; total: number | null };
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

const snakeOrder: string[] = [
  PLAYERS[0], PLAYERS[1], PLAYERS[2],
  PLAYERS[2], PLAYERS[1], PLAYERS[0],
  PLAYERS[0], PLAYERS[1], PLAYERS[2],
];

export default function DraftPage() {
  const [week, setWeek] = useState<number>(2);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPickRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [making, setMaking] = useState(false);

  const onScreenPairsRef = useRef<Set<string>>(new Set());

  const nextPickNumber = useMemo(() => {
    const taken = new Set(picks.map(p => p.pick_number));
    for (let i = 1; i <= 9; i++) if (!taken.has(i)) return i;
    return null;
  }, [picks]);

  const currentPlayer: string | null = useMemo(() => {
    if (nextPickNumber == null) return null;
    return snakeOrder[nextPickNumber - 1] ?? null;
  }, [nextPickNumber]);

  const availablePairs = useMemo(() => {
    const pickedPairs = new Set(picks.map(p => `${p.home_short}-${p.away_short}`));
    return new Set(board.map(b => `${b.home}-${b.away}`).filter(k => !pickedPairs.has(k)));
  }, [board, picks]);

  async function loadAll(w: number) {
    setLoading(true);

    // 1) Board (lines)
    const { data: b } = await supabase.rpc('get_week_draft_board', { p_year: YEAR, p_week: w });
    const boardRows: BoardRow[] = (Array.isArray(b) ? b : []).map((r: any) => ({
      home: String(r.home),
      away: String(r.away),
      spread: r.spread == null ? null : Number(r.spread),
      total: r.total == null ? null : Number(r.total),
    }));
    setBoard(boardRows);
    onScreenPairsRef.current = new Set(boardRows.map(r => `${r.home}-${r.away}`));

    // 2) Picks done so far
    const { data: sp } = await supabase
      .from('v_pick_results') // view that includes player_display_name; falls back to 'picks' if needed
      .select('id,season_year,week_number,pick_number,player_display_name,team_short,home_short,away_short,spread_at_pick')
      .eq('season_year', YEAR)
      .eq('week_number', w)
      .order('pick_number', { ascending: true });

    setPicks((Array.isArray(sp) ? sp : []) as PickRow[]);

    // 3) O/U taken so far
    const { data: ou } = await supabase
      .from('v_ou_results') // view that includes player_display_name; falls back to 'ou_picks' if needed
      .select('id,season_year,week_number,player_display_name,home_short,away_short,pick_side,total_at_pick')
      .eq('season_year', YEAR)
      .eq('week_number', w);

    setOuPicks((Array.isArray(ou) ? ou : []) as OuPickRow[]);

    setLoading(false);
  }

  useEffect(() => { loadAll(week); }, [week]);

  // realtime: picks
  useEffect(() => {
    const ch = supabase
      .channel('draft-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' },
        payload => {
          const row = payload.new as any;
          if (!row || row.season_year !== YEAR || row.week_number !== week) return;
          setPicks(prev => {
            const existing = prev.find(p => p.id === row.id);
            const mapped: PickRow = {
              id: row.id,
              season_year: row.season_year,
              week_number: row.week_number,
              pick_number: row.pick_number,
              player_display_name: row.player_display_name ?? row.player_name ?? '', // view may populate this
              team_short: row.team_short,
              home_short: row.home_short,
              away_short: row.away_short,
              spread_at_pick: row.spread_at_pick,
            };
            if (existing) return prev.map(p => p.id === row.id ? mapped : p);
            return [...prev, mapped].sort((a,b)=>a.pick_number-b.pick_number);
          });
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ou_picks' },
        payload => {
          const row = payload.new as any;
          if (!row || row.season_year !== YEAR || row.week_number !== week) return;
          setOuPicks(prev => {
            const mapped: OuPickRow = {
              id: row.id,
              season_year: row.season_year,
              week_number: row.week_number,
              player_display_name: row.player_display_name ?? row.player_name ?? '',
              home_short: row.home_short,
              away_short: row.away_short,
              pick_side: row.pick_side,
              total_at_pick: row.total_at_pick,
            };
            const existing = prev.find(x => x.id === row.id);
            if (existing) return prev.map(x => x.id === row.id ? mapped : x);
            return [...prev, mapped];
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [week]);

  async function makeSpreadPick(team: string, pair: { home: string; away: string }) {
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

  const playerHasOu = useMemo(() => {
    const s = new Set(ouPicks.map(o => o.player_display_name));
    return s;
  }, [ouPicks]);

  const atp = { // picks remaining per player (for a small indicator)
    'Big Dawg': 3 - picks.filter(p => p.player_display_name === 'Big Dawg').length,
    'Pud': 3 - picks.filter(p => p.player_display_name === 'Pud').length,
    'Kinish': 3 - picks.filter(p => p.player_display_name === 'Kinish').length,
  } as Record<string, number>;

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

      {/* Board (current market from game_lines) */}
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
          {board.map((r, i) => (
            <div key={`${r.home}-${r.away}-${i}`} className="grid grid-cols-12 px-3 py-2 border-t border-zinc-800 text-sm">
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
                {name} ({Math.max(0, atp[name] ?? 0)} left)
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
                        onClick={() => makeSpreadPick(g.home, { home: g.home, away: g.away })}
                      >
                        Pick {g.home}
                      </button>
                      <button
                        className="px-2 py-1 border rounded hover:bg-zinc-800 disabled:opacity-50"
                        disabled={taken || making}
                        onClick={() => makeSpreadPick(g.away, { home: g.home, away: g.away })}
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
            {PLAYERS.map(name => {
              const already = playerHasOu.has(name);
              const meOnClock =
                (already ? null : name) ===
                (['Big Dawg','Pud','Kinish'].find(n => !playerHasOu.has(n)) ?? null);

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
