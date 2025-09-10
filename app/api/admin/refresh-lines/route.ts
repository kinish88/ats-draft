/* Refresh betting lines (spreads + totals) for a given NFL week.
   Upserts into public.game_lines using The Odds API data. */
/* eslint-disable @typescript-eslint/no-explicit-any */

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

type TeamRow = {
  id: number;
  name: string;
  short_name: string;
};

type GameRow = {
  game_id: number;
  home_name: string;
  home_short: string;
  home_id: number;
  away_name: string;
  away_short: string;
  away_id: number;
};

type OddsOutcome = {
  name: string;
  point: number | null;
  price?: number | null;
};

type OddsMarketKey = 'spreads' | 'totals';

type OddsMarket = {
  key: OddsMarketKey;
  outcomes: OddsOutcome[];
};

type OddsBookmaker = {
  key: string;    // e.g., "skybet", "williamhill"
  title: string;
  markets: OddsMarket[];
};

type OddsEvent = {
  id: string;
  home_team: string; // full team name
  away_team: string; // full team name
  bookmakers: OddsBookmaker[];
};

/* ------------------------------ Helpers ------------------------------- */

function norm(s: string): string {
  return s.trim().toUpperCase();
}

function chooseBookmaker(bms: OddsBookmaker[]): OddsBookmaker | null {
  if (!bms.length) return null;
  const priority = ['skybet', 'williamhill', 'bet365', 'draftkings'];
  for (const key of priority) {
    const found = bms.find((b) => b.key === key);
    if (found) return found;
  }
  return bms[0] ?? null;
}

function marketOf(book: OddsBookmaker, key: OddsMarketKey): OddsMarket | null {
  return book.markets.find((m) => m.key === key) ?? null;
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

async function loadWeekGames(
  supabaseAdmin: any,
  weekId: number
): Promise<{ games: GameRow[]; teamsByName: Map<string, TeamRow> }> {
  const { data: teams, error: tErr } = await supabaseAdmin
    .from('teams')
    .select('id,name,short_name')
    .returns<TeamRow[]>();
  if (tErr) throw tErr;

  const byId = new Map<number, TeamRow>();
  const byName = new Map<string, TeamRow>();
  (teams ?? []).forEach((t) => {
    const row: TeamRow = { id: t.id, name: t.name, short_name: t.short_name };
    byId.set(row.id, row);
    byName.set(norm(row.name), row);
  });

  type GameDB = { id: number; home_team_id: number; away_team_id: number };
  const { data: gRows, error: gErr } = await supabaseAdmin
    .from('games')
    .select('id, home_team_id, away_team_id')
    .eq('week_id', weekId)
    .returns<GameDB[]>();
  if (gErr) throw gErr;

  const games: GameRow[] = (gRows ?? []).map((g) => {
    const h = byId.get(g.home_team_id);
    const a = byId.get(g.away_team_id);
    return {
      game_id: g.id,
      home_name: h?.name ?? '',
      home_short: h?.short_name ?? '',
      home_id: h?.id ?? 0,
      away_name: a?.name ?? '',
      away_short: a?.short_name ?? '',
      away_id: a?.id ?? 0,
    };
  });

  return { games, teamsByName: byName };
}

/* ------------------------------ Handler ------------------------------- */

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    assertEnv();

    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year') ?? '2025');
    const week = Number(url.searchParams.get('week') ?? '1');

    const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE!);

    const weekId = await getWeekId(supabaseAdmin, year, week);
    const { games, teamsByName } = await loadWeekGames(supabaseAdmin, weekId);

    if (!games.length) {
      return NextResponse.json({ updated: 0, message: 'No games for this week' });
    }

    const byPair = new Map<string, GameRow>();
    for (const g of games) byPair.set(keyPair(g.home_name, g.away_name), g);

    // Fetch odds (spreads + totals)
    const params = new URLSearchParams({
      apiKey: ODDS_API_KEY!,
      regions: 'uk,us',
      markets: 'spreads,totals',
      oddsFormat: 'american',
      dateFormat: 'iso',
      bookmakers: 'skybet,williamhill,bet365,draftkings',
    });

    const oddsRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?${params.toString()}`,
      { method: 'GET', headers: { Accept: 'application/json' } }
    );

    if (!oddsRes.ok) {
      const text = await oddsRes.text();
      return NextResponse.json({ error: 'Odds API error', detail: text }, { status: 502 });
    }

    const events = (await oddsRes.json()) as OddsEvent[];

    type UpRow = {
      game_id: number;
      fav_team_id: number | null;
      spread: number | null; // favourite’s signed line (negative if favourite)
      total: number | null;
      source: string;
      updated_at: string;
    };

    const upserts: UpRow[] = [];

    for (const ev of events) {
      const gm = byPair.get(keyPair(ev.home_team, ev.away_team));
      if (!gm) continue;

      const book = chooseBookmaker(ev.bookmakers ?? []);
      if (!book) continue;

      const mSpreads = marketOf(book, 'spreads');
      const mTotals = marketOf(book, 'totals');

      let favTeamId: number | null = null;
      let favSpread: number | null = null;
      let totalLine: number | null = null;

      // spreads
      if (mSpreads && mSpreads.outcomes?.length) {
        const valid = mSpreads.outcomes.filter((o) => typeof o.point === 'number');
        if (valid.length >= 2) {
          valid.sort((a, b) => (a.point as number) - (b.point as number));
          const favOutcome = valid[0];
          const favName = norm(favOutcome.name);
          const team = teamsByName.get(favName);
          if (team) {
            favTeamId = team.id;
            favSpread = favOutcome.point as number;
          }
        }
      }

      // totals
      if (mTotals && mTotals.outcomes?.length) {
        const over = mTotals.outcomes.find((o) => {
          const n = norm(String(o.name));
          return n === 'OVER' || n === 'O';
        });
        const under = mTotals.outcomes.find((o) => {
          const n = norm(String(o.name));
          return n === 'UNDER' || n === 'U';
        });
        const p = (over?.point ?? under?.point) as number | null;
        if (typeof p === 'number' && Number.isFinite(p)) {
          totalLine = p;
        }
      }

      if (favSpread === null && totalLine === null) continue;

      upserts.push({
        game_id: gm.game_id,
        fav_team_id: favTeamId,
        spread: favSpread,
        total: totalLine,
        source: book.key,
        updated_at: new Date().toISOString(),
      });
    }

    if (!upserts.length) {
      return NextResponse.json({ updated: 0, message: 'No matches from Odds API' });
    }

    const { error: upErr } = await supabaseAdmin
      .from('game_lines')
      .upsert(upserts, { onConflict: 'game_id' });

    if (upErr) {
      return NextResponse.json({ error: 'Upsert failed', detail: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ updated: upserts.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
