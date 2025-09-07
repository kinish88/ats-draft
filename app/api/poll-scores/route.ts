import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

type OddsScore = {
  id: string;
  sport_key: string;            // "americanfootball_nfl"
  sport_title: string;
  commence_time: string;        // ISO
  completed: boolean;
  home_team: string;            // "Green Bay Packers"
  away_team: string;            // "Chicago Bears"
  scores?: { name: string; score: string | number }[]; // score can be string per docs
};

function toInt(x: string | number | undefined): number | null {
  if (x === undefined) return null;
  const n = typeof x === 'number' ? x : parseInt(x, 10);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  try {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return new Response('Missing ODDS_API_KEY', { status: 500 });

    // Pull live + recent scores (Odds API updates roughly every 30s; returns finals up to 3 days old)
    const resp = await fetch(
      `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/scores/?daysFrom=3&apiKey=${apiKey}`,
      { cache: 'no-store' }
    );
    if (!resp.ok) return new Response(`OddsAPI ${resp.status}: ${await resp.text()}`, { status: 502 });

    const items = (await resp.json()) as OddsScore[];

    // Build Full Team Name -> short_name map
    const { data: teams, error: tErr } = await supabaseAdmin
      .from('teams')
      .select('name, short_name');
    if (tErr || !teams) return new Response(`teams error: ${tErr?.message}`, { status: 500 });

    const nameToShort = new Map<string, string>();
    for (const t of teams) nameToShort.set(t.name, t.short_name);

    const urlObj = new URL(req.url);
    const dryRun = urlObj.searchParams.get('dry') === '1';

    let attempted = 0;
    let updatedLive = 0;
    let updatedFinal = 0;
    const notes: string[] = [];

    for (const g of items) {
      // we only care about games that have a score array (live or final)
      if (!g.scores || g.scores.length < 2) continue;

      const hShort = nameToShort.get(g.home_team);
      const aShort = nameToShort.get(g.away_team);
      if (!hShort || !aShort) {
        notes.push(`skip: unmapped ${g.home_team} vs ${g.away_team}`);
        continue;
      }

      const hScore = toInt(g.scores.find(s => s.name === g.home_team)?.score);
      const aScore = toInt(g.scores.find(s => s.name === g.away_team)?.score);
      if (hScore === null || aScore === null) {
        notes.push(`skip: missing numeric scores for ${g.home_team} vs ${g.away_team}`);
        continue;
      }

      const year = new Date(g.commence_time).getUTCFullYear();
      attempted++;

      if (dryRun) {
        notes.push(
          `would set LIVE ${year} ${hShort}-${aShort} => ${hScore}-${aScore} (completed=${g.completed})`
        );
        continue;
      }

      // Always write live fields
      {
        const { error } = await supabaseAdmin.rpc('set_live_score_by_teams', {
          p_year: year,
          p_home_short: hShort,
          p_away_short: aShort,
          p_home_score: hScore,
          p_away_score: aScore,
          p_completed: g.completed,
        });
        if (error) notes.push(`live fail: ${hShort}-${aShort} -> ${error.message}`);
        else updatedLive++;
      }

      // If completed, also set your official final scores (one-time)
      if (g.completed) {
        const { error } = await supabaseAdmin.rpc('set_final_score_by_teams', {
          p_year: year,
          p_home_short: hShort,
          p_away_short: aShort,
          p_home_score: hScore,
          p_away_score: aScore,
        });
        if (error) notes.push(`final fail: ${hShort}-${aShort} -> ${error.message}`);
        else updatedFinal++;
      }
    }

    return Response.json({ attempted, updatedLive, updatedFinal, notes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg || 'server error', { status: 500 });
  }
}
