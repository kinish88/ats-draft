'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function TrackingAdmin() {
  const [weeks, setWeeks] = useState<{ season_year: number; week_number: number }[]>([]);
  const [year, setYear] = useState(2025);
  const [week, setWeek] = useState<number | null>(null);

  const [myPicks, setMyPicks] = useState<any[]>([]);
  const [aiPicks, setAiPicks] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);

  /* --------------------- Load all tracking weeks ---------------------- */
  async function loadWeeks() {
    const { data } = await supabase
      .from('tracking.weeks')
      .select('*')
      .order('week_number');
    setWeeks(data || []);
  }

  /* --------------------- Load user picks ---------------------- */
  async function loadMyPicks() {
    if (!week) return;
    const { data } = await supabase
      .from('tracking.user_picks')
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week);
    setMyPicks(data || []);
  }

  /* --------------------- Load AI picks ---------------------- */
  async function loadAiPicks() {
    if (!week) return;
    const { data } = await supabase
      .from('tracking.ai_recommendations')
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week);
    setAiPicks(data || []);
  }

  /* --------------------- Load game results ---------------------- */
  async function loadResults() {
    const { data } = await supabase
      .from('tracking.game_results')
      .select('*')
      .order('id', { ascending: false });
    setResults(data || []);
  }

  /* --------------------- Load summary view ---------------------- */
  async function loadSummary() {
    if (!week) return;
    const { data } = await supabase
      .from('tracking.week_summary')
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week)
      .maybeSingle();
    setSummary(data || null);
  }

  useEffect(() => {
    loadWeeks();
  }, []);

  useEffect(() => {
    loadMyPicks();
    loadAiPicks();
    loadResults();
    loadSummary();
  }, [week]);

  /* --------------------------- Actions --------------------------- */

  async function addWeek() {
    await supabase.rpc('record_week', {
      p_year: year,
      p_week: week
    });
    loadWeeks();
  }

  async function scoreWeek() {
    await supabase.rpc('update_user_pick_results', {
      p_year: year,
      p_week: week
    });
    loadMyPicks();
    loadSummary();
  }

  /* ----------------------------- UI ------------------------------ */

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
                <strong>{p.pick_type.toUpperCase()}</strong> — {p.team_short} {p.pick_value}{' '}
                {p.result ? <span className="text-emerald-400">({p.result})</span> : null}
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
                <strong>{p.pick_type.toUpperCase()}</strong> — {p.recommendation}{' '}
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
            Wins: <span className="text-emerald-400">{summary.user_wins}</span> — Losses:{' '}
            <span className="text-red-400">{summary.user_losses}</span>
          </div>
        )}

        <button
          onClick={scoreWeek}
          className="mt-3 px-3 py-1 border rounded bg-zinc-800 hover:bg-zinc-700"
        >
          Score Week
        </button>
      </section>
    </div>
  );
}
