'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

const YEAR = 2025;
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;
const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

type WeekRow = { week_number: number };

type DraftBoardRpcRow = {
  home_short?: unknown;
  away_short?: unknown;
  fav_short?: unknown; // some DBs
  fav?: unknown;       // others
  spread?: unknown;    // number, home-line convention
  total?: unknown;
};

type BoardRow = {
  home: string;
  away: string;
  fav: string | null;        // short of favourite
  spread: number | null;
  total: number | null;
};

type PickTableRow = {
  id: number;
  season_year: number;
  week_number: number;
  pick_number: number;
  player_display_name: string;
  home_short: string;
  away_short: string;
  team_short: string;
  spread_at_pick: number | null;
  total_at_pick: number | null;
  created_at: string;
};

function teamLogo(short?: string | null) {
  if (!short) return null;
  return LOGO_BASE ? `${LOGO_BASE}/${short}.png` : `/teams/${short}.png`;
}

function spreadText(n: number | null | undefined) {
  if (n == null) return '—';
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return "Pick'em";
  return x > 0 ? `+${x}` : `${x}`;
}

function asNum(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function asStr(x: unknown): string {
  return typeof x === 'string' ? x : x == null ? '' : String(x);
}

function TinyLogo({ s, alt }: { s: string | null; alt: string }) {
  if (!s) return <span className="inline-block w-4 h-4 align-middle" />;
  return (
    <img
      alt={alt}
      src={s}
      className="inline-block w-4 h-4 align-middle rounded-sm"
      loading="eager"
    />
  );
}

export default function DraftPage() {
  const [week, setWeek] = useState<number>(2);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [picks, setPicks] = useState<PickTableRow[]>([]);
  const [onClockIdx, setOnClockIdx] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
      const rows: WeekRow[] = Array.isArray(data)
        ? (data as unknown[]).flatMap((r) =>
            typeof (r as any)?.week_number === 'number'
              ? [{ week_number: (r as any).week_number as number }]
              : []
          )
        : [];
      setWeeks(rows.length ? rows.map((r) => r.week_number) : Array.from({ length: 18 }, (_, i) => i + 1));
    })();
  }, []);

  const loadBoard = async (w: number) => {
    const { data } = await supabase.rpc('get_week_draft_board', {
      p_year: YEAR,
      p_week: w,
    });

    const rows = Array.isArray(data) ? (data as DraftBoardRpcRow[]) : [];

    const mapped: BoardRow[] = rows.map((r) => {
      const home = asStr(r.home_short);
      const away = asStr(r.away_short);
      const spread = asNum(r.spread);
      const total = asNum(r.total);

      // 1) use fav field if present
      let fav =
        typeof r.fav_short === 'string'
          ? (r.fav_short as string)
          : typeof r.fav === 'string'
          ? (r.fav as string)
          : null;

      // 2) derive from spread sign if missing
      if (!fav && spread != null) {
        if (spread < 0) fav = home;       // home-line negative => home fav
        else if (spread > 0) fav = away;  // home-line positive => away fav
        else fav = null;                   // pick'em
      }

      return { home, away, fav, spread, total };
    });

    setBoard(mapped);
  };

  const loadPicks = async (w: number) => {
    const { data } = await supabase
      .from('picks')
      .select(
        'id,season_year,week_number,pick_number,player_display_name,home_short,away_short,team_short,spread_at_pick,total_at_pick,created_at'
      )
      .eq('season_year', YEAR)
      .eq('week_number', w)
      .order('pick_number', { ascending: true });

    const arr = Array.isArray(data) ? (data as PickTableRow[]) : [];
    setPicks(arr);
    setOnClockIdx(arr.length % PLAYERS.length);
  };

  useEffect(() => {
    loadBoard(week);
    loadPicks(week);
  }, [week]);

  useEffect(() => {
    const channel = supabase
      .channel('draft-picks')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'picks' },
        (payload: RealtimePostgresChangesPayload<PickTableRow>) => {
          const row = payload.new;
          if (!row || row.season_year !== YEAR || row.week_number !== week) return;
          setPicks((prev) => {
            const byId = new Map(prev.map((p) => [p.id, p]));
            byId.set(row.id, row);
            return Array.from(byId.values()).sort((a, b) => a.pick_number - b.pick_number);
          });
          setOnClockIdx((i) => (i + 1) % PLAYERS.length);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [week]);

  const currentPlayer = PLAYERS[onClockIdx] || PLAYERS[0];

  const onPickTeam = async (home: string, away: string, team: string) => {
    const row = board.find((g) => g.home === home && g.away === away);
    const spread = row?.spread ?? null;
    const total = row?.total ?? null;

    await supabase.rpc('make_spread_pick', {
      p_year: YEAR,
      p_week: week,
      p_player: currentPlayer,
      p_home_short: home,
      p_away_short: away,
      p_team_short: team,
      p_spread_at_pick: spread,
      p_total_at_pick: total,
    });
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Draft Board</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm opacity-70 mr-1">Week</label>
          <select
            className="border rounded p-1 bg-transparent"
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10))}
          >
            {weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </div>
      </header>

      <section>
        <p className="text-xs opacity-70 mb-2">
          Showing <em>current market</em> numbers from <code>game_lines</code>. Picks store the line at pick-time.
        </p>

        <div className="border rounded overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] px-3 py-2 text-xs uppercase tracking-wider opacity-70">
            <div>Game</div>
            <div className="text-right">Spread</div>
            <div className="text-right">Total</div>
          </div>
          <div className="divide-y">
            {board.map((r) => (
              <div key={`${r.home}-${r.away}`} className="grid grid-cols-[1fr_auto_auto] items-center px-3 py-2">
                <div className="flex items-center gap-2">
                  <TinyLogo s={teamLogo(r.home)} alt={r.home} />
                  <span className={`w-10 ${r.fav === r.home ? 'font-semibold' : ''}`}>{r.home}</span>
                  {r.fav === r.home && (
                    <>
                      <span className="text-amber-400 ml-1">★</span>
                      <span className="ml-1 text-xs opacity-60">(fav)</span>
                    </>
                  )}
                  <span className="mx-1 opacity-60">v</span>
                  <TinyLogo s={teamLogo(r.away)} alt={r.away} />
                  <span className={`w-10 ${r.fav === r.away ? 'font-semibold' : ''}`}>{r.away}</span>
                  {r.fav === r.away && (
                    <>
                      <span className="text-amber-400 ml-1">★</span>
                      <span className="ml-1 text-xs opacity-60">(fav)</span>
                    </>
                  )}
                </div>

                <div className="text-right tabular-nums">{spreadText(r.spread)}</div>
                <div className="text-right tabular-nums">{r.total == null ? '—' : r.total}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Live Draft</h2>
          <div className="text-sm opacity-70">
            {PLAYERS.map((p, i) => {
              const remaining = 9 - picks.filter((x) => x.player_display_name === p).length;
              return (
                <span key={p} className={i ? 'ml-3' : ''}>
                  {p} ({remaining} left)
                </span>
              );
            })}
          </div>
        </div>

        <div className="text-sm">
          On the clock: <span className="font-semibold">{currentPlayer}</span>{' '}
          <span className="opacity-70">Pick #{picks.length + 1}</span>
        </div>

        <div className="border rounded">
          <div className="px-3 py-2 text-sm opacity-70 border-b">Picks</div>
          {picks.length === 0 ? (
            <div className="px-3 py-2 text-sm opacity-60">No picks yet.</div>
          ) : (
            <div className="divide-y">
              {picks.map((p) => (
                <div key={p.id} className="px-3 py-2 text-sm flex items-center gap-2">
                  <span className="opacity-60">#{p.pick_number}</span>
                  <span className="font-medium">{p.player_display_name}</span>
                  <span className="opacity-60">picked</span>
                  <TinyLogo s={teamLogo(p.team_short)} alt={p.team_short} />
                  <span className="font-medium">{p.team_short}</span>
                  <span className="opacity-60">
                    ({p.home_short} v {p.away_short})
                  </span>
                  <span className="ml-auto opacity-70 tabular-nums">
                    {spreadText(p.spread_at_pick)} / {p.total_at_pick == null ? '—' : p.total_at_pick}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {board.map((g) => (
            <div key={`${g.home}-${g.away}`} className="border rounded p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <TinyLogo s={teamLogo(g.home)} alt={g.home} />
                <span className={`w-10 ${g.fav === g.home ? 'font-semibold' : ''}`}>{g.home}</span>
                {g.fav === g.home && (
                  <>
                    <span className="text-amber-400 ml-1">★</span>
                    <span className="ml-1 text-xs opacity-60">(fav)</span>
                  </>
                )}
                <span className="mx-1 opacity-60">v</span>
                <TinyLogo s={teamLogo(g.away)} alt={g.away} />
                <span className={`w-10 ${g.fav === g.away ? 'font-semibold' : ''}`}>{g.away}</span>
                {g.fav === g.away && (
                  <>
                    <span className="text-amber-400 ml-1">★</span>
                    <span className="ml-1 text-xs opacity-60">(fav)</span>
                  </>
                )}
                <span className="ml-auto text-xs opacity-70 tabular-nums">
                  ({spreadText(g.spread)} / {g.total == null ? '—' : g.total})
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1 text-sm border rounded hover:bg-white/5"
                  onClick={() => onPickTeam(g.home, g.away, g.home)}
                >
                  Pick {g.home}
                </button>
                <button
                  className="px-3 py-1 text-sm border rounded hover:bg-white/5"
                  onClick={() => onPickTeam(g.home, g.away, g.away)}
                >
                  Pick {g.away}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
