'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* --------------------------------------------------
   Types
-------------------------------------------------- */

type AiResult = 'WIN' | 'LOSS' | 'PUSH' | null;

type AiPick = {
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
};

type BoardGame = {
  game_id: number;
  home_short: string;
  away_short: string;
};

/* --------------------------------------------------
   Utility: compute W/L/P
-------------------------------------------------- */
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

/* --------------------------------------------------
   Page Component
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
     Load games via RPC (best method)
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

    type RpcRow = {
      game_id: number;
      home_short: string;
      away_short: string;
    };

    const rows: RpcRow[] = (data ?? []) as RpcRow[];

    const mapped = rows.map((r) => ({
      game_id: Number(r.game_id),
      home_short: r.home_short,
      away_short: r.away_short,
    }));

    setGames(mapped);
  }, [year, week]);

  /* --------------------------------------------------
     Load AI picks
  -------------------------------------------------- */
  const loadPicks = useCallback(async () => {
  const { data, error } = await supabase
    .from('tracking.ai_recommendations')
    .select(`
      *,
      game:game_id (
        home_short,
        away_short
      )
    `)
    .eq('season_year', year)
    .eq('week_number', week)
    .order('id');

  if (error) {
    console.error('loadPicks error', error);
    setPicks([]);
    return;
  }

  const mapped = (data ?? []).map((row: any) => ({
    ...row,
    home_short: row.game?.home_short ?? null,
    away_short: row.game?.away_short ?? null,
  }));

  setPicks(mapped);
}, [year, week]);


  /* --------------------------------------------------
     Add new AI Pick
  -------------------------------------------------- */
  const addNewPick = async () => {
    if (!newPick.game_id) return;

    const insertPayload = {
      season_year: year,
      week_number: week,
      game_id: Number(newPick.game_id),
      pick_type: newPick.pick_type,
      team_short:
        newPick.pick_type === 'spread' ? newPick.team_short.toUpperCase() : null,
      ou_side:
        newPick.pick_type === 'ou' && newPick.ou_side
          ? (newPick.ou_side as 'over' | 'under')
          : null,
      line_or_total: newPick.line_or_total
        ? Number(newPick.line_or_total)
        : null,
      confidence: newPick.confidence ? Number(newPick.confidence) : null,
      notes: newPick.notes || null,
    };

    const { error } = await supabase
      .from('tracking.ai_recommendations')
      .insert([insertPayload]);

    if (error) console.error('Add pick error', error);

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
     Effect: Load games + picks
  -------------------------------------------------- */
  useEffect(() => {
    loadGames();
    loadPicks();
  }, [loadGames, loadPicks]);

  /* --------------------------------------------------
     Summary & Analytics
  -------------------------------------------------- */

  const overall = computeRecord(picks);
  const spreadPicks = picks.filter((p) => p.pick_type === 'spread');
  const ouPicks = picks.filter((p) => p.pick_type === 'ou');

  const spreadSummary = computeRecord(spreadPicks);
  const ouSummary = computeRecord(ouPicks);

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

      {/* Add AI Pick */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="text-lg font-medium">Add AI Pick</h2>

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
                  team_short: '',
                  ou_side: '',
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

        {newPick.pick_type === 'spread' && (
          <div>
            <label className="text-sm">Team (short code)</label>
            <input
              className="border bg-zinc-900 p-1 rounded w-full"
              value={newPick.team_short}
              onChange={(e) =>
                setNewPick((p) => ({
                  ...p,
                  team_short: e.target.value.toUpperCase(),
                }))
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
                setNewPick((p) => ({
                  ...p,
                  ou_side: e.target.value,
                }))
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
                setNewPick((p) => ({
                  ...p,
                  confidence: e.target.value,
                }))
              }
            />
          </div>

          <div>
            <label className="text-sm">Notes (optional)</label>
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

      {/* AI Picks List */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-3">AI Picks</h2>
        {picks.length === 0 ? (
          <p className="text-zinc-400 text-sm">No picks this week.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {picks.map((p) => (
              <li key={p.id} className="py-2 text-sm">
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
    </div>
  );
}
