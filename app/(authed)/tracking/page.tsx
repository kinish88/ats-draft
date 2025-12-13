'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type AiPick = {
  id: number;
  season_year: number;
  week_number: number;
  game_id: number;
  pick_type: 'spread' | 'ou';
  home_short: string | null;
  away_short: string | null;
  team_short: string | null;
  ou_side: string | null;
  line_or_total: number | null;
  recommendation: string | null;
};

type GameRow = {
  id: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  live_home_score: number | null;
  live_away_score: number | null;
  is_final: boolean | null;
  is_live: boolean | null;
};

type Outcome = 'W' | 'L' | 'P' | '—';

const YEAR = 2025;

function toShort(value?: string | null) {
  return (value ?? '').trim().toUpperCase();
}

function scoreSnapshot(game?: GameRow | null) {
  if (!game) return { home: null, away: null, text: '—' };
  const hasFinal = game.home_score != null && game.away_score != null;
  const hasLive = game.live_home_score != null && game.live_away_score != null;
  const home = hasFinal ? game.home_score : hasLive ? game.live_home_score : null;
  const away = hasFinal ? game.away_score : hasLive ? game.live_away_score : null;
  if (home == null || away == null) return { home, away, text: '—' };
  return { home, away, text: `${home}–${away}` };
}

function computeOutcome(pick: AiPick, game?: GameRow | null): Outcome {
  const score = scoreSnapshot(game);
  if (score.home == null || score.away == null || pick.line_or_total == null) return '—';

  if (pick.pick_type === 'spread') {
    const team = toShort(pick.team_short ?? pick.recommendation);
    const home = toShort(pick.home_short ?? game?.home);
    const away = toShort(pick.away_short ?? game?.away);
    const isHome = team && team === home;
    const isAway = team && team === away;
    if (!isHome && !isAway) return '—';
    const pickScore = isHome ? score.home : score.away;
    const oppScore = isHome ? score.away : score.home;
    const adj = (pickScore ?? 0) + pick.line_or_total;
    if (adj > (oppScore ?? 0)) return 'W';
    if (adj < (oppScore ?? 0)) return 'L';
    return 'P';
  }

  const side = toShort(pick.ou_side ?? pick.recommendation);
  const total = (score.home ?? 0) + (score.away ?? 0);
  if (total === pick.line_or_total) return 'P';
  if (side === 'OVER') return total > pick.line_or_total ? 'W' : 'L';
  if (side === 'UNDER') return total < pick.line_or_total ? 'W' : 'L';
  return '—';
}

export default function TrackingPage() {
  const router = useRouter();
  const [week, setWeek] = useState<number>(1);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [picks, setPicks] = useState<AiPick[]>([]);
  const [games, setGames] = useState<Map<number, GameRow>>(new Map());

  // Admin guard
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user.email?.toLowerCase() ?? null;
      if (!email) {
        router.replace('/login');
        return;
      }
      let ok = email === 'me@chrismcarthur.co.uk';
      if (!ok) {
        const { data } = await supabase
          .from('players')
          .select('display_name')
          .eq('email', email)
          .maybeSingle();
        ok = data?.display_name === 'Kinish';
      }
      setIsAdmin(ok);
      setCheckingAdmin(false);
      if (!ok) router.replace('/');
    })();
  }, [router]);

  // bootstrap week from current_open_week once
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('current_open_week').select('week_id').maybeSingle();
      if (data?.week_id) setWeek(Number(data.week_id));
    })();
  }, []);

  // load Dave1290 picks for the week
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const { data, error } = await supabase
        .from('ai_recommendations')
        .select(
          [
            'id',
            'season_year',
            'week_number',
            'game_id',
            'pick_type',
            'home_short',
            'away_short',
            'team_short',
            'ou_side',
            'line_or_total',
            'recommendation',
          ].join(',')
        )
        .eq('season_year', YEAR)
        .eq('week_number', week)
        .order('id');
      if (!error) setPicks((data ?? []) as AiPick[]);
    })();
  }, [week, isAdmin]);

  // load matching games for outcome calculation
  useEffect(() => {
    if (!isAdmin || !picks.length) {
      setGames(new Map());
      return;
    }
    const ids = Array.from(new Set(picks.map((p) => p.game_id))).filter((n) =>
      Number.isFinite(n)
    );
    if (!ids.length) {
      setGames(new Map());
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('games')
        .select(
          'id,home,away,home_score,away_score,live_home_score,live_away_score,is_final,is_live'
        )
        .in('id', ids);
      if (error) return;
      const map = new Map<number, GameRow>();
      for (const row of data ?? []) {
        const rec = row as GameRow;
        map.set(rec.id, rec);
      }
      setGames(map);
    })();
  }, [picks, isAdmin]);

  const decorated = useMemo(() => {
    return picks.map((p) => {
      const game = games.get(p.game_id) ?? null;
      const score = scoreSnapshot(game);
      const rec = toShort(p.recommendation ?? '');
      return {
        ...p,
        matchup: `${toShort(p.home_short ?? game?.home)} vs ${toShort(p.away_short ?? game?.away)}`,
        score: score.text,
        recommendationText: rec,
        outcome: computeOutcome(p, game),
      };
    });
  }, [picks, games]);

  if (checkingAdmin) {
    return <div className="p-6 text-sm text-zinc-400">Checking admin access…</div>;
  }
  if (!isAdmin) return null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Dave1290 AI Tracking</h1>
        <p className="text-sm text-zinc-400">
          Read-only log of Dave’s weekly recommendations. This page never influences the live draft
          or scoring.
        </p>
      </header>

      <div className="flex gap-3 items-center">
        <label className="text-sm opacity-70">Week</label>
        <select
          className="border bg-zinc-900 p-1 rounded"
          value={week}
          onChange={(e) => setWeek(Number(e.target.value))}
        >
          {Array.from({ length: 18 }).map((_, idx) => (
            <option key={idx + 1} value={idx + 1}>
              Week {idx + 1}
            </option>
          ))}
        </select>
      </div>

      <section className="border rounded p-4 space-y-3">
        <h2 className="text-lg font-medium">Weekly Picks</h2>
        <div className="text-xs text-zinc-500">Loaded {decorated.length} picks for Week {week}.</div>
        {decorated.length === 0 ? (
          <p className="text-sm text-zinc-400">No picks logged for Week {week}.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {decorated.map((p) => {
              const label =
                p.pick_type === 'spread'
                  ? `${p.recommendationText || toShort(p.team_short)} ${p.line_or_total ?? ''}`
                  : `${p.recommendationText || toShort(p.ou_side)} ${p.line_or_total ?? ''}`;
              return (
                <li key={p.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{p.matchup}</div>
                      <div className="text-zinc-400 text-xs">Score: {p.score}</div>
                    </div>
                    <div className="text-xs font-semibold">{p.outcome}</div>
                  </div>
                  <div className="text-zinc-300 mt-1">
                    {p.pick_type.toUpperCase()} — {label || 'N/A'}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
