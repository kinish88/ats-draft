'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getTeamLogoUrl } from '@/lib/logos';

const ALL_SEASONS = [2025, 2026];
const PLAYERS: readonly string[] = ['Big Dawg', 'Pud', 'Kinish'] as const;

type SpreadPick = { player_display_name: string; team_short: string; spread_at_pick: number | null; home_short: string; away_short: string; week_id: number; week_number: number; game_id: number | null; };
type OuPick = { player_display_name: string; home_short: string; away_short: string; ou_choice: 'OVER' | 'UNDER'; ou_total: number; week_id: number; week_number: number; };
type GameRow = { id: number; home: string; away: string; home_score: number | null; away_score: number | null; is_final: boolean | null; };
type Outcome = 'win' | 'loss' | 'push' | 'pending';
type WeekResult = { week_number: number; picks: SpreadPick[]; ouPick: OuPick | null; spreadOutcomes: Outcome[]; ouOutcome: Outcome; weekWin: boolean; };

function numOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}
function norm(s: string) { return s.trim().toLowerCase(); }
function signed(n: number | null): string { if (!n) return ''; return n > 0 ? `+${n}` : `${n}`; }

function outcomeATS(game: GameRow | undefined, pickedTeam: string, homeShort: string, spread: number | null): Outcome {
  if (!game || game.home_score == null || game.away_score == null) return 'pending';
  if (spread == null) return 'pending';
  const pickIsHome = norm(pickedTeam) === norm(homeShort);
  const pickScore = pickIsHome ? game.home_score : game.away_score;
  const oppScore = pickIsHome ? game.away_score : game.home_score;
  const adj = (pickScore ?? 0) + spread;
  if (adj > (oppScore ?? 0)) return 'win';
  if (adj < (oppScore ?? 0)) return 'loss';
  return 'push';
}
function outcomeOU(game: GameRow | undefined, choice: 'OVER' | 'UNDER', total: number): Outcome {
  if (!game || game.home_score == null || game.away_score == null) return 'pending';
  const sum = game.home_score + game.away_score;
  if (sum === total) return 'push';
  if (choice === 'OVER') return sum > total ? 'win' : 'loss';
  return sum < total ? 'win' : 'loss';
}

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const cls = outcome === 'win' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' : outcome === 'loss' ? 'text-rose-400 border-rose-500/40 bg-rose-500/10' : outcome === 'push' ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-zinc-500 border-zinc-700';
  const label = outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : outcome === 'push' ? 'P' : '—';
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

export default function HistoryPage() {
  const [season, setSeason] = useState(2025);
  const [loading, setLoading] = useState(true);
  const [spreadPicks, setSpreadPicks] = useState<SpreadPick[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPick[]>([]);
  const [games, setGames] = useState<Map<number, GameRow>>(new Map());
  const [weekNumbers, setWeekNumbers] = useState<Map<number, number>>(new Map()); // week_id -> week_number

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Spread picks
      const { data: sp } = await supabase
        .from('picks')
        .select('player_display_name, team_short, spread_at_pick, home_short, away_short, week_id, game_id')
        .eq('season_year', season);
      const spArr = Array.isArray(sp) ? sp : [];

      // Fetch week numbers for all week_ids
      const weekIds = Array.from(new Set(spArr.map((r: Record<string, unknown>) => Number(r.week_id)).filter(Boolean)));
      let weekNumMap = new Map<number, number>();
      if (weekIds.length) {
        const { data: wData } = await supabase.from('weeks').select('id, week_number').in('id', weekIds);
        for (const w of (wData ?? []) as { id: number; week_number: number }[]) {
          weekNumMap.set(w.id, w.week_number);
        }
      }
      setWeekNumbers(weekNumMap);

      const mappedSp: SpreadPick[] = spArr.map((r: Record<string, unknown>) => ({
        player_display_name: String(r.player_display_name ?? ''),
        team_short: String(r.team_short ?? ''),
        spread_at_pick: numOrNull(r.spread_at_pick),
        home_short: String(r.home_short ?? ''),
        away_short: String(r.away_short ?? ''),
        week_id: Number(r.week_id ?? 0),
        week_number: weekNumMap.get(Number(r.week_id ?? 0)) ?? 0,
        game_id: numOrNull(r.game_id),
      }));
      setSpreadPicks(mappedSp);

      // O/U picks — via admin RPC for all weeks
      const allOu: OuPick[] = [];
      for (const [wid, wnum] of weekNumMap.entries()) {
        const { data: ou } = await supabase.rpc('get_week_ou_picks_admin', { p_year: season, p_week: wnum });
        for (const r of (ou ?? []) as Record<string, unknown>[]) {
          const side = String(r.pick_side ?? '').toUpperCase();
          allOu.push({
            player_display_name: String(r.player ?? ''),
            home_short: String(r.home_short ?? ''),
            away_short: String(r.away_short ?? ''),
            ou_choice: side === 'UNDER' ? 'UNDER' : 'OVER',
            ou_total: numOrNull(r.total_at_pick) ?? 0,
            week_id: wid,
            week_number: wnum,
          });
        }
      }
      setOuPicks(allOu);

      // Games
      const gameIds = Array.from(new Set(mappedSp.map(p => p.game_id).filter((id): id is number => id != null)));
      if (gameIds.length) {
        const { data: gData } = await supabase.from('games').select('id, home_score, away_score, is_final').in('id', gameIds);
        // Need home/away shorts — join via picks
        const gameMap = new Map<number, GameRow>();
        for (const g of (gData ?? []) as Record<string, unknown>[]) {
          const id = Number(g.id ?? 0);
          // Find home/away from a pick referencing this game
          const pick = mappedSp.find(p => p.game_id === id);
          gameMap.set(id, {
            id,
            home: pick?.home_short ?? '',
            away: pick?.away_short ?? '',
            home_score: numOrNull(g.home_score),
            away_score: numOrNull(g.away_score),
            is_final: typeof g.is_final === 'boolean' ? g.is_final : null,
          });
        }
        setGames(gameMap);
      } else {
        setGames(new Map());
      }

      setLoading(false);
    })();
  }, [season]);

  // Compute per-player, per-week results
  const playerResults = useMemo(() => {
    const result: Record<string, { weeks: WeekResult[]; totalWeekWins: number; w: number; l: number; pu: number }> = {};
    for (const name of PLAYERS) {
      const mySpread = spreadPicks.filter(p => norm(p.player_display_name) === norm(name));
      const myOu = ouPicks.filter(p => norm(p.player_display_name) === norm(name));
      const weekNums = Array.from(new Set(mySpread.map(p => p.week_number))).sort((a, b) => a - b);

      let totalW = 0, totalL = 0, totalPu = 0, totalWeekWins = 0;
      const weeks: WeekResult[] = weekNums.map(wn => {
        const wPicks = mySpread.filter(p => p.week_number === wn);
        const ouPick = myOu.find(p => p.week_number === wn) ?? null;
        const spreadOutcomes: Outcome[] = wPicks.map(p => {
          const g = p.game_id ? games.get(p.game_id) : undefined;
          return outcomeATS(g, p.team_short, p.home_short, p.spread_at_pick);
        });
        const ouOutcome: Outcome = ouPick ? (() => {
          // find matching game for OU
          const g = mySpread.find(p => p.week_number === wn && norm(p.home_short) === norm(ouPick.home_short) && norm(p.away_short) === norm(ouPick.away_short));
          const game = g?.game_id ? games.get(g.game_id) : undefined;
          return outcomeOU(game, ouPick.ou_choice, ouPick.ou_total);
        })() : 'pending';

        for (const o of spreadOutcomes) {
          if (o === 'win') totalW++;
          else if (o === 'loss') totalL++;
          else if (o === 'push') totalPu++;
        }

        const weekWin = spreadOutcomes.length === 3 && spreadOutcomes.every(o => o === 'win');
        if (weekWin) totalWeekWins++;
        return { week_number: wn, picks: wPicks, ouPick, spreadOutcomes, ouOutcome, weekWin };
      });

      result[name] = { weeks, totalWeekWins, w: totalW, l: totalL, pu: totalPu };
    }
    return result;
  }, [spreadPicks, ouPicks, games]);

  const winner = useMemo(() => {
    let best: string | null = null;
    let bestWins = -1;
    for (const name of PLAYERS) {
      const ww = playerResults[name]?.totalWeekWins ?? 0;
      if (ww > bestWins) { bestWins = ww; best = name; }
    }
    return bestWins > 0 ? best : null;
  }, [playerResults]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Season History</h1>
          <p className="text-sm text-zinc-400 mt-1">Full season results, picks, and standings</p>
        </div>
        <div className="flex gap-2">
          {ALL_SEASONS.map(y => (
            <button key={y} onClick={() => setSeason(y)} className={`px-4 py-1.5 rounded-full border text-sm font-medium transition ${season === y ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200' : 'border-white/15 text-white/60 hover:border-white/30 hover:text-white/90'}`}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {winner && (
        <div className="rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-6 py-4 flex items-center gap-3">
          <span className="text-2xl">🏆</span>
          <div>
            <div className="text-yellow-200 font-semibold text-lg">{winner} — {season} Champion</div>
            <div className="text-yellow-300/70 text-sm">{playerResults[winner]?.totalWeekWins} week wins</div>
          </div>
        </div>
      )}

      {/* Standings summary */}
      <section>
        <h2 className="text-lg font-medium mb-3">Standings</h2>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50">
          <table className="w-full table-auto text-sm">
            <thead className="bg-slate-900/70 text-zinc-300">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Player</th>
                <th className="px-4 py-3 text-right font-medium">Week Wins</th>
                <th className="px-4 py-3 text-right font-medium">ATS W</th>
                <th className="px-4 py-3 text-right font-medium">ATS L</th>
                <th className="px-4 py-3 text-right font-medium">ATS P</th>
                <th className="px-4 py-3 text-right font-medium">Win %</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-sm text-zinc-400">Loading…</td></tr>
              ) : (
                PLAYERS.map(name => {
                  const r = playerResults[name];
                  const total = (r?.w ?? 0) + (r?.l ?? 0) + (r?.pu ?? 0);
                  const pct = total > 0 ? `${(((r?.w ?? 0) / total) * 100).toFixed(1)}%` : '—';
                  const isChamp = name === winner;
                  return (
                    <tr key={name} className={`border-t border-white/5 text-zinc-100 ${isChamp ? 'bg-yellow-500/5' : 'hover:bg-white/5'}`}>
                      <td className="px-4 py-3 font-semibold flex items-center gap-2">{isChamp && <span>🏆</span>}{name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r?.totalWeekWins ?? 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r?.w ?? 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r?.l ?? 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r?.pu ?? 0}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{pct}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-player week breakdown */}
      {!loading && PLAYERS.map(name => {
        const r = playerResults[name];
        if (!r || r.weeks.length === 0) return null;
        return (
          <section key={name}>
            <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
              {name === winner && <span>🏆</span>}
              {name}
              <span className="text-sm font-normal text-zinc-400">· {r.totalWeekWins} week wins · {r.w}W {r.l}L {r.pu}P</span>
            </h2>
            <div className="space-y-2">
              {r.weeks.map(wk => (
                <div key={wk.week_number} className={`rounded-xl border px-4 py-3 ${wk.weekWin ? 'border-emerald-400/40 bg-emerald-500/5' : 'border-white/10 bg-white/[0.02]'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-white">
                      Week {wk.week_number}
                      {wk.weekWin && <span className="ml-2 text-xs text-emerald-400 font-bold">✓ WIN</span>}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {wk.picks.map((p, i) => {
                      const logo = getTeamLogoUrl(p.team_short);
                      return (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            {logo && <img src={logo} alt={p.team_short} className="w-4 h-4 rounded-sm" />}
                            <span className="font-medium text-white">{p.team_short}</span>
                            <span className="text-zinc-400 text-xs">{signed(p.spread_at_pick)} · {p.away_short} @ {p.home_short}</span>
                          </div>
                          <OutcomeBadge outcome={wk.spreadOutcomes[i] ?? 'pending'} />
                        </div>
                      );
                    })}
                    {wk.ouPick && (
                      <div className="flex items-center justify-between text-sm pt-1 border-t border-white/5 mt-1">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-400 text-xs">O/U</span>
                          <span className="font-medium text-white">{wk.ouPick.ou_choice} {wk.ouPick.ou_total}</span>
                          <span className="text-zinc-400 text-xs">{wk.ouPick.away_short} @ {wk.ouPick.home_short}</span>
                        </div>
                        <OutcomeBadge outcome={wk.ouOutcome} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {!loading && PLAYERS.every(name => !playerResults[name]?.weeks.length) && (
        <div className="text-zinc-400 text-sm">No picks found for the {season} season.</div>
      )}
    </div>
  );
}
