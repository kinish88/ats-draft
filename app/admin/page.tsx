'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type GameForScore = {
  game_id: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  kickoff: string;
};
type WeekOption = { week_number: number };

const YEAR = 2025;

export default function AdminScoresPage() {
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [rows, setRows] = useState<GameForScore[]>([]);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  async function loadWeeks() {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    if (data) setWeeks((data as WeekOption[]).map((w) => w.week_number));
    else setWeeks(Array.from({ length: 18 }, (_, i) => i + 1));
  }

  async function loadWeekGames(w: number) {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_week_games_for_scoring', { p_year: YEAR, p_week: w });
    if (!error && data) setRows(data as GameForScore[]);
    setLoading(false);
  }

  useEffect(() => { loadWeeks(); }, []);
  useEffect(() => { loadWeekGames(week); }, [week]);

  function updateRow(id: number, field: 'home_score' | 'away_score', value: number | null) {
    setRows((prev) => prev.map((r) => (r.game_id === id ? { ...r, [field]: value } : r)));
  }

  async function saveScore(r: GameForScore) {
    const hs = r.home_score ?? 0;
    const as = r.away_score ?? 0;
    setSavingId(r.game_id);
    const { error } = await supabase.rpc('set_final_score', {
      p_year: YEAR,
      p_week_number: week,
      p_home_short: r.home,
      p_away_short: r.away,
      p_home_score: hs,
      p_away_score: as,
    });
    setSavingId(null);
    if (error) alert(error.message);
    else await loadWeekGames(week);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin · Final Scores</h1>
        <Link className="underline" href="/">← Back to Draft</Link>
      </header>

      <div className="flex items-center gap-3">
        <label className="text-sm">Week</label>
        <select
          className="border rounded p-1 bg-transparent"
          value={week}
          onChange={(e) => setWeek(parseInt(e.target.value, 10))}
        >
          {weeks.map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading games…</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.game_id} className="grid grid-cols-6 gap-2 items-center p-2 border rounded">
              <div className="col-span-2 text-sm">{r.home} vs {r.away}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Home</span>
                <input
                  type="number"
                  className="w-16 border rounded p-1 bg-transparent"
                  value={r.home_score ?? ''}
                  onChange={(e) =>
                    updateRow(r.game_id, 'home_score', e.target.value === '' ? null : parseInt(e.target.value, 10))
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Away</span>
                <input
                  type="number"
                  className="w-16 border rounded p-1 bg-transparent"
                  value={r.away_score ?? ''}
                  onChange={(e) =>
                    updateRow(r.game_id, 'away_score', e.target.value === '' ? null : parseInt(e.target.value, 10))
                  }
                />
              </div>
              <div className="text-right">
                <button
                  onClick={() => saveScore(r)}
                  disabled={savingId === r.game_id}
                  className="px-3 py-1 border rounded disabled:opacity-50"
                >
                  {savingId === r.game_id ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="text-sm text-gray-400">No games for this week.</div>}
        </div>
      )}

      <p className="text-xs text-gray-400">
        After saving all scores for a week, refresh the main page to see colours and summary update.
      </p>
    </div>
  );
}
