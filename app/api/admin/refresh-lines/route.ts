/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * Minimal env + helpers
 */
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

function bad(status: number, message: string) {
  return new NextResponse(message, { status });
}
function okJSON(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Get week_id via weeks(season_year, week_number)
 */
async function getWeekId(supabaseAdmin: any, year: number, week: number): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('weeks')
    .select('id')
    .eq('season_year', year)
    .eq('week_number', week)
    .maybeSingle();

  if (error) throw error;
  const id = typeof data?.id === 'number' ? data.id : null;
  if (!id) throw new Error(`Week not found for ${year} wk ${week}`);
  return id;
}

/**
 * Load games for a week and basic team lookup maps
 */
async function loadWeekGames(
  supabaseAdmin: any,
  weekId: number
): Promise<{ games: { id: number; home_team_id: number; away_team_id: number }[]; teamsById: Map<number, { id: number; name: string; short_name: string }> }> {
  const { data: games, error: gErr } = await supabaseAdmin
    .from('games')
    .select('id,home_team_id,away_team_id')
    .eq('week_id', weekId);

  if (gErr) throw gErr;

  const teamIds = new Set<number>();
  for (const g of (games ?? []) as unknown[]) {
    const id = typeof (g as any)?.id === 'number' ? (g as any).id : null;
    const h = typeof (g as any)?.home_team_id === 'number' ? (g as any).home_team_id : null;
    const a = typeof (g as any)?.away_team_id === 'number' ? (g as any).away_team_id : null;
    if (h != null) teamIds.add(h);
    if (a != null) teamIds.add(a);
  }

  let teamsById = new Map<number, { id: number; name: string; short_name: string }>();
  if (teamIds.size) {
    const ids = Array.from(teamIds);
    const { data: teams, error: tErr } = await supabaseAdmin
      .from('teams')
      .select('id,name,short_name')
      .in('id', ids);

    if (tErr) throw tErr;
    (teams ?? []).forEach((t: any) => {
      if (typeof t?.id === 'number') {
        teamsById.set(t.id, {
          id: t.id,
          name: String(t?.name ?? ''),
          short_name: String(t?.short_name ?? ''),
        });
      }
    });
  }

  const safeGames = (games ?? []).map((g: any) => ({
    id: Number(g?.id ?? 0),
    home_team_id: Number(g?.home_team_id ?? 0),
    away_team_id: Number(g?.away_team_id ?? 0),
  }));

  return { games: safeGames, teamsById };
}

/**
 * POST /api/admin/refresh-lines?year=YYYY&week=#
 * - If ODDS_API_KEY is missing, we return 501 (skipped).
 * - Otherwise this is where you’d fetch the bookmaker lines and upsert to `game_lines`.
 *   (Left as a stub so your build succeeds until you turn the API back on.)
 */
export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return bad(500, 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE.');
    }

    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year') ?? '0');
    const week = Number(url.searchParams.get('week') ?? '0');
    if (!year || !week) return bad(400, 'Missing or invalid year/week.');

    // Short-circuit while you’re not using your paid API quota
    if (!ODDS_API_KEY) {
      return okJSON(
        { skipped: true, reason: 'ODDS_API_KEY not set. Lines refresh skipped.', updated: 0 },
        501
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // We keep this in so that once you add the API call, you’re ready to go:
    const weekId = await getWeekId(supabaseAdmin, year, week);
    const { games, teamsById } = await loadWeekGames(supabaseAdmin, weekId);

    // TODO: call The Odds API here, match teams, then upsert into `game_lines`
    // Example shape for upsert:
    // const upserts = games.map(g => ({
    //   game_id: g.id,
    //   fav_team_id: <team id>,
    //   spread: <number>,
    //   total: <number>,
    //   source: 'draftkings',
    // }));
    // await supabaseAdmin.from('game_lines').upsert(upserts, { onConflict: 'game_id' });

    return okJSON({ updated: 0, note: 'Stubbed refresh completed (no external calls made).' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return bad(500, msg);
  }
}
