'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ------------------------------------------------------------
   TYPES
------------------------------------------------------------ */

type AiResult = 'WIN' | 'LOSS' | 'PUSH' | null;

interface AiPick {
  id: number;
  season_year: number;
  week_number: number;
  game_id: number | null;
  home_short: string | null;
  away_short: string | null;
  pick_type: 'spread' | 'ou' | null;
  recommendation: string | null;   // team_short for spread, OVER/UNDER for O/U
  confidence: number | null;
  notes: string | null;
  line_or_total: number | null;
  ou_side: string | null;
  result: AiResult;
}

interface BoardGame {
  game_id: number;
  home_short: string;
  away_short: string;
}

/* ------------------------------------------------------------
   SUMMARY WORKER
------------------------------------------------------------ */
function computeRecord(picks: AiPick[]) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const p of picks) {
    if (p.result === 'WIN') wins++;
    else if (p.result === 'LOSS') losses++;
    else if (p.result === 'PUSH') pushes++;
  }

  const total = wins + losses + pushes;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  return { wins, losses, pushes, total, winRate };
}

/* ------------------------------------------------------------
   COMPONENT
------------------------------------------------------------ */

export default function AiTrackingPage() {
  const [year] = useState(2025);
  const [week, setWeek] = useState<number>(14);

  const [games, setGames] = useState<BoardGame[]>([]);
  const [picks, setPicks] = useState<AiPick[]>([]);

  const [newPick, setNewPick] = useState({
    pick_type: 'spread' as 'spread' | 'ou',
    game_id: 0,
    recommendation: '',
    line_or_total: '',
    confidence: '',
    notes: '',
  });

  /* ------------------------------------------------------------
     LOAD GAMES (RPC)
  ------------------------------------------------------------ */

  const loadGames = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_week_draft_board', {
      p_year: year,
      p_week: week,
    });

    if (error) {
      console.error('RPC get_week_draft_board error', error);
      setGames([]);
      return;
    }

    const mapped = (data ?? []).map((row: any) => ({
      game_id: row.game_id,
      home_short: row.home_short,
      away_short: row.away_short,
    }));

    setGames(mapped);
  }, [year, week]);

  /* ------------------------------------------------------------
     LOAD PICKS FOR THIS WEEK
  ------------------------------------------------------------ */

  const loadPicks = useCallback(async () => {
    const { data, error } = await supabase
      .from('ai_recommendations')
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week)
      .order('id');

    if (error) {
      console.error('loadPicks error', error);
      setPicks([]);
      return;
    }

    setPicks((data as AiPick[]) ?? []);
  }, [year, week]);

  /* ------------------------------------------------------------
     ADD NEW PICK
  ------------------------------------------------------------ */

  const addNewPick = async () => {
    if (!newPick.game_id) return;

    const payload = {
      season_year: year,
      week_number: week,
      game_id: newPick.game_id,
      pick_type: newPick.pick_type,
      recommendation: newPick.recommendation.toUpperCase(),
      line_or_total: newPick.line_or_total
        ? Number(newPick.line_or_total)
        : null,
      confidence: newPick.confidence
        ? Number(newPick.confidence)
        : null,
      notes: newPick.notes || null,
    };

    const { error } = await supabase
      .from('ai_recommendations')
      .insert([payload]);

    if (error) console.error('Insert error', error);

    await loadPicks();

    setNewPick({
      pick_type: 'spread',
      game_id: 0,
      recommendation: '',
      line_or_total: '',
      confidence: '',
      notes: '',
    });
  };

  /* ------------------------------------------------------------
     EFFECT: LOAD GAMES + PICKS WHEN WEEK CHANGES
  ------------------------------------------------------------ */
  useEffect(() => {
    loadGames();
    loadPicks();
  }, [loadGames, loadPicks]);

  /* ------------------------------------------------------------
     SUMMARY
  ------------------------------------------------------------ */
  const overall = computeRecord(picks);

  /* ------------------------------------------------------------
     RENDER
  ------------------------------------------------------------ */
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <h1 className="text-xl font-semibold">
        AI Picks Tracking — Week {week}
      </h1>

      {/* Week Selector */}
      <div className="flex gap-2 items-center">
        <label className="text-sm opacity-70">Week</label>
        <select
          className="border bg-zinc-900 p-1 rounded"
          value={week}
          onChange={(e) => setWeek(Number(e.target.value))}
        >
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>
              Week {i + 1}
            </option>
          ))}
        </select>
      </div>

      {/* ADD PICK */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-medium text-lg">Add AI Pick</h2>

        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="text-sm">Game</label>
            <select
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.game_id}
              onChange={(e) =>
                setNewPick((p) => ({
                  ...p,
                  game_id: Number(e.target.value),
                }))
              }
            >
              <option value={0}>Select game…</option>
              {games.map((g) => (
                <option key={g.game_id} value={g.game_id}>
                  {g.home_short} vs {g.away_short}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm">Pick Type</label>
            <select
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.pick_type}
              onChange={(e) =>
                setNewPick((p) => ({
                  ...p,
                  pick_type: e.target.value as 'spread' | 'ou',
                }))
              }
            >
              <option value="spread">Spread</option>
              <option value="ou">O/U</option>
            </select>
          </div>

          <div>
            <label className="text-sm">Line / Total</label>
            <input
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.line_or_total}
              onChange={(e) =>
                setNewPick((p) => ({
                  ...p,
                  line_or_total: e.target.value,
                }))
              }
            />
          </div>
        </div>

        <div>
          <label className="text-sm">
            Recommendation {newPick.pick_type === 'spread' ? '(team)' : '(OVER/UNDER)'}
          </label>
          <input
            className="border bg-zinc-900 p-1 rounded w-full"
            value={newPick.recommendation}
            onChange={(e) =>
              setNewPick((p) => ({
                ...p,
                recommendation: e.target.value.toUpperCase(),
              }))
            }
          />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm">Confidence %</label>
            <input
              type="number"
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.confidence}
              onChange={(e) =>
                setNewPick((p) => ({
                  ...p,
                  confidence: e.target.value,
                }))
              }
            />
          </div>

          <div>
            <label className="text-sm">Notes</label>
            <input
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.notes}
              onChange={(e) =>
                setNewPick((p) => ({
                  ...p,
                  notes: e.target.value,
                }))
              }
            />
          </div>
        </div>

        <button
          onClick={addNewPick}
          className="px-3 py-1 border rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
        >
          Add Pick
        </button>
      </section>

      {/* AI PICK LIST */}
      <section className="border rounded p-4">
        <h2 className="font-medium text-lg mb-3">AI Picks</h2>

        {picks.length === 0 ? (
          <p className="text-sm opacity-60">No picks yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {picks.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <strong>{p.pick_type?.toUpperCase()}</strong> —{' '}
                {p.recommendation}{' '}
                {p.line_or_total !== null ? p.line_or_total : ''}{' '}
                ({p.home_short} vs {p.away_short})
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
