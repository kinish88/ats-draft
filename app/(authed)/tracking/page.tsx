'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* --------------------------------------------------
   Types
-------------------------------------------------- */

type AiResult = 'WIN' | 'LOSS' | 'PUSH' | null;

type DbAiPick = {
  id: number;
  season_year: number;
  week_number: number;
  game_id: number | null;
  home_short: string | null;
  away_short: string | null;
  pick_type: 'spread' | 'ou';
  recommendation: string; // team or OVER/UNDER
  confidence: number | null;
  created_at: string | null;
  team_short: string | null;
  ou_side: string | null; // 'over' | 'under'
  line_or_total: number | null;
  notes: string | null;
};

type BoardGame = {
  game_id: number;
  home_short: string;
  away_short: string;
  home_line: number | null;
  away_line: number | null;
  total: number | null;
};

type GameScoreRow = {
  game_id: number;
  home_score: number | null;
  away_score: number | null;
};

type TeamStat = {
  team: string;
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  winRate: number;
};

type OuSideStat = {
  side: 'over' | 'under';
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  winRate: number;
};

type ConfidenceBucket = {
  label: string;
  min: number;
  max: number;
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  winRate: number;
};

/* --------------------------------------------------
   Helpers
-------------------------------------------------- */

function computeRecord(results: AiResult[]): {
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  winRate: number;
} {
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const r of results) {
    if (r === 'WIN') wins += 1;
    else if (r === 'LOSS') losses += 1;
    else if (r === 'PUSH') pushes += 1;
  }

  const total = wins + losses + pushes;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  return { wins, losses, pushes, total, winRate };
}

/**
 * Apply your ATS rule:
 *   - Adjust the picked team’s score by the line
 *   - If adjusted > opponent → WIN
 *   - If adjusted < opponent → LOSS
 *   - If equal → PUSH
 */
function getPickResult(
  pick: DbAiPick,
  scores: GameScoreRow[]
): AiResult {
  if (pick.game_id == null || pick.line_or_total == null) return null;

  const scoreRow = scores.find((g) => g.game_id === pick.game_id);
  if (!scoreRow) return null;
  const { home_score, away_score } = scoreRow;
  if (home_score == null || away_score == null) return null;

  if (pick.pick_type === 'spread') {
    const line = pick.line_or_total;
    const teamCode = (pick.recommendation || pick.team_short || '').toUpperCase();
    const homeCode = (pick.home_short || '').toUpperCase();
    const awayCode = (pick.away_short || '').toUpperCase();

    const isHome = teamCode === homeCode;
    const isAway = teamCode === awayCode;

    if (!isHome && !isAway) return null;

    const adjusted = isHome ? home_score + line : away_score + line;
    const opp = isHome ? away_score : home_score;

    if (adjusted > opp) return 'WIN';
    if (adjusted < opp) return 'LOSS';
    return 'PUSH';
  }

  if (pick.pick_type === 'ou') {
    if (!pick.ou_side) return null;
    const totalScore = home_score + away_score;
    const line = pick.line_or_total;
    if (line == null) return null;

    const side = pick.ou_side.toLowerCase();
    if (totalScore > line && side === 'over') return 'WIN';
    if (totalScore < line && side === 'under') return 'WIN';
    if (totalScore === line) return 'PUSH';
    return 'LOSS';
  }

  return null;
}

/* --------------------------------------------------
   Component
-------------------------------------------------- */

export default function AiTrackingPage() {
  const [year] = useState<number>(2025);
  const [week, setWeek] = useState<number>(14);

  const [games, setGames] = useState<BoardGame[]>([]);
  const [picks, setPicks] = useState<DbAiPick[]>([]);
  const [scores, setScores] = useState<GameScoreRow[]>([]);

  const [newPick, setNewPick] = useState<{
    pick_type: 'spread' | 'ou';
    game_id: number;
    team_short: string;
    ou_side: string;
    line_or_total: string;
    confidence: string;
    notes: string;
  }>({
    pick_type: 'spread',
    game_id: 0,
    team_short: '',
    ou_side: '',
    line_or_total: '',
    confidence: '',
    notes: '',
  });

  /* --------------------------------------------------
     Load games (RPC)
  -------------------------------------------------- */

  const loadGames = useCallback(async () => {
    type RpcRow = {
      game_id: number;
      home_short: string;
      away_short: string;
      home_line: number | null;
      away_line: number | null;
      total: number | null;
    };

    const { data, error } = await supabase.rpc('get_week_draft_board', {
      p_year: year,
      p_week: week,
    });

    if (error) {
      console.error('loadGames RPC error', error);
      setGames([]);
      return;
    }

    const rows = (data ?? []) as RpcRow[];

    const mapped: BoardGame[] = rows.map((r) => ({
      game_id: r.game_id,
      home_short: r.home_short,
      away_short: r.away_short,
      home_line: r.home_line,
      away_line: r.away_line,
      total: r.total,
    }));

    setGames(mapped);
  }, [year, week]);

  /* --------------------------------------------------
     Load picks
  -------------------------------------------------- */

  const loadPicks = useCallback(async () => {
    const { data, error } = await supabase
      .from<DbAiPick>('ai_recommendations')
      .select('*')
      .eq('season_year', year)
      .eq('week_number', week)
      .order('id');

    if (error) {
      console.error('loadPicks error', error);
      setPicks([]);
      return;
    }

    setPicks(data ?? []);
  }, [year, week]);

  /* --------------------------------------------------
     Load scores from game_lines
  -------------------------------------------------- */

  const loadScores = useCallback(async () => {
    const { data, error } = await supabase
      .from<GameScoreRow>('game_lines')
      .select('game_id, home_score, away_score')
      .eq('kickoff_year', year)
      .eq('week_id', week);

    if (error) {
      console.error('loadScores error', error);
      setScores([]);
      return;
    }

    setScores(data ?? []);
  }, [year, week]);

  /* --------------------------------------------------
     Add new AI pick
  -------------------------------------------------- */

  const addNewPick = async () => {
    if (!newPick.game_id) return;

    const chosenGame = games.find((g) => g.game_id === newPick.game_id);

    if (newPick.pick_type === 'spread') {
      if (!newPick.team_short.trim()) return;
      if (!newPick.line_or_total.trim()) return;
    } else {
      if (!newPick.ou_side) return;
      if (!newPick.line_or_total.trim()) return;
    }

    const numericLine = Number(newPick.line_or_total);
    const numericConf = newPick.confidence ? Number(newPick.confidence) : null;

    const recommendation =
      newPick.pick_type === 'spread'
        ? newPick.team_short.toUpperCase()
        : newPick.ou_side
        ? newPick.ou_side.toUpperCase()
        : '';

    const insertPayload = {
      season_year: year,
      week_number: week,
      game_id: newPick.game_id,
      home_short: chosenGame?.home_short ?? null,
      away_short: chosenGame?.away_short ?? null,
      pick_type: newPick.pick_type,
      recommendation,
      confidence: Number.isNaN(numericConf) ? null : numericConf,
      team_short:
        newPick.pick_type === 'spread'
          ? newPick.team_short.toUpperCase()
          : null,
      ou_side:
        newPick.pick_type === 'ou' ? newPick.ou_side.toLowerCase() : null,
      line_or_total: Number.isNaN(numericLine) ? null : numericLine,
      notes: newPick.notes || null,
    };

    const { error } = await supabase
      .from('ai_recommendations')
      .insert([insertPayload]);

    if (error) {
      console.error('Add pick error', error);
      return;
    }

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
    loadScores();
  }, [loadGames, loadPicks, loadScores]);

  /* --------------------------------------------------
     Derived results & analytics
  -------------------------------------------------- */

  const allResults: AiResult[] = picks.map((p) => getPickResult(p, scores));

  const spreadResults: AiResult[] = picks
    .filter((p) => p.pick_type === 'spread')
    .map((p) => getPickResult(p, scores));

  const ouResults: AiResult[] = picks
    .filter((p) => p.pick_type === 'ou')
    .map((p) => getPickResult(p, scores));

  const overall = computeRecord(allResults);
  const spreadSummary = computeRecord(spreadResults);
  const ouSummary = computeRecord(ouResults);

  // Team stats (spread only)
  const teamStats: TeamStat[] = (() => {
    const map = new Map<string, TeamStat>();

    picks
      .filter((p) => p.pick_type === 'spread')
      .forEach((p) => {
        const result = getPickResult(p, scores);
        if (!result) return;

        const teamCode = (p.recommendation || p.team_short || '').toUpperCase();
        if (!teamCode) return;

        if (!map.has(teamCode)) {
          map.set(teamCode, {
            team: teamCode,
            wins: 0,
            losses: 0,
            pushes: 0,
            total: 0,
            winRate: 0,
          });
        }

        const stat = map.get(teamCode)!;
        if (result === 'WIN') stat.wins += 1;
        else if (result === 'LOSS') stat.losses += 1;
        else if (result === 'PUSH') stat.pushes += 1;
        stat.total += 1;
      });

    for (const stat of map.values()) {
      stat.winRate = stat.total > 0 ? (stat.wins / stat.total) * 100 : 0;
    }

    return Array.from(map.values()).sort((a, b) => b.winRate - a.winRate);
  })();

  const topTeams = teamStats.filter((t) => t.total >= 2).slice(0, 3);

  // O/U side stats
  const ouSideStats: OuSideStat[] = (() => {
    const base: { [k in 'over' | 'under']: OuSideStat } = {
      over: { side: 'over', wins: 0, losses: 0, pushes: 0, total: 0, winRate: 0 },
      under: { side: 'under', wins: 0, losses: 0, pushes: 0, total: 0, winRate: 0 },
    };

    picks
      .filter((p) => p.pick_type === 'ou')
      .forEach((p) => {
        if (!p.ou_side) return;
        const side = p.ou_side.toLowerCase() as 'over' | 'under';
        const result = getPickResult(p, scores);
        if (!result) return;

        const stat = base[side];
        if (result === 'WIN') stat.wins += 1;
        else if (result === 'LOSS') stat.losses += 1;
        else if (result === 'PUSH') stat.pushes += 1;
        stat.total += 1;
      });

    for (const stat of Object.values(base)) {
      stat.winRate = stat.total > 0 ? (stat.wins / stat.total) * 100 : 0;
    }

    return [base.over, base.under];
  })();

  // Confidence buckets
  const confidenceBuckets: ConfidenceBucket[] = (() => {
    const buckets: ConfidenceBucket[] = [
      { label: '0–20', min: 0, max: 20, wins: 0, losses: 0, pushes: 0, total: 0, winRate: 0 },
      { label: '20–40', min: 20, max: 40, wins: 0, losses: 0, pushes: 0, total: 0, winRate: 0 },
      { label: '40–60', min: 40, max: 60, wins: 0, losses: 0, pushes: 0, total: 0, winRate: 0 },
      { label: '60–80', min: 60, max: 80, wins: 0, losses: 0, pushes: 0, total: 0, winRate: 0 },
      { label: '80–100', min: 80, max: 100.0001, wins: 0, losses: 0, pushes: 0, total: 0, winRate: 0 },
    ];

    picks.forEach((p) => {
      if (p.confidence == null) return;
      const result = getPickResult(p, scores);
      if (!result) return;

      const c = p.confidence;
      const bucket = buckets.find((b) => c >= b.min && c < b.max);
      if (!bucket) return;

      if (result === 'WIN') bucket.wins += 1;
      else if (result === 'LOSS') bucket.losses += 1;
      else if (result === 'PUSH') bucket.pushes += 1;
      bucket.total += 1;
    });

    for (const b of buckets) {
      b.winRate = b.total > 0 ? (b.wins / b.total) * 100 : 0;
    }

    return buckets;
  })();

  /* --------------------------------------------------
     Render
  -------------------------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-xl font-semibold">AI Picks Tracking – Week {week}</h1>

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

      {/* Overall Summary */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-2">Overall Summary (This Week)</h2>
        <p className="text-sm text-zinc-300">
          Total picks:{' '}
          <span className="font-semibold">{overall.total}</span> — Wins:{' '}
          <span className="text-emerald-400 font-semibold">{overall.wins}</span> — Losses:{' '}
          <span className="text-red-400 font-semibold">{overall.losses}</span> — Pushes:{' '}
          <span className="text-zinc-400 font-semibold">{overall.pushes}</span>
        </p>
        <p className="text-sm text-zinc-300 mt-1">
          Hit rate:{' '}
          <span className="font-semibold">
            {overall.total > 0 ? `${overall.winRate.toFixed(1)}%` : '—'}
          </span>
        </p>
      </section>

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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium">AI Picks</h2>
          <button
            onClick={loadScores}
            className="px-3 py-1 border rounded bg-zinc-800 hover:bg-zinc-700 text-xs"
          >
            Refresh Scores
          </button>
        </div>

        {picks.length === 0 ? (
          <p className="text-zinc-400 text-sm">No picks this week.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {picks.map((p) => {
              const result = getPickResult(p, scores);
              const spreadText =
                p.pick_type === 'spread'
                  ? `${(p.recommendation || p.team_short || '').toUpperCase()} ${
                      p.line_or_total ?? ''
                    }`
                  : `${(p.ou_side || '').toUpperCase()} ${p.line_or_total ?? ''}`;

              return (
                <li key={p.id} className="py-2 text-sm flex justify-between items-center">
                  <div>
                    <strong>{p.pick_type.toUpperCase()}</strong> — {spreadText}{' '}
                    ({p.home_short ?? '?'} vs {p.away_short ?? '?'})
                    {p.notes ? <span className="text-xs text-zinc-400"> — {p.notes}</span> : null}
                  </div>
                  {result && (
                    <span
                      className={
                        result === 'WIN'
                          ? 'text-emerald-400'
                          : result === 'LOSS'
                          ? 'text-red-400'
                          : 'text-zinc-400'
                      }
                    >
                      {result}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Analytics */}
      <section className="border rounded p-4 space-y-4">
        <h2 className="text-lg font-medium">Analytics (This Week)</h2>

        {/* Spread vs O/U summaries */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold mb-1">Spread Picks</h3>
            <p className="text-xs text-zinc-300 mb-1">
              {spreadSummary.total > 0 ? (
                <>
                  {spreadSummary.wins}-{spreadSummary.losses}
                  {spreadSummary.pushes ? ` (${spreadSummary.pushes} push)` : ''} —{' '}
                  {spreadSummary.winRate.toFixed(1)}%
                </>
              ) : (
                'No spread picks.'
              )}
            </p>
            {spreadSummary.total > 0 && (
              <div className="h-2 w-full bg-zinc-800 rounded">
                <div
                  className="h-2 rounded bg-emerald-500"
                  style={{ width: `${spreadSummary.winRate}%` }}
                />
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1">O/U Picks</h3>
            <p className="text-xs text-zinc-300 mb-1">
              {ouSummary.total > 0 ? (
                <>
                  {ouSummary.wins}-{ouSummary.losses}
                  {ouSummary.pushes ? ` (${ouSummary.pushes} push)` : ''} —{' '}
                  {ouSummary.winRate.toFixed(1)}%
                </>
              ) : (
                'No O/U picks.'
              )}
            </p>
            {ouSummary.total > 0 && (
              <div className="h-2 w-full bg-zinc-800 rounded">
                <div
                  className="h-2 rounded bg-sky-500"
                  style={{ width: `${ouSummary.winRate}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Top Teams */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Best Teams (Spread, this week)</h3>
          {topTeams.length === 0 ? (
            <p className="text-xs text-zinc-400">
              Not enough data (need ≥ 2 picks per team).
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {topTeams.map((t) => (
                <li key={t.team} className="flex items-center justify-between">
                  <span>
                    {t.team} — {t.wins}-{t.losses}
                    {t.pushes ? ` (${t.pushes} push)` : ''}
                  </span>
                  <span className="text-emerald-400 font-semibold">
                    {t.winRate.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* O/U sides */}
        <div>
          <h3 className="text-sm font-semibold mb-2">O/U Side Performance</h3>
          {ouSideStats.every((s) => s.total === 0) ? (
            <p className="text-xs text-zinc-400">No O/U picks yet.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-3 text-xs">
              {ouSideStats.map((s) => (
                <div key={s.side} className="border border-zinc-800 rounded p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold uppercase">{s.side}</span>
                    <span>
                      {s.wins}-{s.losses}
                      {s.pushes ? ` (${s.pushes} push)` : ''}
                    </span>
                  </div>
                  {s.total > 0 && (
                    <div className="h-2 w-full bg-zinc-800 rounded">
                      <div
                        className="h-2 rounded bg-purple-500"
                        style={{ width: `${s.winRate}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Confidence buckets */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Confidence vs Hit Rate</h3>
          {confidenceBuckets.every((b) => b.total === 0) ? (
            <p className="text-xs text-zinc-400">
              No confidence values recorded yet for this week.
            </p>
          ) : (
            <div className="space-y-2 text-xs">
              {confidenceBuckets.map((b) => (
                <div key={b.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span>{b.label}%</span>
                    <span>
                      {b.total} picks —{' '}
                      {b.total > 0 ? `${b.winRate.toFixed(1)}% hit` : '—'}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-zinc-800 rounded">
                    <div
                      className="h-2 rounded bg-amber-500"
                      style={{ width: `${b.winRate}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
