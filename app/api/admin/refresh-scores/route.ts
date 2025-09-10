import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type WeekRow = { id: number };
type GameRow = { id: number; week_id: number; home_team_id: number; away_team_id: number };
type TeamRow = { id: number; short_name: string; name: string };

type ScoreSide = { name: string; score?: number | string | null };
type ScoreEvent = {
  home_team?: string;
  away_team?: string;
  scores?: ScoreSide[] | null;
  completed?: boolean;
  commence_time?: string;
};

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';
const ODDS_API_KEY = process.env.ODDS_API_KEY ?? '';

const TEAM_NAME_TO_SHORT: Record<string, string> = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

function createAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) throw new Error('Missing Supabase env');
  if (!ODDS_API_KEY) throw new Error('Missing ODDS_API_KEY');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });
}

function toNum(x: unknown): number | null {
  if (typeof x === 'number') return x;
  if (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x))) return Number(x);
  return null;
}

export async function POST(req: Request) {
  try {
    const db = createAdmin();
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const week = Number(searchParams.get('week'));
    if (!year || !week) return new NextResponse('Missing year/week', { status: 400 });

    // Resolve week_id
    const { data: weekRow, error: wErr } = await db
      .from('weeks')
      .select('id, season_id, week_number, seasons!inner(year)')
      .eq('week_number', week)
      .eq('seasons.year', year)
      .maybeSingle();
    if (wErr) throw wErr;
    if (!weekRow?.id) return new NextResponse('Week not found', { status: 404 });
    const weekId = (weekRow as unknown as WeekRow).id;

    // Games + teams
    const { data: games, error: gErr } = await db
      .from('games')
      .select('id, week_id, home_team_id, away_team_id')
      .eq('week_id', weekId);
    if (gErr) throw gErr;
    const gamesArr: GameRow[] = (games ?? []) as unknown as GameRow[];
    if (!gamesArr.length) return NextResponse.json({ updated: 0 });

    const { data: teams, error: tErr } = await db
      .from('teams')
      .select('id, short_name, name');
    if (tErr) throw tErr;
    const byId = new Map<number, TeamRow>();
    for (const t of (teams ?? []) as TeamRow[]) byId.set(t.id, t);

    const pairToId = new Map<string, number>();
    for (const g of gamesArr) {
      const h = byId.get(g.home_team_id)?.short_name ?? '';
      const a = byId.get(g.away_team_id)?.short_name ?? '';
      if (h && a) pairToId.set(`${h}-${a}`, g.id);
    }

    // Fetch Odds API scores (past few days)
    const url = new URL('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/scores/');
    url.searchParams.set('apiKey', ODDS_API_KEY);
    url.searchParams.set('daysFrom', '7');       // adjust if needed
    url.searchParams.set('dateFormat', 'iso');

    const resp = await fetch(url.toString(), { cache: 'no-store' });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Scores API ${resp.status}: ${txt}`);
    }
    const events = (await resp.json()) as unknown as ScoreEvent[];

    let updates = 0;

    for (const ev of events) {
      const homeShort = TEAM_NAME_TO_SHORT[ev.home_team ?? ''] ?? '';
      const awayShort = TEAM_NAME_TO_SHORT[ev.away_team ?? ''] ?? '';
      if (!homeShort || !awayShort) continue;

      const gameId = pairToId.get(`${homeShort}-${awayShort}`);
      if (!gameId) continue;

      const sA = (ev.scores ?? []).find((s) => TEAM_NAME_TO_SHORT[s.name ?? ''] === homeShort) ?? null;
      const sB = (ev.scores ?? []).find((s) => TEAM_NAME_TO_SHORT[s.name ?? ''] === awayShort) ?? null;

      const home = toNum(sA?.score);
      const away = toNum(sB?.score);
      const completed = Boolean(ev.completed);

      if (home == null || away == null) continue;

      if (completed) {
        const { error } = await db
          .from('games')
          .update({
            home_score: home,
            away_score: away,
            is_final: true,
            is_live: false,
            live_home_score: null,
            live_away_score: null,
            live_updated_at: new Date().toISOString(),
          })
          .eq('id', gameId);
        if (error) throw error;
      } else {
        const { error } = await db
          .from('games')
          .update({
            live_home_score: home,
            live_away_score: away,
            is_live: true,
            live_updated_at: new Date().toISOString(),
          })
          .eq('id', gameId);
        if (error) throw error;
      }
      updates++;
    }

    return NextResponse.json({ updated: updates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(msg, { status: 500 });
  }
}
