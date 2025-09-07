'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/** ========== CONFIG ========= */
const YEAR = 2025;
// If your games RPC has a different name, change it here:
const GAMES_FN = 'get_week_games_with_status' as const;
/** =========================== */

/* ---------- Types ---------- */

type SpreadPickRow = {
  pick_id: number;
  player_name: string;
  pick_number: number;
  game: string;        // "PHI v DAL"
  team_short: string;  // "PHI"
  spread: number;      // -8, +1.5, …
  result?: 'win' | 'loss' | 'push' | 'pending';
};

type OUPickRow = {
  id: number;
  player_name: string;
  game: string;              // "PHI v DAL"
  pick: 'OVER' | 'UNDER';
  total: number;             // 47.5, …
  result?: 'win' | 'loss' | 'push' | 'pending';
};

type WeekOption = { week_number: number };

type GameRow = {
  game_id: number;
  home_short: string;
  away_short: string;
  home_spread: number | null;
  away_spread: number | null;
  home_logo_url?: string | null;
  away_logo_url?: string | null;

  // live fields (nullable if not started)
  live_home_score?: number | null;
  live_away_score?: number | null;
  is_live?: boolean | null;
  is_final?: boolean | null;
  kickoff?: string | null;
};

/* ------- Small helpers ------- */

function fmtSpread(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

function Badge({ result }: { result?: string }) {
  if (!result) return null;
  const cls =
    result === 'win'
      ? 'text-green-400'
      : result === 'loss'
      ? 'text-red-400'
      : result === 'push'
      ? 'text-orange-400'
      : 'text-gray-400';
  return <span className={`ml-2 ${cls}`}>{result}</span>;
}

function ScoreCell({
  home,
  away,
  isLive,
  isFinal,
}: {
  home: number | null;
  away: number | null;
  isLive?: boolean | null;
  isFinal?: boolean | null;
}) {
  const label =
    isFinal ? 'FT' : isLive ? 'LIVE' : home === null && away === null ? '—' : '';

  return (
    <span className="tabular-nums">
      {home ?? '—'} <span className="opacity-60">–</span> {away ?? '—'}
      {label ? <span className="ml-2 text-xs opacity-70">{label}</span> : null}
    </span>
  );
}

/* =================== PAGE =================== */

export default function ScoreboardPage() {
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // picks
  const [spreadByPlayer, setSpreadByPlayer] = useState<
    Record<string, SpreadPickRow[]>
  >({});
  const [ouRows, setOuRows] = useState<OUPickRow[]>([]);

  // scoreboard
  const [showFull, setShowFull] = useState<boolean>(false);
  const [games, setGames] = useState<GameRow[]>([]);

  // handy set of loaded game ids (for realtime filtering)
  const gameIdSet = useMemo(() => new Set(games.map((g) => g.game_id)), [games]);

  /* -------- Load weeks once -------- */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
      if (data && Array.isArray(data)) {
        setWeeks((data as WeekOption[]).map((w) => w.week_number));
      } else {
        setWeeks(Array.from({ length: 18 }, (_, i) => i + 1));
      }
    })();
  }, []);

  /* -------- Load picks + (optional) games -------- */
  async function loadData(w: number, includeGames: boolean) {
    setLoading(true);

    const spreadPromise = supabase.rpc('get_week_spread_picks_admin', {
      p_year: YEAR,
      p_week: w,
    });

    const ouPromise = supabase.rpc('get_week_ou_picks_admin', {
      p_year: YEAR,
      p_week: w,
    });

    const [spRes, ouRes] = await Promise.all([spreadPromise, ouPromise]);

    // group spread picks by player
    const grouped: Record<string, SpreadPickRow[]> = {};
    const spreadRows = (spRes.data as SpreadPickRow[] | null) ?? [];
    spreadRows.forEach((r) => {
      (grouped[r.player_name] ??= []).push(r);
    });
    // keep each player’s picks in draft order
    Object.values(grouped).forEach((arr) =>
      arr.sort((a, b) => a.pick_number - b.pick_number),
    );

    setSpreadByPlayer(grouped);
    setOuRows(((ouRes.data as OUPickRow[] | null) ?? []).slice());

    if (includeGames) {
      const { data: gameData } = await supabase.rpc(GAMES_FN, {
        p_year: YEAR,
        p_week: w,
      });
      setGames(((gameData as GameRow[] | null) ?? []).slice());
    } else {
      setGames([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData(week, showFull);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, showFull]);

// -------- Realtime live-score updates --------
useEffect(() => {
  if (!showFull || games.length === 0) return;

  type GameUpdateRow = Partial<{
    id: number;
    live_home_score: number | null;
    live_away_score: number | null;
    is_live: boolean | null;
    is_final: boolean | null;
  }>;

  const channel = supabase
    .channel('live-scores')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games' },
      (payload) => {
        // payload.new can be {} | Row — so narrow it
        const row = payload.new as GameUpdateRow;
        const id = row?.id;

        if (typeof id !== 'number' || !gameIdSet.has(id)) return;

        setGames((prev) =>
          prev.map((g) =>
            g.game_id === id
              ? {
                  ...g,
                  live_home_score:
                    row.live_home_score ?? g.live_home_score ?? null,
                  live_away_score:
                    row.live_away_score ?? g.live_away_score ?? null,
                  is_live:
                    row.is_live ?? (g.is_live ?? null),
                  is_final:
                    row.is_final ?? (g.is_final ?? null),
                }
              : g,
          ),
        );
      },
    );

  channel.subscribe();
  return () => {
    channel.unsubscribe();
  };
}, [showFull, gameIdSet, games.length]);


  /* ============ RENDER ============ */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Week {week} Scoreboard</h1>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-sm">Week</label>
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

          <label className="text-sm flex items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={showFull}
              onChange={(e) => setShowFull(e.target.checked)}
            />
            Show full scoreboard
          </label>
        </div>
      </div>

      {/* Picks */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Picks</h2>

        {loading && Object.keys(spreadByPlayer).length === 0 ? (
          <div className="text-sm opacity-70">Loading…</div>
        ) : null}

        {Object.entries(spreadByPlayer).map(([player, rows]) => (
          <div key={player} className="border rounded p-4">
            <div className="font-semibold mb-2">{player}</div>

            {rows.length === 0 ? (
              <div className="text-sm opacity-70">No picks</div>
            ) : (
              <ul className="space-y-1">
                {rows.map((r) => (
                  <li
                    key={r.pick_id}
                    className="flex items-center justify-between"
                  >
                    <span>
                      {r.team_short}{' '}
                      <span className="opacity-70">({r.game})</span>
                    </span>
                    <span className="tabular-nums">
                      {fmtSpread(r.spread)}
                      <Badge result={r.result} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {Object.keys(spreadByPlayer).length === 0 && !loading && (
          <div className="text-sm opacity-70">No picks found for this week.</div>
        )}
      </section>

      {/* O/U */}
      <section className="space-y-3 mt-6">
        <h2 className="text-xl font-semibold">O/U Tie-breakers</h2>

        {ouRows.length === 0 ? (
          <>
            <div className="border rounded p-3 text-right text-sm opacity-70">
              pending
            </div>
            <div className="border rounded p-3 text-right text-sm opacity-70">
              pending
            </div>
            <div className="border rounded p-3 text-right text-sm opacity-70">
              pending
            </div>
          </>
        ) : (
          ouRows.map((r) => (
            <div
              key={r.id}
              className="border rounded p-3 flex items-center justify-between"
            >
              <div>
                <div className="font-medium">{r.player_name}</div>
                <div className="opacity-70 text-sm">{r.game}</div>
              </div>
              <div className="tabular-nums">
                {r.pick} {r.total}
                <Badge result={r.result} />
              </div>
            </div>
          ))
        )}
      </section>

      {/* Full scoreboard (optional) */}
      {showFull && (
        <section className="space-y-2 mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">All Games</h2>
            <div className="text-sm opacity-70">
              Live scores update automatically.
            </div>
          </div>

          {games.map((g) => {
            const homeDisplay = g.live_home_score ?? null;
            const awayDisplay = g.live_away_score ?? null;
            const isLive = g.is_live ?? false;
            const isFinal = g.is_final ?? false;

            return (
              <div
                key={g.game_id}
                className="border rounded px-3 py-2 grid grid-cols-7 gap-2 items-center"
              >
                {/* left: home */}
                <div className="col-span-3 flex items-center gap-2">
                  {/* Using <img> keeps us from configuring next/image remote domains */}
                  <img
                    src={g.home_logo_url ?? ''}
                    alt={g.home_short}
                    className="h-5 w-5 object-contain"
                  />
                  <span className="font-medium">{g.home_short}</span>
                  <span className="text-xs opacity-70">
                    {fmtSpread(g.home_spread)}
                  </span>
                </div>

                {/* center: score */}
                <div className="col-span-1 text-center">
                  <ScoreCell
                    home={homeDisplay}
                    away={awayDisplay}
                    isLive={isLive}
                    isFinal={isFinal}
                  />
                </div>

                {/* right: away */}
                <div className="col-span-3 flex items-center justify-end gap-2">
                  <span className="text-xs opacity-70">
                    {fmtSpread(g.away_spread)}
                  </span>
                  <span className="font-medium">{g.away_short}</span>
                  <img
                    src={g.away_logo_url ?? ''}
                    alt={g.away_short}
                    className="h-5 w-5 object-contain"
                  />
                </div>
              </div>
            );
          })}

          {games.length === 0 && !loading && (
            <div className="text-sm opacity-70">No games found.</div>
          )}
        </section>
      )}

      {/* Footer links */}
      <div className="pt-4 text-sm opacity-70 space-x-4">
        <Link href="/draft" className="underline">
          Draft
        </Link>
        <span>•</span>
        <Link href="/standings" className="underline">
          Standings
        </Link>
        <span>•</span>
        <Link href="/admin" className="underline">
          Admin
        </Link>
      </div>
    </div>
  );
}
