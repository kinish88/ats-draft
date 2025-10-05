'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/** Adjust if you ever change the season in the DB */
const YEAR = 2025;

/* ----------------------------- Types & utils ----------------------------- */

type PickRpcRow = {
  // shape returned by get_week_picks
  pick_id?: unknown;
  season_year?: unknown;
  week_number?: unknown;
  player?: unknown;
  home_short?: unknown;
  away_short?: unknown;
  picked_team_short?: unknown;
  line_at_pick?: unknown; // signed line for picked team
};

type ScoreRpcRow = {
  // shape returned by get_week_games_for_scoring
  game_id?: unknown;
  home?: unknown;        // team short
  away?: unknown;        // team short
  home_score?: unknown;  // number | null
  away_score?: unknown;  // number | null
};

type SpreadPick = {
  player: string;
  home: string;
  away: string;
  teamPicked: string;        // team short
  signedLine: number | null; // signed for the team picked
};

type GameScore = {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
};

type Totals = {
  weeksWon: number;
  w: number;
  l: number;
  pu: number;
};

function toStr(x: unknown, fb = ''): string {
  return typeof x === 'string' ? x : x == null ? fb : String(x);
}
function toNumOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}
function keyPair(a: string, b: string) {
  return `${a}__${b}`.toUpperCase();
}

function outcomeForPick(p: SpreadPick, g: GameScore | undefined): 'W' | 'L' | 'PU' | 'PENDING' {
  if (!g) return 'PENDING';
  if (g.homeScore == null || g.awayScore == null) return 'PENDING';
  if (p.signedLine == null) return 'PENDING';

  const pickIsHome = p.teamPicked.toUpperCase() === g.home.toUpperCase();
  const pickScore = pickIsHome ? g.homeScore : g.awayScore;
  const oppScore = pickIsHome ? g.awayScore : g.homeScore;

  const adj = pickScore + p.signedLine;
  if (adj > oppScore) return 'W';
  if (adj < oppScore) return 'L';
  return 'PU';
}

/* ------------------------------- Component ------------------------------- */

export default function StandingsPage() {
  const [loading, setLoading] = useState(true);
  const [throughWeek, setThroughWeek] = useState<number>(0);

  // ordered display names for rows
  const players = useMemo(() => ['Big Dawg', 'Pud', 'Kinish'] as const, []);

  const [totals, setTotals] = useState<Record<string, Totals>>(() =>
    Object.fromEntries(players.map((p) => [p, { weeksWon: 0, w: 0, l: 0, pu: 0 }]))
  );

  useEffect(() => {
    (async () => {
      setLoading(true);

      // We’ll iterate weeks 1..18 and include only weeks that are fully scorable:
      // - 3 spread picks exist (one per player),
      // - all 3 picked games have both scores present.
      const maxWeeks = 18;
      let lastCompleteWeek = 0;

      // fresh accumulator
      const acc: Record<string, Totals> = Object.fromEntries(
        players.map((p) => [p, { weeksWon: 0, w: 0, l: 0, pu: 0 }])
      );

      for (let wk = 1; wk <= maxWeeks; wk++) {
        // Get spread picks for the week
        const { data: pickRaw, error: pickErr } = await supabase.rpc('get_week_picks', {
          p_year: YEAR,
          p_week: wk,
        });

        if (pickErr) {
          // If the RPC errors, just skip this week quietly
          // (keeps page resilient to schema tweaks)
          continue;
        }

        const pickArr: PickRpcRow[] = Array.isArray(pickRaw) ? (pickRaw as PickRpcRow[]) : [];
        // Only keep spread picks (those have picked_team_short)
        const spreadPicks: SpreadPick[] = pickArr
          .filter((r) => toStr(r.picked_team_short, '') !== '')
          .map((r) => ({
            player: toStr(r.player),
            home: toStr(r.home_short),
            away: toStr(r.away_short),
            teamPicked: toStr(r.picked_team_short),
            signedLine: toNumOrNull(r.line_at_pick),
          }));

        // We need exactly 3 spread picks for the week to consider it
        if (spreadPicks.length !== 3) {
          continue;
        }

        // Pull scored games for the week
        const { data: scoreRaw, error: scoreErr } = await supabase.rpc('get_week_games_for_scoring', {
          p_year: YEAR,
          p_week: wk,
        });
        if (scoreErr) continue;

        const scoreArr: ScoreRpcRow[] = Array.isArray(scoreRaw) ? (scoreRaw as ScoreRpcRow[]) : [];
        const byPair = new Map<string, GameScore>();
        for (const r of scoreArr) {
          const home = toStr(r.home);
          const away = toStr(r.away);
          byPair.set(keyPair(home, away), {
            home,
            away,
            homeScore: toNumOrNull(r.home_score),
            awayScore: toNumOrNull(r.away_score),
          });
        }

        // Make sure all 3 picked games have a score (both sides) => fully scorable week
        let fullyScorable = true;
        for (const p of spreadPicks) {
          const g = byPair.get(keyPair(p.home, p.away));
          if (!g || g.homeScore == null || g.awayScore == null) {
            fullyScorable = false;
            break;
          }
        }
        if (!fullyScorable) continue;

        // Compute outcomes for the week
        const weekOutcomes = new Map<string, Array<'W' | 'L' | 'PU'>>(
          players.map((p) => [p, [] as Array<'W' | 'L' | 'PU'>])
        );

        for (const p of spreadPicks) {
          const g = byPair.get(keyPair(p.home, p.away));
          const o = outcomeForPick(p, g);
          if (o === 'PENDING') {
            // Shouldn't happen since we gated on fullyScorable, but be safe
            continue;
          }
          const list = weekOutcomes.get(p.player) ?? [];
          list.push(o);
          weekOutcomes.set(p.player, list);
        }

        // Tally into season totals
        for (const name of players) {
          const list = weekOutcomes.get(name) ?? [];
          for (const o of list) {
            if (o === 'W') acc[name].w += 1;
            else if (o === 'L') acc[name].l += 1;
            else acc[name].pu += 1;
          }
        }

        // Award Week Win (3–0 only)
        for (const name of players) {
          const list = weekOutcomes.get(name) ?? [];
          if (list.length === 3 && list.every((o) => o === 'W')) {
            acc[name].weeksWon += 1;
          }
        }

        lastCompleteWeek = wk; // we made it this far fully scored
      }

      setTotals(acc);
      setThroughWeek(lastCompleteWeek);
      setLoading(false);
    })();
  }, [players]);

  /* ------------------------------- Render -------------------------------- */

  function winPctFor(t: Totals): string {
    const denom = t.w + t.l + t.pu; // pushes treated as losses
    if (denom === 0) return '0.0%';
    return `${((t.w / denom) * 100).toFixed(1)}%`;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Season Standings</h1>
        <div className="text-zinc-400">Through Week {throughWeek || 1}</div>
      </header>

      <section className="border rounded overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[1.2fr,0.8fr,0.6fr,0.6fr,0.6fr,0.8fr] bg-zinc-900/60 text-xs px-3 py-2 border-b">
          <div className="tracking-wide">PLAYER</div>
          <div className="text-right">WEEK WINS</div>
          <div className="text-right">ATS W</div>
          <div className="text-right">ATS L</div>
          <div className="text-right">ATS PU</div>
          <div className="text-right">WIN %</div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-zinc-800/60">
          {players.map((name) => {
            const t = totals[name] || { weeksWon: 0, w: 0, l: 0, pu: 0 };
            return (
              <div key={name} className="grid grid-cols-[1.2fr,0.8fr,0.6fr,0.6fr,0.6fr,0.8fr] px-3 py-3">
                <div className="font-semibold">{name}</div>
                <div className="text-right tabular-nums">{t.weeksWon}</div>
                <div className="text-right tabular-nums">{t.w}</div>
                <div className="text-right tabular-nums">{t.l}</div>
                <div className="text-right tabular-nums">{t.pu}</div>
                <div className="text-right tabular-nums">{winPctFor(t)}</div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-sm text-zinc-400">Win% treats pushes as losses.</p>

      {loading && <div className="text-sm text-zinc-400">Loading…</div>}
    </div>
  );
}
