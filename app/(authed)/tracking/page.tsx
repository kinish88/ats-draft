'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* --------------------------------------------------
   Types
-------------------------------------------------- */

type AiResult = 'WIN' | 'LOSS' | 'PUSH' | null;

interface AiPick {
  id: number;
  season_year: number;
  week_number: number;
  game_id: number;
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

interface BoardGame {
  game_id: number;
  home_short: string;
  away_short: string;
}

interface RecordSummary {
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  winRate: number;
}

/* --------------------------------------------------
   Utility: compute W/L/P
-------------------------------------------------- */
function computeRecord(picks: AiPick[]): RecordSummary {
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

/* --------------------------------------------------
   Component
-------------------------------------------------- */

export default function AiTrackingPage() {
  const [year] = useState(2025);
  const [week, setWeek] = useState<number>(14);

  const [games, setGames] = useState<BoardGame[]>([]);
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
      p_week: week,
    });

    if (error) {
      console.error('loadGames RPC error', error);
      setGames([]);
      return;
    }

    const mapped = (data ?? []).map((r: any) => ({
      game_id: Number(r.game_id),
      home_short: r.home_short,
      away_short: r.away_short,
    })) as BoardGame[];

    setGames(mapped);
  }, [year, week]);

  /* --------------------------------------------------
     Load AI picks correctly (THIS FIXES YOUR ISSUE)
  -------------------------------------------------- */
  const loadPicks = useCallback(async () => {
    const { data, error } = await supabase
      .from('ai_recommendations')
      .select(`
        *,
        games:game_id (
          home_short,
          away_short
        )
      `)
      .eq('season_year', year)
      .eq('week_number', week)
      .order('id');

    if (error) {
      console.error("loadPicks error", error);
      setPicks([]);
      return;
    }

    const mapped = (data ?? []).map(row => ({
      ...row,
      home_short: row.games?.home_short ?? null,
      away_short: row.games?.away_short ?? null,
    })) as AiPick[];

    setPicks(mapped);
  }, [year, week]);

  /* --------------------------------------------------
     Add new pick
  -------------------------------------------------- */

  const addNewPick = async () => {
    if (!newPick.game_id) return;

    const insertPayload = {
      season_year: year,
      week_number: week,
      game_id: Number(newPick.game_id),
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
      .insert([insertPayload]);

    if (error) console.error("insert error", error);

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
     Score picks (auto-grade vs games table)
  -------------------------------------------------- */

  const scorePicks = async () => {
    const { data: gamesData } = await supabase
      .from('games')
      .select('id, home_score, away_score, home_short, away_short')
      .eq('kickoff_year', year)
      .eq('week_id', week);

    const map = new Map<number, any>();
    (gamesData ?? []).forEach(g => map.set(g.id, g));

    for (const p of picks) {
      const g = map.get(p.game_id);
      if (!g || g.home_score == null || g.away_score == null) continue;

      let result: AiResult = 'PUSH';

      const diff = g.home_score - g.away_score;
      const total = g.home_score + g.away_score;

      if (p.pick_type === 'spread' && p.team_short && p.line_or_total != null) {
        const isHome = p.team_short.toUpperCase() === g.home_short;
        const margin = isHome ? diff : -diff;

        if (margin > -p.line_or_total) result = 'WIN';
        else if (margin < -p.line_or_total) result = 'LOSS';
      }

      if (p.pick_type === 'ou' && p.ou_side && p.line_or_total != null) {
        if (total > p.line_or_total && p.ou_side === 'over') result = 'WIN';
        else if (total < p.line_or_total && p.ou_side === 'under') result = 'WIN';
        else if (total === p.line_or_total) result = 'PUSH';
        else result = 'LOSS';
      }

      await supabase
        .from('ai_recommendations')
        .update({ result })
        .eq('id', p.id);
    }

    loadPicks();
  };

  /* --------------------------------------------------
     Load initial data
  -------------------------------------------------- */

  useEffect(() => {
    loadGames();
    loadPicks();
  }, [loadGames, loadPicks]);

  /* --------------------------------------------------
     Analytics
  -------------------------------------------------- */

  const overall = computeRecord(picks);
  const spreadPicks = picks.filter(p => p.pick_type === 'spread');
  const ouPicks = picks.filter(p => p.pick_type === 'ou');

  const spreadSummary = computeRecord(spreadPicks);
  const ouSummary = computeRecord(ouPicks);

  /* --------------------------------------------------
     Render
  -------------------------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-xl font-semibold">AI Picks Tracking – Week {week}</h1>

      {/* Week Selector */}
      <div className="flex gap-3 items-center">
        <label className="text-sm opacity-70">Week</label>
        <select
          className="border bg-zinc-900 p-1 rounded"
          value={week}
          onChange={(e) => setWeek(Number(e.target.value))}
        >
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>Week {i + 1}</option>
          ))}
        </select>
      </div>

      {/* Summary */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-2">Overall Summary (This Week)</h2>
        <p className="text-sm text-zinc-300">
          Total picks: {overall.total} — Wins:{' '}
          <span className="text-emerald-400">{overall.wins}</span> — Losses:{' '}
          <span className="text-red-400">{overall.losses}</span> — Pushes:{' '}
          <span className="text-zinc-400">{overall.pushes}</span>
        </p>
      </section>

      {/* Add Pick */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="text-lg font-medium">Add AI Pick</h2>

        <div className="grid md:grid-cols-3 gap-3">
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
              {games.map(g => (
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

        {newPick.pick_type === 'spread' && (
          <div>
            <label className="text-sm">Team</label>
            <input
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.team_short}
              onChange={(e) =>
                setNewPick({ ...newPick, team_short: e.target.value.toUpperCase() })
              }
            />
          </div>
        )}

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

      {/* Picks List */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-3">AI Picks</h2>

        {picks.length === 0 ? (
          <p className="text-zinc-400 text-sm">No picks this week.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {picks.map(p => (
              <li key={p.id} className="py-2 text-sm">
                <strong>{p.pick_type.toUpperCase()}</strong> —{' '}
                {p.pick_type === 'spread'
                  ? `${p.team_short} ${p.line_or_total}`
                  : `${p.ou_side?.toUpperCase()} ${p.line_or_total}`}{' '}
                ({p.home_short} vs {p.away_short}){' '}
                {p.result && (
                  <span
                    className={
                      p.result === 'WIN'
                        ? 'text-emerald-400'
                        : p.result === 'LOSS'
                        ? 'text-red-400'
                        : 'text-zinc-400'
                    }
                  >
                    — {p.result}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={scorePicks}
          className="mt-3 px-3 py-1 border rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
        >
          Score Week
        </button>
      </section>
    </div>
  );
}
