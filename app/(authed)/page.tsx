'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;

/* ----------------------------- helper hooks ----------------------------- */

function useFlashOnChange<T>(value: T, ms = 900) {
  const [flash, setFlash] = useState(false);
  const prev = useRef<T>(value);
  useEffect(() => {
    if (prev.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), ms);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value, ms]);
  return flash;
}

function fmtSpread(n: number | null | undefined) {
  if (n === null || n === undefined) return '';
  if (Number.isNaN(n)) return '';
  return n > 0 ? `+${n}` : `${n}`;
}

/* ------------------------------- data types ------------------------------ */

type WeekOption = { week_number: number };

type GameRow = {
  game_id: number;
  home: string;            // short name, e.g., PHI
  away: string;            // short name, e.g., DAL
  home_spread: number | null;
  away_spread: number | null;

  // finals (if already set)
  home_score: number | null;
  away_score: number | null;

  // live fields (from cron)
  live_home_score?: number | null;
  live_away_score?: number | null;
  live_completed?: boolean | null;
  live_updated_at?: string | null;

  // logos
  home_logo_url?: string | null;
  away_logo_url?: string | null;
};

/* ------------------------------ score cell ------------------------------ */

function ScoreCell({
  home,
  away,
  isLive,
}: {
  home: number | null;
  away: number | null;
  isLive: boolean;
}) {
  const display = `${home ?? '—'}-${away ?? '—'}`;
  const flash = useFlashOnChange(display);

  return (
    <div className="flex items-center gap-2">
      <span
        className={`px-2 py-0.5 rounded text-sm ${
          flash ? 'animate-pulse bg-yellow-300/20' : ''
        }`}
      >
        {home ?? '—'}–{away ?? '—'}
      </span>
      {isLive && <span className="text-xs font-semibold text-red-500">LIVE</span>}
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

export default function HomePage() {
  const [weeks, setWeeks] = useState<number[]>([]);
  const [week, setWeek] = useState<number>(1);
  const [rows, setRows] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWeeks = useCallback(async () => {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    if (data && Array.isArray(data)) {
      setWeeks((data as WeekOption[]).map((w) => w.week_number));
    } else {
      // fallback 1..18 if RPC is unavailable
      setWeeks(Array.from({ length: 18 }, (_, i) => i + 1));
    }
  }, []);

  const loadData = useCallback(
    async (w: number) => {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_week_games_with_status', {
        p_year: YEAR,
        p_week: w,
      });
      if (!error && data && Array.isArray(data)) {
        // map defensively in case column names differ slightly
        const mapped = (data as unknown as Record<string, unknown>[]).map((d) => {
          const num = (v: unknown): number | null =>
            typeof v === 'number' && Number.isFinite(v) ? v : null;
          const str = (v: unknown): string =>
            typeof v === 'string' ? v : '';

          const game_id = (d['game_id'] as number) ?? (d['id'] as number);
          const home = str(d['home'] ?? d['home_short'] ?? d['home_team'] ?? d['h']);
          const away = str(d['away'] ?? d['away_short'] ?? d['away_team'] ?? d['a']);
          const home_spread = num(d['home_spread'] ?? null);
          const away_spread = num(d['away_spread'] ?? null);
          const home_score = num(d['home_score'] ?? null);
          const away_score = num(d['away_score'] ?? null);
          const live_home_score = num(d['live_home_score'] ?? null);
          const live_away_score = num(d['live_away_score'] ?? null);
          const live_completed =
            typeof d['live_completed'] === 'boolean' ? (d['live_completed'] as boolean) : null;
          const home_logo_url = str(d['home_logo_url'] ?? d['home_logo'] ?? '');
          const away_logo_url = str(d['away_logo_url'] ?? d['away_logo'] ?? '');

          return {
            game_id,
            home,
            away,
            home_spread,
            away_spread,
            home_score,
            away_score,
            live_home_score,
            live_away_score,
            live_completed,
            home_logo_url: home_logo_url || undefined,
            away_logo_url: away_logo_url || undefined,
          } as GameRow;
        });
        setRows(mapped);
      }
      setLoading(false);
    },
    []
  );

  // initial loads
  useEffect(() => { void loadWeeks(); }, [loadWeeks]);
  useEffect(() => { void loadData(week); }, [loadData, week]);

  // realtime subscription for live score updates
  useEffect(() => {
    const ch = supabase
      .channel('games-live')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games' },
        (payload) => {
          const g = payload.new as {
            id: number;
            live_home_score: number | null;
            live_away_score: number | null;
            live_completed: boolean | null;
            live_updated_at: string | null;
          };
          setRows((prev) =>
            prev.map((r) =>
              r.game_id === g.id
                ? {
                    ...r,
                    live_home_score: g.live_home_score,
                    live_away_score: g.live_away_score,
                    live_completed: g.live_completed,
                  }
                : r
            )
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const title = useMemo(() => `Week ${week} Scoreboard`, [week]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link className="underline" href="/draft">Draft</Link>
          <span className="opacity-50">•</span>
          <Link className="underline" href="/standings">Standings</Link>
          <span className="opacity-50">•</span>
          <Link className="underline" href="/admin">Admin</Link>
        </div>
      </header>

      <div className="flex items-center gap-3">
        <label className="text-sm">Week</label>
        <select
          className="border rounded bg-transparent p-1"
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

      {loading ? (
        <div className="text-sm text-gray-400">Loading games…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-400">No games found.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const isLive =
              r.live_home_score !== null &&
              r.live_home_score !== undefined &&
              r.live_away_score !== null &&
              r.live_away_score !== undefined &&
              !r.live_completed;

            const homeDisplay = isLive ? r.live_home_score : r.home_score;
            const awayDisplay = isLive ? r.live_away_score : r.away_score;

            return (
              <div
                key={r.game_id}
                className="rounded border p-3 flex items-center justify-between gap-3"
              >
                {/* left: home */}
                <div className="flex items-center gap-2 w-32">
                  {r.home_logo_url ? (
                    <Image
                      src={r.home_logo_url}
                      alt={r.home}
                      width={20}
                      height={20}
                      className="rounded-sm"
                    />
                  ) : null}
                  <div className="font-medium">{r.home}</div>
                  <div className="text-xs ml-1 text-green-500">{fmtSpread(r.home_spread)}</div>
                </div>

                {/* middle: vs + score */}
                <div className="flex items-center gap-4">
                  <span className="text-sm opacity-70">v</span>
                  <ScoreCell home={homeDisplay} away={awayDisplay} isLive={Boolean(isLive)} />
                </div>

                {/* right: away */}
                <div className="flex items-center gap-2 w-32 justify-end">
                  <div className="text-xs mr-1 text-red-400">{fmtSpread(r.away_spread)}</div>
                  <div className="font-medium">{r.away}</div>
                  {r.away_logo_url ? (
                    <Image
                      src={r.away_logo_url}
                      alt={r.away}
                      width={20}
                      height={20}
                      className="rounded-sm"
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
