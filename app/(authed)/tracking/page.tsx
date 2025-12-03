'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* --------------------------------------------------
   Types (simple + safe)
-------------------------------------------------- */

type AiResult = 'WIN' | 'LOSS' | 'PUSH' | null;

interface AiPick {
  id: number;
  season_year: number;
  week_number: number;
  game_id: number | null;
  home_short: string | null;
  away_short: string | null;
  pick_type: 'spread' | 'ou';
  team_short: string | null;
  ou_side: 'over' | 'under' | null;
  line_or_total: number | null;
  confidence: number | null;
  notes: string | null;
  result: AiResult;
}

interface GameRow {
  game_id: number;
  home_short: string;
  away_short: string;
}

/* --------------------------------------------------
   Small Helpers
-------------------------------------------------- */

function computeRecord(picks: AiPick[]) {
  let wins = 0, losses = 0, pushes = 0;

  for (const p of picks) {
    if (p.result === 'WIN') wins++;
    else if (p.result === 'LOSS') losses++;
    else if (p.result === 'PUSH') pushes++;
  }

  const total = wins + losses + pushes;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  return { wins, losses, pushes, total, winRate };
}

/* --------------------------------------------------
   Component
-------------------------------------------------- */

export default function AiTrackingPage() {
  const [year] = useState(2025);
  const [week, setWeek] = useState<number>(14);

  const [games, setGames] = useState<GameRow[]>([]);
  const [picks, setPicks] = useState<AiPick[]>([]);

  const [newPick, setNewPick] = useState({
    pick_type: 'spread' as 'spread' | 'ou',
    game_id: 0,
    team_short: '',
    ou_side: '',
    line_or_total: '',
    confidence: '',
    notes: '',
  });

  /* --------------------------------------------------
     Load games via RPC
  -------------------------------------------------- */

  const loadGames = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_week_draft_board', {
      p_year: year,
      p_week: week
    });

    if (error || !data) {
      console.error('RPC error loading games:', error);
      setGames([]);
      return;
    }

    const mapped: GameRow[] = (data as unknown as any[]).map((row) => ({
      game_id: Number(row.game_id),
      home_short: row.home_short,
      away_short: row.away_short,
    }));

    setGames(mapped);
  }, [year, week]);

  /* --------------------------------------------------
     Load picks
  -------------------------------------------------- */

  const loadPicks = useCallback(async () => {
    const { data, error } = await supabase
      .from('ai_recommendations')
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week)
      .order('id', { ascending: true });

    if (error || !data) {
      console.error('Error loading picks:', error);
      setPicks([]);
      return;
    }

    setPicks(data as unknown as AiPick[]);
  }, [year, week]);

  /* --------------------------------------------------
     Add Pick
  -------------------------------------------------- */

  const addNewPick = async () => {
    if (!newPick.game_id) return;

    const payload = {
      season_year: year,
      week_number: week,
      game_id: newPick.game_id,
      pick_type: newPick.pick_type,
      team_short:
        newPick.pick_type === 'spread'
          ? newPick.team_short.toUpperCase()
          : null,
      ou_side:
        newPick.pick_type === 'ou' && newPick.ou_side
          ? (newPick.ou_side as 'over' | 'under')
          : null,
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

    if (error) console.error('Insert error:', error);

    await loadPicks();

    setNewPick({
      pick_type: 'spread',
      game_id: 0,
      team_short: '',
      ou_side: '',
      line_or_total: '',
      confidence: '',
      notes: '',
    });
  };

  /* --------------------------------------------------
     Effects
  -------------------------------------------------- */

  useEffect(() => {
    loadGames();
    loadPicks();
  }, [loadGames, loadPicks]);

  /* --------------------------------------------------
     Summary
  -------------------------------------------------- */

  const summary = computeRecord(picks);

  /* --------------------------------------------------
     Render
  -------------------------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-xl font-semibold">
        AI Picks Tracking – Week {week}
      </h1>

      {/* Week selector */}
      <div className="flex gap-3 items-center">
        <label className="text-sm">Week</label>
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

      {/* Add Pick */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="text-lg font-medium">Add AI Pick</h2>

        <div className="grid md:grid-cols-3 gap-3">
          {/* Game */}
          <div>
            <label className="text-sm">Game</label>
            <select
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.game_id}
              onChange={(e) =>
                setNewPick({ ...newPick, game_id: Number(e.target.value) })
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

          {/* Pick type */}
          <div>
            <label className="text-sm">Pick Type</label>
            <select
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.pick_type}
              onChange={(e) =>
                setNewPick({
                  ...newPick,
                  pick_type: e.target.value as 'spread' | 'ou',
                  team_short: '',
                  ou_side: '',
                })
              }
            >
              <option value="spread">Spread</option>
              <option value="ou">O/U</option>
            </select>
          </div>

          {/* Line / total */}
          <div>
            <label className="text-sm">Line / Total</label>
            <input
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.line_or_total}
              onChange={(e) =>
                setNewPick({ ...newPick, line_or_total: e.target.value })
              }
            />
          </div>
        </div>

        {/* Spread */}
        {newPick.pick_type === 'spread' && (
          <div>
            <label className="text-sm">Team (short code)</label>
            <input
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.team_short}
              onChange={(e) =>
                setNewPick({
                  ...newPick,
                  team_short: e.target.value.toUpperCase(),
                })
              }
            />
          </div>
        )}

        {/* O/U */}
        {newPick.pick_type === 'ou' && (
          <div>
            <label className="text-sm">Side</label>
            <select
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.ou_side}
              onChange={(e) =>
                setNewPick({ ...newPick, ou_side: e.target.value })
              }
            >
              <option value="">Select…</option>
              <option value="over">OVER</option>
              <option value="under">UNDER</option>
            </select>
          </div>
        )}

        {/* Confidence + Notes */}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm">Confidence (0–100)</label>
            <input
              type="number"
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.confidence}
              onChange={(e) =>
                setNewPick({ ...newPick, confidence: e.target.value })
              }
            />
          </div>

          <div>
            <label className="text-sm">Notes</label>
            <input
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.notes}
              onChange={(e) =>
                setNewPick({ ...newPick, notes: e.target.value })
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

      {/* Picks list */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-2">AI Picks</h2>

        {picks.length === 0 ? (
          <p className="text-zinc-400 text-sm">No picks this week.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 text-sm">
            {picks.map((p) => (
              <li key={p.id} className="py-2">
                <strong>{p.pick_type.toUpperCase()}</strong> —{' '}
                {p.pick_type === 'spread'
                  ? `${p.team_short} ${p.line_or_total}`
                  : `${p.ou_side?.toUpperCase()} ${p.line_or_total}`}{' '}
                ({p.home_short} vs {p.away_short})
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Summary */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium">Summary (This Week)</h2>

        <p className="text-sm text-zinc-300">
          Picks: {summary.total} — Wins:{' '}
          <span className="text-emerald-400">{summary.wins}</span> Losses:{' '}
          <span className="text-red-400">{summary.losses}</span> Pushes:{' '}
          <span className="text-zinc-400">{summary.pushes}</span>
        </p>

        <p className="text-sm text-zinc-300 mt-1">
          Hit rate:{' '}
          {summary.total > 0
            ? `${summary.winRate.toFixed(1)}%`
            : '—'}
        </p>
      </section>
    </div>
  );
}
