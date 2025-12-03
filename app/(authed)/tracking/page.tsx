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
  home_short: string;
  away_short: string;
  pick_type: 'spread' | 'ou';
  team_short: string | null;
  ou_side: 'over' | 'under' | null;
  line_or_total: number | null;
  confidence: number | null;
  notes: string | null;
  result: AiResult;
};

type GameRow = {
  id: number;
  home_short: string;
  away_short: string;
  home_score: number | null;
  away_score: number | null;
};

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
     Load games for this week (FIXED)
  -------------------------------------------------- */
  const loadGames = useCallback(async () => {
    const { data, error } = await supabase
      .from('games')
      .select('id, home_short, away_short, home_score, away_score')
      .eq('week_id', week);

    if (!error && data) setGames(data as GameRow[]);
    else setGames([]);
  }, [week]);

  /* --------------------------------------------------
     Load AI picks (FIXED TABLE NAME)
  -------------------------------------------------- */
  const loadPicks = useCallback(async () => {
    const { data, error } = await supabase
      .from('ai_recommendations') // FIXED
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week)
      .order('id');

    if (!error && data) setPicks(data as AiPick[]);
    else setPicks([]);
  }, [week, year]);

  /* --------------------------------------------------
     Add New AI Pick (FIXED TABLE NAME)
  -------------------------------------------------- */
  const addNewPick = async () => {
    if (!newPick.game_id) return;

    await supabase
      .from('ai_recommendations') // FIXED
      .insert([
        {
          season_year: year,
          week_number: week,
          game_id: Number(newPick.game_id),
          pick_type: newPick.pick_type,
          team_short: newPick.pick_type === 'spread' ? newPick.team_short : null,
          ou_side:
            newPick.pick_type === 'ou' && newPick.ou_side
              ? (newPick.ou_side as 'over' | 'under')
              : null,
          line_or_total: newPick.line_or_total ? Number(newPick.line_or_total) : null,
          confidence: newPick.confidence ? Number(newPick.confidence) : null,
          notes: newPick.notes || null,
        },
      ]);

    loadPicks();

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
     Score picks (unchanged except table name)
  -------------------------------------------------- */
  const scorePicks = async () => {
    const { data: allGames } = await supabase
      .from('games')
      .select('id, home_score, away_score, home_short, away_short')
      .eq('week_id', week);

    const gameMap = new Map<number, GameRow>();
    (allGames || []).forEach((g) => gameMap.set(g.id, g as GameRow));

    for (const p of picks) {
      const g = gameMap.get(p.game_id);
      if (!g || g.home_score == null || g.away_score == null) continue;

      let result: AiResult = 'PUSH';

      const diff = g.home_score - g.away_score;
      const tot = g.home_score + g.away_score;

      if (p.pick_type === 'spread' && p.team_short && p.line_or_total != null) {
        const isHome = p.team_short.toUpperCase() === g.home_short.toUpperCase();
        const margin = isHome ? diff : -diff;

        if (margin > -p.line_or_total) result = 'WIN';
        else if (margin < -p.line_or_total) result = 'LOSS';
      }

      if (p.pick_type === 'ou' && p.ou_side && p.line_or_total != null) {
        if (tot > p.line_or_total && p.ou_side === 'over') result = 'WIN';
        else if (tot < p.line_or_total && p.ou_side === 'under') result = 'WIN';
        else if (tot === p.line_or_total) result = 'PUSH';
        else result = 'LOSS';
      }

      await supabase
        .from('ai_recommendations')  // FIXED
        .update({ result })
        .eq('id', p.id);
    }

    loadPicks();
  };

  /* --------------------------------------------------
     Effects
  -------------------------------------------------- */
  useEffect(() => {
    loadGames();
    loadPicks();
  }, [loadGames, loadPicks]);

  /* --------------------------------------------------
     Render
  -------------------------------------------------- */
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-xl font-semibold">AI Picks Tracking – Week {week}</h1>

      {/* WEEK SELECTOR */}
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

      {/* ADD PICK */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="text-lg font-medium">Add AI Pick</h2>

        {/* GAME DROPDOWN (NOW WORKS) */}
        <div>
          <label className="text-sm">Game</label>
          <select
            className="border bg-zinc-900 p-1 rounded w-full"
            value={newPick.game_id}
            onChange={(e) => setNewPick({ ...newPick, game_id: Number(e.target.value) })}
          >
            <option value={0}>Select game…</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.home_short} vs {g.away_short}
              </option>
            ))}
          </select>
        </div>

        {/* TYPE */}
        <div>
          <label className="text-sm">Pick Type</label>
          <select
            className="border bg-zinc-900 p-1 rounded w-full"
            value={newPick.pick_type}
            onChange={(e) =>
              setNewPick({
                ...newPick,
                pick_type: e.target.value as 'spread' | 'ou',
                team_short: e.target.value === 'spread' ? newPick.team_short : '',
                ou_side: e.target.value === 'ou' ? newPick.ou_side : '',
              })
            }
          >
            <option value="spread">Spread</option>
            <option value="ou">O/U</option>
          </select>
        </div>

        {/* LINE */}
        <div>
          <label className="text-sm">Line / Total</label>
          <input
            className="border bg-zinc-900 p-1 rounded w-full"
            value={newPick.line_or_total}
            onChange={(e) => setNewPick({ ...newPick, line_or_total: e.target.value })}
          />
        </div>

        {/* TEAM OR O/U */}
        {newPick.pick_type === 'spread' && (
          <div>
            <label className="text-sm">Team (short code)</label>
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
              onChange={(e) => setNewPick({ ...newPick, ou_side: e.target.value })}
            >
              <option value="">Select…</option>
              <option value="over">OVER</option>
              <option value="under">UNDER</option>
            </select>
          </div>
        )}

        {/* CONF + NOTES */}
        <div>
          <label className="text-sm">Confidence (0–100)</label>
          <input
            type="number"
            className="border bg-zinc-900 p-1 rounded w-full"
            value={newPick.confidence}
            onChange={(e) => setNewPick({ ...newPick, confidence: e.target.value })}
          />
        </div>

        <div>
          <label className="text-sm">Notes</label>
          <input
            className="border bg-zinc-900 p-1 rounded w-full"
            value={newPick.notes}
            onChange={(e) => setNewPick({ ...newPick, notes: e.target.value })}
          />
        </div>

        <button
          onClick={addNewPick}
          className="px-3 py-1 border rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
        >
          Add Pick
        </button>
      </section>

      {/* PICKS */}
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
                  ? `${p.team_short ?? ''} ${p.line_or_total ?? ''}`
                  : `${p.ou_side?.toUpperCase() ?? ''} ${p.line_or_total ?? ''}`}{' '}
                ({p.home_short} vs {p.away_short})
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
