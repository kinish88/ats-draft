'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ---------------------------- Types ---------------------------- */

type TrackingWeek = {
  season_year: number;
  week_number: number;
};

type UserPick = {
  id: number;
  season_year: number;
  week_number: number;
  pick_type: 'spread' | 'ou';
  team_short: string;
  pick_value: string;
  game_id: number | null;
  result: string | null;
};

type AiPick = {
  id: number;
  season_year: number;
  week_number: number;
  home_short: string;
  away_short: string;
  pick_type: 'spread' | 'ou';
  recommendation: string;
  confidence: number | null;
};

type GameResult = {
  id: number;
  game_id: number;
  home_short: string;
  away_short: string;
  home_score: number;
  away_score: number;
  spread_result: string;
  total_result: string;
};

type WeekSummary = {
  season_year: number;
  week_number: number;
  user_wins: number;
  user_losses: number;
};

export default function TrackingAdmin() {
  const [weeks, setWeeks] = useState<TrackingWeek[]>([]);
  const [year, setYear] = useState(2025);
  const [week, setWeek] = useState<number | null>(null);

  const [myPicks, setMyPicks] = useState<UserPick[]>([]);
  const [aiPicks, setAiPicks] = useState<AiPick[]>([]);
  const [results, setResults] = useState<GameResult[]>([]);
  const [summary, setSummary] = useState<WeekSummary | null>(null);

  /* ----------------------- Load weeks ----------------------- */

  const loadWeeks = useCallback(async () => {
    const { data } = await supabase
      .from('tracking.weeks')
      .select('*')
      .order('week_number');

    setWeeks((data as TrackingWeek[]) || []);
  }, []);

  /* ----------------------- Load My Picks ----------------------- */
  const loadMyPicks = useCallback(async () => {
    if (!week) return;
    const { data } = await supabase
      .from('tracking.user_picks')
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week);

    setMyPicks((data as UserPick[]) || []);
  }, [week, year]);

  /* ----------------------- Load AI Picks ----------------------- */
  const loadAiPicks = useCallback(async () => {
    if (!week) return;
    const { data } = await supabase
      .from('tracking.ai_recommendations')
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week);

    setAiPicks((data as AiPick[]) || []);
  }, [week, year]);

  /* ----------------------- Load Results ----------------------- */
  const loadResults = useCallback(async () => {
    const { data } = await supabase
      .from('tracking.game_results')
      .select('*')
      .order('id', { ascending: false });

    setResults((data as GameResult[]) || []);
  }, []);

  /* ----------------------- Load Summary ----------------------- */
  const loadSummary = useCallback(async () => {
    if (!week) return;
    const { data } = await supabase
      .from('tracking.week_summary')
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week)
      .maybeSingle();

    setSummary((data as WeekSummary) || null);
  }, [week, year]);

  /* ----------------------- useEffects ----------------------- */
  useEffect(() => {
    loadWeeks();
  }, [loadWeeks]);

  useEffect(() => {
    if (!week) return;
    loadMyPicks();
    loadAiPicks();
    loadResults();
    loadSummary();
  }, [week, loadMyPicks, loadAiPicks, loadResults, loadSummary]);

  /* ----------------------- Actions ----------------------- */

  const addWeek = async () => {
    if (!week) return;
    await supabase.rpc('record_week', {
      p_year: year,
      p_week: week,
    });
    loadWeeks();
  };

  const scoreWeek = async () => {
    if (!week) return;
    await supabase.rpc('update_user_pick_results', {
      p_year: year,
      p_week: week,
    });
    loadMyPicks();
    loadSummary();
  };

  /* ----------------------- UI ----------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-semibold">Tracking Admin Panel</h1>

      {/* Week Selector */}
      <div className="p-4 border rounded bg-zinc-900/40 space-y-3">
        <div>
          <label className="block text-sm text-zinc-400">Season Year</label>
          <input
            type="number"
            className="bg-zinc-800 border px-2 py-1 rounded"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>

        <div>
          <label className="block text-sm text-zinc-400">Select Week</label>
          <select
            className="bg-zinc-800 border px-2 py-1 rounded"
            value={week ?? ''}
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            <option value="">— Select Week —</option>
            {weeks.map((w) => (
              <option key={w.week_number} value={w.week_number}>
                Week {w.week_number}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={addWeek}
          disabled={!week}
          className="px-3 py-1 border rounded bg-zinc-800 hover:bg-zinc-700"
        >
          Add/Update Week
        </button>
      </div>

      {/* My Picks */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-2">My Picks</h2>
        {myPicks.length === 0 ? (
          <div className="text-zinc-500 text-sm">No picks yet.</div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {myPicks.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <strong>{p.pick_type.toUpperCase()}</strong> — {p.team_short}{' '}
                {p.pick_value}{' '}
                {p.result ? (
                  <span className="text-emerald-400">({p.result})</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI Picks */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-2">AI Recommendations</h2>
        {aiPicks.length === 0 ? (
          <div className="text-zinc-500 text-sm">No AI picks logged.</div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {aiPicks.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <strong>{p.pick_type.toUpperCase()}</strong> —{' '}
                {p.recommendation}{' '}
                ({p.home_short} vs {p.away_short})
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Game Results */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-2">Game Results</h2>
        {results.length === 0 ? (
          <div className="text-zinc-500 text-sm">No results recorded.</div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {results.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                {r.home_short} {r.home_score} — {r.away_score} {r.away_short}
                <span className="ml-2 text-zinc-400">
                  Spread: {r.spread_result}, Total: {r.total_result}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Summary */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-2">Week Summary</h2>
        {!summary ? (
          <div className="text-zinc-500 text-sm">No summary available.</div>
        ) : (
          <div className="text-sm">
            Wins:{' '}
            <span className="text-emerald-400">{summary.user_wins}</span> — Losses:{' '}
            <span className="text-red-400">{summary.user_losses}</span>
          </div>
        )}

        <button
          onClick={scoreWeek}
          disabled={!week}
          className="mt-3 px-3 py-1 border rounded bg-zinc-800 hover:bg-zinc-700"
        >
          Score Week
        </button>
      </section>
    </div>
  );
}
