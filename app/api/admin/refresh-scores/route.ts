import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Minimal, lint-clean admin endpoint for scores.
 * - Validates env
 * - Confirms the week exists
 * - Returns a stub response (no external calls)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

function assertEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE');
  }
}

function readIntParam(req: NextRequest, name: string): number {
  const raw = req.nextUrl.searchParams.get(name);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

async function getWeekId(year: number, week: number): Promise<number> {
  assertEnv();
  const admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE!);

  const { data, error } = await admin
    .from('weeks')
    .select('id')
    .eq('season_year', year)
    .eq('week_number', week)
    .maybeSingle();

  if (error) throw error;

  const id =
    typeof data?.id === 'number'
      ? (data.id as number)
      : Number.isFinite(Number((data as Record<string, unknown> | null)?.id))
      ? Number((data as Record<string, unknown>).id)
      : NaN;

  if (!Number.isFinite(id)) {
    throw new Error(`Week not found for ${year} wk ${week}`);
  }
  return id;
}

export async function POST(req: NextRequest) {
  try {
    const year = readIntParam(req, 'year');
    const week = readIntParam(req, 'week');

    if (!Number.isFinite(year) || !Number.isFinite(week)) {
      return NextResponse.json(
        { error: 'Invalid year or week query param' },
        { status: 400 }
      );
    }

    // Ensure the week exists (and env is valid)
    await getWeekId(year, week);

    // --- PLACEHOLDER FOR REAL IMPLEMENTATION ---
    // When ready: fetch live/final scores and update `games`.
    // For now, just return a stubbed success.
    return NextResponse.json({ updated: 0, note: 'Stubbed scores refresh completed.' });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Unknown error refreshing scores';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
