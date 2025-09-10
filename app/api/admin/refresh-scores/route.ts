/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';

function bad(status: number, message: string) {
  return new NextResponse(message, { status });
}
function okJSON(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

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
 * POST /api/admin/refresh-scores?year=YYYY&week=#
 * For now this endpoint just exists and returns a stubbed response so your build succeeds.
 * When you’re ready to wire a scores provider, do it here and update the `games` table.
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

    // Ready for future: fetch scores and update games.home_score/away_score/is_final/is_live
    // For now, just prove the route works:
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const weekId = await getWeekId(supabaseAdmin, year, week);

    return okJSON({ updated: 0, note: 'Stubbed scores refresh completed.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return bad(500, msg);
  }
}
