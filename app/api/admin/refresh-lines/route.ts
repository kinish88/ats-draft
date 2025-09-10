import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Minimal types (no `any`) */
type TeamRow = { id: number; short_name: string; name: string };
type WeekRow = { id: number; season_id: number; week_number: number };
type GameRow = { id: number; week_id: number; home_team_id: number; away_team_id: number };

/** Odds API — minimal shapes */
type OddsOutcome = { name: string; point?: number | null };
type OddsMarket = { key: string; outcomes?: OddsOutcome[] | null };
type OddsBookmaker = { key: string; markets?: OddsMarket[] | null };
type OddsEvent = {
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsBookmaker[] | null;
};

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? '';
const ODDS_API_KEY = process.env.ODDS_API_KEY ?? '';

/** Map provider team names -> your short codes */
const TEAM_NAME_TO_SHORT: Record<string, string> = {
  'Arizona Cardinals': 'ARI',
  'Atlanta Falcons': 'ATL',
  'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR',
  'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN',
  'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN',
  'Detroit Lions': 'DET',
  'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU',
  'Indianapolis Colts': 'IND',
  'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV',
  'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR',
  'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE',
  'New Orleans Saints': 'NO',
  'New York Giants': 'NYG',
  'New York Jets': 'NYJ',
  'Philadelphia Eagles': 'PHI',
  'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA',
  'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN',
  'Washington Commanders': 'WAS',
};

function assertEnv(): asserts ODDS_API_KEY is string {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE');
  }
  if (!ODDS_API_KEY) throw new Error('Missing ODDS_API_KEY');
}

function createAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

function first<T>(arr: T[] | null | undefined): T | null {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

export async function POST(req: Request) {
  try {
    assertEnv();
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const week = Number(searchParams.get('week'));
    const bookmaker = (searchParams.get('bookmaker') || 'skybet').toLowerCase();
    if (!year || !week) return new NextResponse('Missing year/week', { status: 400 });

    const db = createAdmin();

    // 1) Resolve week_id
    const { data: weekRow, error: wErr } = await db
      .from('weeks')
      .select('id, season_id, week_number, seasons!inner(year)')
      .eq('week_number', week)
      .eq('seasons.year', year)
      .maybeSingle();
    if (wErr) throw wErr;
    if (!weekRow?.id) return new NextResponse('Week not found', { status: 404 });
    const weekId = (weekRow as unknown as WeekRow).id;

    // 2) Load games for that week
    const { data: games, error: gErr } = await db
      .from('games')
      .select('id, week_id, home_team_id, away_team_id')
      .eq('week_id', weekId);
    if (gErr) throw gErr;
    const gamesArr: GameRow[] = (games ?? []) as unknown as GameRow[];
    if (!gamesArr.length) return NextResponse.json({ updated: 0 });

    // 3) Teams map (id -> short & name)
    const { data: teams, error: tErr } = await db
      .from('teams')
      .select('id, short_name, name');
    if (tErr) throw tErr;
    const byId = new Map<number, TeamRow>();
    const byShort = new Map<string, TeamRow>();
    for (const r of (teams ?? []) as TeamRow[]) {
      byId.set(r.id, r);
      byShort.set(r.short_name.toUpperCase(), r);
    }

    // 4) Build lookup for game by short pair
    const gameByPair = new Map<string, GameRow>();
    for (const g of gamesArr) {
      const home = byId.get(g.home_team_id)?.short_name ?? '';
      const away = byId.get(g.away_team_id)?.short_name ?? '';
      if (!home || !away) continue;
      gameByPair.set(`${home}-${away}`, g);
    }

    // 5) Fetch Odds API — only the book/markets we need
    const url = new URL('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/');
    url.searchParams.set('apiKey', ODDS_API_KEY);
    url.searchParams.set('regions', 'uk');
    url.searchParams.set('markets', 'spreads,totals');
    url.searchParams.set('bookmakers', bookmaker);
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('dateFormat', 'iso');

    const resp = await fetch(url.toString(), { cache: 'no-store' });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Odds API ${resp.status}: ${txt}`);
    }
    const events = (await resp.json()) as unknown as OddsEvent[];

    // 6) Parse & upsert
    let upserts: Array<{ game_id: number; fav_team_id: number | null; spread: number | null; total: number | null; source: string }> = [];

    for (const ev of events) {
      const bk = first(ev.bookmakers) as OddsBookmaker | null;
      if (!bk) continue;

      const homeName = ev.home_team ?? '';
      const awayName = ev.away_team ?? '';
      const homeShort = TEAM_NAME_TO_SHORT[homeName] ?? '';
      const awayShort = TEAM_NAME_TO_SHORT[awayName] ?? '';
      if (!homeShort || !awayShort) continue;

      const game = gameByPair.get(`${homeShort}-${awayShort}`);
      if (!game) continue;

      const mSpreads = (bk.markets ?? []).find((m) => m.key === 'spreads') ?? null;
      const mTotals  = (bk.markets ?? []).find((m) => m.key === 'totals') ?? null;

      let homeLine: number | null = null;
      let awayLine: number | null = null;
      let total: number | null = null;

      if (mSpreads?.outcomes && mSpreads.outcomes.length >= 2) {
        // Find by provider names -> your short
        const oHome = mSpreads.outcomes.find((o) => TEAM_NAME_TO_SHORT[o.name] === homeShort) ?? null;
        const oAway = mSpreads.outcomes.find((o) => TEAM_NAME_TO_SHORT[o.name] === awayShort) ?? null;
        homeLine = typeof oHome?.point === 'number' ? oHome.point : null;
        awayLine = typeof oAway?.point === 'number' ? oAway.point : null;
      }

      if (mTotals?.outcomes && mTotals.outcomes.length >= 1) {
        // Totals market usually duplicates the number for both outcomes
        const o = mTotals.outcomes[0];
        total = typeof o.point === 'number' ? o.point : null;
      }

      let fav_team_id: number | null = null;
      if (typeof homeLine === 'number' && typeof awayLine === 'number') {
        if (homeLine < 0) fav_team_id = game.home_team_id;
        else if (awayLine < 0) fav_team_id = game.away_team_id;
      }

      // Your UI expects `gl.spread` to be the HOME-signed line.
      const spreadHomeSigned = homeLine ?? (typeof awayLine === 'number' ? -awayLine : null);

      upserts.push({
        game_id: game.id,
        fav_team_id,
        spread: spreadHomeSigned,
        total,
        source: bookmaker,
      });
    }

    if (!upserts.length) return NextResponse.json({ updated: 0 });

    const { error: uErr } = await db
      .from('game_lines')
      .upsert(upserts, { onConflict: 'game_id' });
    if (uErr) throw uErr;

    return NextResponse.json({ updated: upserts.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(msg, { status: 500 });
  }
}
