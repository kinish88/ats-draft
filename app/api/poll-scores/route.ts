import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// ESPN team abbreviation -> our short_name mapping for any that differ
const ESPN_ABBR_MAP: Record<string, string> = {
  'WSH': 'WAS',
  'JAX': 'JAC',
};

function mapAbbr(espn: string): string {
  return ESPN_ABBR_MAP[espn.toUpperCase()] ?? espn.toUpperCase();
}

type EspnCompetitor = {
  homeAway: 'home' | 'away';
  score: string;
  team: { abbreviation: string };
};

type EspnStatus = {
  type: { completed: boolean; description: string; state: string };
};

type EspnEvent = {
  competitions: Array<{
    competitors: EspnCompetitor[];
    status: EspnStatus;
  }>;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry') === '1';

    // Fetch from ESPN — no API key needed
    const resp = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      { cache: 'no-store' }
    );

    if (!resp.ok) {
      return NextResponse.json({ error: `ESPN ${resp.status}` }, { status: 502 });
    }

    const data = await resp.json();
    const events: EspnEvent[] = data.events ?? [];

    let updatedLive = 0;
    let updatedFinal = 0;
    let skipped = 0;
    const notes: string[] = [];

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors.find((c) => c.homeAway === 'home');
      const away = comp.competitors.find((c) => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeShort = mapAbbr(home.team.abbreviation);
      const awayShort = mapAbbr(away.team.abbreviation);
      const homeScore = parseInt(home.score, 10);
      const awayScore = parseInt(away.score, 10);
      const isCompleted = comp.status.type.completed;
      const isInProgress = comp.status.type.state === 'in';

      // Skip games that haven't started yet and have no scores
      if (!isInProgress && !isCompleted) {
        skipped++;
        continue;
      }

      if (isNaN(homeScore) || isNaN(awayScore)) {
        notes.push(`skip: no numeric scores for ${awayShort} @ ${homeShort}`);
        skipped++;
        continue;
      }

      if (dryRun) {
        notes.push(`would update ${awayShort} @ ${homeShort}: ${awayScore}-${homeScore} (final=${isCompleted})`);
        continue;
      }

      // Update live scores
      const { error: liveErr } = await supabaseAdmin.rpc('set_live_score_by_teams', {
        p_year: new Date().getFullYear(),
        p_home_short: homeShort,
        p_away_short: awayShort,
        p_home_score: homeScore,
        p_away_score: awayScore,
        p_completed: isCompleted,
      });

      if (liveErr) {
        notes.push(`live fail: ${awayShort} @ ${homeShort} -> ${liveErr.message}`);
      } else {
        updatedLive++;
      }

      // If final, write official score too
      if (isCompleted) {
        const { error: finalErr } = await supabaseAdmin.rpc('set_final_score_by_teams', {
          p_year: new Date().getFullYear(),
          p_home_short: homeShort,
          p_away_short: awayShort,
          p_home_score: homeScore,
          p_away_score: awayScore,
        });

        if (finalErr) {
          notes.push(`final fail: ${awayShort} @ ${homeShort} -> ${finalErr.message}`);
        } else {
          updatedFinal++;
        }
      }
    }

    return NextResponse.json({
      source: 'ESPN',
      total: events.length,
      skipped,
      updatedLive,
      updatedFinal,
      notes,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
// ESPN scores - Wed Apr 22 01:28:54 BST 2026
