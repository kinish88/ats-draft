/* Refresh final/live scores for a given NFL week.
   Updates public.games(home_score, away_score, is_final, is_live) from The Odds API. */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/* ----------------------------- Environment ----------------------------- */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE as string | undefined;
const ODDS_API_KEY = process.env.ODDS_API_KEY as string | undefined;

function assertEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE');
  }
  if (!ODDS_API_KEY) {
    throw new Error('Missing ODDS_API_KEY');
  }
}

/* ------------------------------- Types -------------------------------- */

type TeamRow = { id: number; name: string; short_name: string };

type GameRow = {
  game_id: number;
  home_name: string;
  home_short: string;
  away_name: string;
  away_short: string;
};

type ScoreEntry = { name: string; score: number | string };

type ScoresEvent = {
  id: string;
  home_team: string; // full name
  away_team: string; // full name
  commence_time: string;
  completed: boolean;
  scores?: ScoreEntry[]; // [{ name: 'Buffalo Bills', score: 24 }, ...]
};

/* ------------------------------ Helpers ------------------------------- */

function norm(s: string): string {
  return s.trim().toUpperCase();
}

function keyPair(a: string, b: string): string {
  const A = norm(a);
  const B = norm(b);
  return A < B ? `${A}|${B}` : `${B}|${A}`;
}

/* ---------------------------- Supabase bits ---------------------------- */
/* Use `any` for the client param to avoid TS generic mismatches in Vercel. */

async function getWeekId(supabaseAdmin: any, year: number, week: number): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('weeks')
    .select('id')
    .eq('season_year', year)
    .eq('week_number', week)
    .maybeSingle();

  const row = data as { id: number } | null;

  if (error) throw error;
  if (!row || typeof row.id !== 'number') {
    throw new Error(`Week not found for ${year} wk ${week}`);
  }
  return row.id;
}

async function loadWeekGames(supabaseAdmin: any, weekId: number): Promise<GameRow[]> {
  const { data: teams, error: tErr } = await supabaseAdmin
    .from('teams')
    .select('id,name,short_name')
    .returns<TeamRow[]>();
  if (tErr) throw tErr;

  const byId = new Map<number, TeamRow>();
  (teams ?? []).forEach((t) => byId.set(t.id, { id: t.id, name: t.name, short_name: t.short_name }));

  type GameDB = { id: number; home_team_id: number; away_team_id: number };
  const { data: rows, error } = await supabaseAdmin
    .from('games')
    .select('id, home_team_id, away_team_id')
    .eq('week_id', weekId)
    .returns<GameDB[]>();
  if (error) throw error;

  return (rows ?? []).map((r) => {
    const h = byId.get(r.home_team_id);
    const a = byId.get(r.away_team_id);
    return {
      game_id: r.id,
      home_name: h?.name ?? '',
      home_short: h?.short_name ?? '',
      away_name: a?.name ?? '',
      away_short: a?.short_name ?? '',
    };
  });
}

/* ------------------------------ Handler ------------------------------- */

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    assertEnv();

    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year') ?? '2025');
    the
    const week = Number(url.searchParams.get('week') ?? '1');

    const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE!);

    const weekId = await getWeekId(supabaseAdmin, year, week);
    const games = await loadWeekGames(supabaseAdmin, weekId);

    if (!games.length) {
      return NextResponse.json({ updated: 0, message: 'No games for this week' });
    }

    const byPair = new Map<string, GameRow>();
    for (const g of games) byPair.set(keyPair(g.home_name, g.away_name), g);

    // Get scores window
    const params = new URLSearchParams({
      apiKey: ODDS_API_KEY!,
      dateFormat: 'iso',
      daysFrom: '14',
    });

    const resp = await fetch(
      `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/scores?${params.toString()}`,
      { method: 'GET', headers: { Accept: 'application/json' } }
    );

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: 'Scores API error', detail: text }, { status: 502 });
    }

    const events = (await resp.json()) as ScoresEvent[];

    type UpdateRow = {
      id: number;            // games.id
      home_score: number | null;
      away_score: number | null;
      is_final: boolean;
      is_live: boolean;
    };

    const updates: UpdateRow[] = [];

    for (const ev of events) {
      const gm = byPair.get(keyPair(ev.home_team, ev.away_team));
      if (!gm) continue;

      let homeScore: number | null = null;
      let awayScore: number | null = null;

      if (Array.isArray(ev.scores) && ev.scores.length >= 2) {
        const h = ev.scores.find((s) => norm(String(s.name)) === norm(ev.home_team));
        const a = ev.scores.find((s) => norm(String(s.name)) === norm(ev.away_team));

        const hs = h?.score;
        const as = a?.score;

        const hv = typeof hs === 'number' ? hs : hs != null ? Number(hs) : null;
        const av = typeof as === 'number' ? as : as != null ? Number(as) : null;

        homeScore = Number.isFinite(hv as number) ? (hv as number) : null;
        awayScore = Number.isFinite(av as number) ? (av as number) : null;
      }

      const isFinal = Boolean(ev.completed);
      const isLive = !isFinal && (homeScore != null || awayScore != null);

      if (homeScore != null || awayScore != null || isFinal) {
        updates.push({
          id: (gm as GameRow).game_id,
          home_score: homeScore,
          away_score: awayScore,
          is_final: isFinal,
          is_live: isLive,
        });
      }
    }

    if (!updates.length) {
      return NextResponse.json({ updated: 0, message: 'No score updates' });
    }

    // Apply updates
    let count = 0;
    for (const u of updates) {
      const { error } = await supabaseAdmin
        .from('games')
        .update({
          home_score: u.home_score,
          away_score: u.away_score,
          is_final: u.is_final,
          is_live: u.is_live,
          live_home_score: u.is_live ? u.home_score : null,
          live_away_score: u.is_live ? u.away_score : null,
          live_updated_at: new Date().toISOString(),
        })
        .eq('id', u.id);

      if (!error) count += 1;
    }

    return NextResponse.json({ updated: count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
