'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type WeekOption = { week_number: number };

type SpreadPickRow = {
  pick_number: number;
  player_name: string;    // "Big Dawg" | "Pud" | "Kinish"
  team: string;           // "PHI"
  matchup: string;        // "PHI v DAL"
  spread: number;         // -8, 1.5, etc.
  result: 'win' | 'loss' | 'push' | 'pending' | null;
};

type OUPickRow = {
  player_name: string;    // "Big Dawg" | "Pud" | "Kinish"
  matchup: string;        // "CLE v CIN"
  side: 'OVER' | 'UNDER';
  total: number;          // 48, 44, ...
  result: 'win' | 'loss' | 'push' | 'pending' | null;
};

type GameRow = {
  game_id: number;
  home: string;           // "PHI"
  away: string;           // "DAL"
  home_spread: number | null;
  away_spread: number | null;

  // optional fields coming from our function/view
  home_logo_url?: string | null;
  away_logo_url?: string | null;

  // live score info
  live_home_score?: number | null;
  live_away_score?: number | null;
  is_live?: boolean | null;

  // final score (if completed)
  home_score?: number | null;
  away_score?: number | null;
  completed?: boolean | null;
};

const YEAR = 2025;

function fmtSpread(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  if (n > 0) return `+${n}`;
  return `${n}`;
}

function resultClass(r: SpreadPickRow['result'] | OUPickRow['result']) {
  switch (r) {
    case 'win':
      return 'text-green-400';
    case 'loss':
      return 'text-red-400';
    case 'push':
      return 'text-orange-400';
    default:
      return 'opacity-60';
  }
}

export default function HomeScoreboard() {
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [spreadPicks, setSpreadPicks] = useState<SpreadPickRow[]>([]);
  const [ouPicks, setOUPicks] = useState<OUPickRow[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFullBoard, setShowFullBoard] = useState(false); // default to "picks-only"
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // load available weeks (from seasons/weeks)
  async function loadWeeks() {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    if (data && Array.isArray(data)) {
      setWeeks((data as WeekOption[]).map((w) => w.week_number));
    } else {
      setWeeks(Array.from({ length: 18 }, (_, i) => i + 1));
    }
  }

  // read-only admin RPCs we already created; perfect to show the picks summary
  async function loadSpreadPicks() {
    const { data, error } = await supabase.rpc('get_week_spread_picks_admin', {
      p_year: YEAR,
      p_week: week,
    });
    if (!error && data) setSpreadPicks(data as SpreadPickRow[]);
  }

  async function loadOUPicks() {
    const { data, error } = await supabase.rpc('get_week_ou_picks_admin', {
      p_year: YEAR,
      p_week: week,
    });
    if (!error && data) setOUPicks(data as OUPickRow[]);
  }

  // scoreboard rows (with live + final if present)
  async function loadGames() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_week_games_with_status', {
      p_year: YEAR,
      p_week: week,
    });
    if (!error && data) setGames(data as GameRow[]);
    setLoading(false);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadWeeks();
  }, []);

  useEffect(() => {
    loadSpreadPicks();
    loadOUPicks();
    loadGames();
  }, [week]);

  // group spread picks by player for the 3 nice cards
  const byPlayer = useMemo(() => {
    const names = ['Big Dawg', 'Pud', 'Kinish'];
    const out: Record<string, SpreadPickRow[]> = {};
    for (const n of names) out[n] = [];
    for (const r of spreadPicks) {
      (out[r.player_name] ||= []).push(r);
    }
    // keep “pick_number” order
    for (const n of names) out[n].sort((a, b) => a.pick_number - b.pick_number);
    return out as Record<'Big Dawg' | 'Pud' | 'Kinish', SpreadPickRow[]>;
  }, [spreadPicks]);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-8">
      {/* Header (single nav comes from (authed)/layout.tsx) */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Week {week} Scoreboard</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm">Week</label>
          <select
            className="border rounded bg-transparent px-2 py-1"
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10))}
          >
            {weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
          <label className="ml-4 text-sm flex items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={showFullBoard}
              onChange={(e) => setShowFullBoard(e.target.checked)}
            />
            Show full scoreboard
          </label>
        </div>
      </div>

      {/* PICKS GROUPED BY PLAYER */}
      <section>
        <h2 className="text-xl font-semibold mb-3">Picks</h2>

        {(['Big Dawg', 'Pud', 'Kinish'] as const).map((name) => (
          <div key={name} className="border rounded p-4 mb-4">
            <div className="text-lg font-medium mb-3">{name}</div>
            <div className="space-y-3">
              {byPlayer[name]?.map((r) => (
                <div key={`${name}-${r.pick_number}-${r.team}`} className="flex items-center justify-between">
                  {/* left: team + matchup */}
                  <div className="flex items-center gap-2">
                    {/* tiny crest via team logos if present on games join; fallback to emoji-less */}
                    {/* We don’t have the logo URL in this RPC; leave icon out here. */}
                    <span className="w-6 text-sm">{r.team}</span>
                    <span className="opacity-70">({r.matchup})</span>
                  </div>

                  {/* right: spread + result */}
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums w-10 text-right">{fmtSpread(r.spread)}</span>
                    <span className={resultClass(r.result)}>{r.result ?? 'pending'}</span>
                  </div>
                </div>
              ))}

              {(!byPlayer[name] || byPlayer[name].length === 0) && (
                <div className="opacity-60 text-sm">No picks</div>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* O/U TIE-BREAKERS */}
      <section>
        <h2 className="text-xl font-semibold mb-3">O/U Tie-breakers</h2>
        <div className="space-y-3">
          {ouPicks.map((r, idx) => (
            <div key={`${r.player_name}-${idx}`} className="border rounded p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-28">{r.player_name}</div>
                  <div className="opacity-80">{r.matchup}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 text-right">{r.side}</div>
                  <div className="w-10 tabular-nums text-right">{r.total}</div>
                  <div className={resultClass(r.result)}>{r.result ?? 'pending'}</div>
                </div>
              </div>
            </div>
          ))}

          {ouPicks.length === 0 && <div className="opacity-60 text-sm">No O/U picks this week</div>}
        </div>
      </section>

      {/* FULL SCOREBOARD (toggle) */}
      {showFullBoard && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold mb-2">Games</h2>

          {loading ? (
            <div className="opacity-60 text-sm">Loading…</div>
          ) : (
            <div className="space-y-2">
              {games.map((g) => {
                const live = g.is_live && (g.live_home_score != null || g.live_away_score != null);
                const homeScore =
                  (live ? g.live_home_score : g.home_score) ?? null;
                const awayScore =
                  (live ? g.live_away_score : g.away_score) ?? null;

                return (
                  <div key={g.game_id} className="border rounded p-2">
                    <div className="grid grid-cols-3 items-center">
                      {/* home */}
                      <div className="flex items-center gap-2">
                        {g.home_logo_url ? (
                          <img
                            src={g.home_logo_url}
                            alt={g.home}
                            width={18}
                            height={18}
                            className="rounded-sm"
                          />
                        ) : null}
                        <span className="w-10">{g.home}</span>
                        <span className="text-sm opacity-70">{fmtSpread(g.home_spread)}</span>
                      </div>

                      {/* score */}
                      <div className="text-center tabular-nums">
                        {homeScore !== null && awayScore !== null ? (
                          <span className={live ? 'animate-pulse' : ''}>
                            {homeScore} <span className="opacity-60">v</span> {awayScore}
                          </span>
                        ) : (
                          <span className="opacity-50">v</span>
                        )}
                      </div>

                      {/* away */}
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-sm opacity-70">{fmtSpread(g.away_spread)}</span>
                        <span className="w-10 text-right">{g.away}</span>
                        {g.away_logo_url ? (
                          <img
                            src={g.away_logo_url}
                            alt={g.away}
                            width={18}
                            height={18}
                            className="rounded-sm"
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-xs opacity-60">
            {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : null}
          </div>
        </section>
      )}
    </div>
  );
}
