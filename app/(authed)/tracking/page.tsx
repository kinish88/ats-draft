'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { formatGameLabel } from '@/lib/formatGameLabel';
import { getTeamLogoUrl } from '@/lib/logos';

type AiPick = {
  id: number;
  season_year: number;
  week_number: number;
  game_id: number;
  pick_type: 'spread' | 'ou';
  home_short: string | null;
  away_short: string | null;
  team_short: string | null;
  ou_side: string | null;
  line_or_total: number | null;
  recommendation: string | null;
  confidence: number | null;
};

type GameRow = {
  id: number;
  home: string;
  away: string;
  home_team_id: number | null;
  away_team_id: number | null;
  home_score: number | null;
  away_score: number | null;
  live_home_score: number | null;
  live_away_score: number | null;
};

type Outcome = 'W' | 'L' | 'P' | '-';
type SeasonSummary = {
  wins: number;
  losses: number;
  pushes: number;
  winPct: number | null;
};

const YEAR = 2025;

function toShort(value?: string | null) {
  return (value ?? '').trim().toUpperCase();
}

function parseNumeric(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeConfidence(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const scaled = value <= 1 ? value * 100 : value;
  if (!Number.isFinite(scaled)) return null;
  return Math.max(0, Math.min(100, scaled));
}

function formatPercent(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function scoreSnapshot(game?: GameRow | null) {
  if (!game || game.home_score == null || game.away_score == null) {
    return { home: null, away: null, text: '—' };
  }
  return { home: game.home_score, away: game.away_score, text: `${game.home_score}–${game.away_score}` };
}

type OutcomeStyles = { W: string; L: string; P: string; '-': string };
const outcomeBadgeStyles: OutcomeStyles = {
  W: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/5',
  L: 'border-rose-500/40 text-rose-300 bg-rose-500/5',
  P: 'border-amber-500/40 text-amber-300 bg-amber-500/5',
  '-': 'border-zinc-700 text-zinc-400',
};
const OUTCOME_PENDING: Outcome = '-';

function computeOutcome(pick: AiPick, game?: GameRow | null): Outcome {
  const score = scoreSnapshot(game);
  if (score.home == null || score.away == null || pick.line_or_total == null) return OUTCOME_PENDING;

  if (pick.pick_type === 'spread') {
    const team = toShort(pick.team_short ?? pick.recommendation);
    const home = toShort(pick.home_short ?? game?.home);
    const away = toShort(pick.away_short ?? game?.away);
    const isHome = team && team === home;
    const isAway = team && team === away;
    if (!isHome && !isAway) return OUTCOME_PENDING;
    const pickScore = isHome ? score.home : score.away;
    const oppScore = isHome ? score.away : score.home;
    const adj = (pickScore ?? 0) + pick.line_or_total;
    if (adj > (oppScore ?? 0)) return 'W';
    if (adj < (oppScore ?? 0)) return 'L';
    return 'P';
  }

  const side = toShort(pick.ou_side ?? pick.recommendation);
  const total = (score.home ?? 0) + (score.away ?? 0);
  if (total === pick.line_or_total) return 'P';
  if (side === 'OVER') return total > pick.line_or_total ? 'W' : 'L';
  if (side === 'UNDER') return total < pick.line_or_total ? 'W' : 'L';
  return '—';
}

export default function TrackingPage() {
  const router = useRouter();
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [seasonPicks, setSeasonPicks] = useState<AiPick[]>([]);
  const [games, setGames] = useState<Map<number, GameRow>>(new Map());

  // Admin guard
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user.email?.toLowerCase() ?? null;
      if (!email) {
        router.replace('/login');
        return;
      }
      let ok = email === 'me@chrismcarthur.co.uk';
      if (!ok) {
        const { data } = await supabase
          .from('players')
          .select('display_name')
          .eq('email', email)
          .maybeSingle();
        ok = data?.display_name === 'Kinish';
      }
      setIsAdmin(ok);
      setCheckingAdmin(false);
      if (!ok) router.replace('/');
    })();
  }, [router]);

  // load full season of picks
  useEffect(() => {
    if (!isAdmin) {
      setSeasonPicks([]);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('ai_recommendations')
        .select('*')
        .eq('season_year', YEAR)
        .order('id');
      if (error) {
        console.error('Could not load AI picks', error);
        return;
      }
      const mapped: AiPick[] = (data ?? []).map((row) => {
        const pickTypeRaw =
          typeof row.pick_type === 'string' ? row.pick_type.trim().toLowerCase() : '';
        const sanitizedType = pickTypeRaw.replace(/[^a-z]/g, '');
        const pickType: 'spread' | 'ou' =
          sanitizedType === 'ou' || sanitizedType.includes('total') ? 'ou' : 'spread';
        const line = parseNumeric(row.line_or_total);
        const pickValue = parseNumeric(row.pick_value);
        const inferredOuSide =
          pickType === 'ou'
            ? sanitizedType.includes('under')
              ? 'UNDER'
              : sanitizedType.includes('over')
              ? 'OVER'
              : null
            : null;
        const confidenceValue =
          parseNumeric(row.confidence) ??
          parseNumeric(row.confidence_pct) ??
          parseNumeric(row.probability);
        const confidence = normalizeConfidence(confidenceValue);
        const recommendation =
          typeof row.recommendation === 'string'
            ? row.recommendation
            : typeof row.team_short === 'string'
            ? row.team_short
            : typeof row.ou_side === 'string'
            ? row.ou_side
            : typeof row.pick_value === 'string'
            ? row.pick_value
            : inferredOuSide;
        return {
          id: typeof row.id === 'number' ? row.id : Number(row.id ?? 0),
          season_year:
            typeof row.season_year === 'number'
              ? row.season_year
              : Number(row.season_year ?? YEAR),
          week_number:
            typeof row.week_number === 'number'
              ? row.week_number
              : row.week_number == null
              ? 1
              : Number(row.week_number),
          game_id: typeof row.game_id === 'number' ? row.game_id : Number(row.game_id ?? 0),
          pick_type: pickType,
          home_short: typeof row.home_short === 'string' ? row.home_short : null,
          away_short: typeof row.away_short === 'string' ? row.away_short : null,
          team_short: typeof row.team_short === 'string' ? row.team_short : null,
          ou_side:
            typeof row.ou_side === 'string'
              ? row.ou_side
              : pickType === 'ou'
              ? recommendation ?? inferredOuSide
              : null,
          line_or_total: line ?? pickValue,
          recommendation,
          confidence,
        };
      });
      setSeasonPicks(mapped);
    })();
  }, [isAdmin]);

  // load matching games for outcome calculation
  useEffect(() => {
    if (!isAdmin || !seasonPicks.length) {
      setGames(new Map());
      return;
    }
    const ids = Array.from(new Set(seasonPicks.map((p) => p.game_id))).filter((n) =>
      Number.isFinite(n)
    );
    if (!ids.length) {
      setGames(new Map());
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('games')
        .select(
          'id,home_team_id,away_team_id,home_score,away_score,live_home_score,live_away_score'
        )
        .in('id', ids);
      if (error) {
        console.error('Could not load games for AI picks', error);
        return;
      }
      const teamIds = new Set<number>();
      for (const row of data ?? []) {
        if (row?.home_team_id != null) {
          const id =
            typeof row.home_team_id === 'number'
              ? row.home_team_id
              : Number(row.home_team_id);
          if (Number.isFinite(id)) teamIds.add(id);
        }
        if (row?.away_team_id != null) {
          const id =
            typeof row.away_team_id === 'number'
              ? row.away_team_id
              : Number(row.away_team_id);
          if (Number.isFinite(id)) teamIds.add(id);
        }
      }
      const teamsMap = new Map<number, string>();
      if (teamIds.size) {
        const { data: teamRows, error: teamError } = await supabase
          .from('teams')
          .select('id,short_name')
          .in('id', Array.from(teamIds));
        if (teamError) {
          console.error('Could not load teams for AI picks', teamError);
          return;
        }
        for (const team of teamRows ?? []) {
          if (team == null) continue;
          const id = typeof team.id === 'number' ? team.id : Number(team.id ?? 0);
          const shortName = typeof team.short_name === 'string' ? team.short_name : '';
          if (Number.isFinite(id) && shortName) {
            teamsMap.set(id, shortName);
          }
        }
      }
      const map = new Map<number, GameRow>();
      for (const row of data ?? []) {
        if (row == null) continue;
        const id = typeof row.id === 'number' ? row.id : Number(row.id ?? 0);
        const homeTeamIdRaw =
          typeof row.home_team_id === 'number'
            ? row.home_team_id
            : row.home_team_id == null
            ? null
            : Number(row.home_team_id);
        const awayTeamIdRaw =
          typeof row.away_team_id === 'number'
            ? row.away_team_id
            : row.away_team_id == null
            ? null
            : Number(row.away_team_id);
        const homeTeamId =
          typeof homeTeamIdRaw === 'number' && Number.isFinite(homeTeamIdRaw)
            ? homeTeamIdRaw
            : null;
        const awayTeamId =
          typeof awayTeamIdRaw === 'number' && Number.isFinite(awayTeamIdRaw)
            ? awayTeamIdRaw
            : null;
        const normalized: GameRow = {
          id,
          home: (homeTeamId != null ? teamsMap.get(homeTeamId) : '') ?? '',
          away: (awayTeamId != null ? teamsMap.get(awayTeamId) : '') ?? '',
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          home_score: parseNumeric(row.home_score),
          away_score: parseNumeric(row.away_score),
          live_home_score: parseNumeric(row.live_home_score),
          live_away_score: parseNumeric(row.live_away_score),
        };
        if (Number.isFinite(normalized.id)) {
          map.set(normalized.id, normalized);
        }
      }
      setGames(map);
    })();
  }, [seasonPicks, isAdmin]);

  const decorated = useMemo(() => {
    const sorted = [...seasonPicks].sort((a, b) => {
      if (a.week_number === b.week_number) return a.id - b.id;
      return a.week_number - b.week_number;
    });
    return sorted.map((p) => {
      const game = games.get(p.game_id) ?? null;
      const rec = (p.recommendation ?? '').toString().trim();
      const homeTeamShort = toShort(game?.home) || toShort(p.home_short) || '-';
      const awayTeamShort = toShort(game?.away) || toShort(p.away_short) || '-';
      const score = scoreSnapshot(game);
      const hasFinal = game?.home_score != null && game?.away_score != null;
      const result = hasFinal ? computeOutcome(p, game) : '-';
      const confidenceText =
        typeof p.confidence === 'number' ? formatPercent(p.confidence) : null;

      const numericLine =
        p.line_or_total != null
          ? p.pick_type === 'spread' && p.line_or_total > 0
            ? `+${p.line_or_total}`
            : `${p.line_or_total}`
          : '';
      const baseDescriptor =
        p.pick_type === 'spread'
          ? (rec || p.team_short || '').trim()
          : (p.ou_side || rec || '').toString().trim();
      const descriptorIncludesLine =
        baseDescriptor && numericLine ? baseDescriptor.includes(`${p.line_or_total}`) : false;
      const descriptor =
        numericLine && !descriptorIncludesLine
          ? `${baseDescriptor} ${numericLine}`.trim()
          : (baseDescriptor || numericLine).trim() || 'N/A';

      const matchupLabel = formatGameLabel(awayTeamShort || '-', homeTeamShort || '-');
      const confidenceDisplay = confidenceText ? ` (${confidenceText})` : '';
      const leftLabel =
        p.pick_type === 'ou'
          ? `Week ${p.week_number} - ${matchupLabel} ${descriptor}${confidenceDisplay}`.trim()
          : `Week ${p.week_number} - ${descriptor}${confidenceDisplay}`.trim();

      const scoreText =
        score.away != null && score.home != null ? `${score.away} - ${score.home}` : score.text;

      return {
        ...p,
        matchup: matchupLabel,
        score: scoreText,
        recommendationText: rec,
        outcome: result,
        confidenceText,
        descriptor,
        homeTeamShort,
        awayTeamShort,
        leftLabel,
        homeLogo: getTeamLogoUrl(homeTeamShort),
        awayLogo: getTeamLogoUrl(awayTeamShort),
      };
    });
  }, [seasonPicks, games]);

  const picksByWeek = useMemo(() => {
    const grouped = new Map<number, typeof decorated>();
    for (const pick of decorated) {
      if (!grouped.has(pick.week_number)) grouped.set(pick.week_number, []);
      grouped.get(pick.week_number)!.push(pick);
    }
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([weekNumber, picks]) => ({ weekNumber, picks }));
  }, [decorated]);

  const seasonSummary = useMemo<SeasonSummary>(() => {
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    for (const pick of seasonPicks) {
      const outcome = computeOutcome(pick, games.get(pick.game_id));
      if (outcome === 'W') wins += 1;
      else if (outcome === 'L') losses += 1;
      else if (outcome === 'P') pushes += 1;
    }
    const counted = wins + losses + pushes;
    const winPct = counted ? (wins / counted) * 100 : null;
    return { wins, losses, pushes, winPct };
  }, [seasonPicks, games]);

  if (checkingAdmin) {
    return <div className="p-6 text-sm text-zinc-400">Checking admin access…</div>;
  }
  if (!isAdmin) return null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Dave1290 AI Tracking</h1>
        <p className="text-sm text-zinc-400">
          Read-only log of Dave's weekly recommendations. This page never influences the live draft
          or scoring.
        </p>
      </header>

      <section className="border rounded p-4 space-y-3">
        <h2 className="text-lg font-medium">AI Season Summary ({YEAR})</h2>
        <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-300">
          <div className="flex-1 min-w-[140px]">Wins: {seasonSummary.wins}</div>
          <div className="flex-1 min-w-[140px]">Losses: {seasonSummary.losses}</div>
          <div className="flex-1 min-w-[140px]">Pushes: {seasonSummary.pushes}</div>
          <div className="flex-1 min-w-[140px]">
            Win %: {seasonSummary.winPct != null ? formatPercent(seasonSummary.winPct) : '-'}
          </div>
        </div>
      </section>

      <section className="border rounded p-4 space-y-4">
        <h2 className="text-lg font-medium">Weekly Picks</h2>
        {picksByWeek.length === 0 ? (
          <p className="text-sm text-zinc-400">No picks logged for this season.</p>
        ) : (
          <div className="space-y-6">
            {picksByWeek.map(({ weekNumber, picks }) => (
              <div key={weekNumber} className="space-y-2">
                <div className="text-sm font-semibold text-zinc-200">Week {weekNumber}</div>
                <ul className="divide-y divide-zinc-800">
                  {picks.map((p) => (
                    <li key={p.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[220px] text-sm text-zinc-100 leading-snug">
                          {p.leftLabel}
                        </div>
                        <div className="flex-1 min-w-[180px] flex items-center justify-center gap-2 text-sm text-zinc-300">
                          {p.awayLogo ? (
                            <img
                              src={p.awayLogo}
                              alt={p.awayTeamShort}
                              className="w-6 h-6 rounded-sm object-contain"
                              loading="eager"
                            />
                          ) : (
                            <span className="w-6 h-6" />
                          )}
                          <span className="tabular-nums">{p.score}</span>
                          {p.homeLogo ? (
                            <img
                              src={p.homeLogo}
                              alt={p.homeTeamShort}
                              className="w-6 h-6 rounded-sm object-contain"
                              loading="eager"
                            />
                          ) : (
                            <span className="w-6 h-6" />
                          )}
                        </div>
                        <div className="flex-none ml-auto">
                          <span
                            className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${outcomeBadgeStyles[p.outcome]}`}
                          >
                            {p.outcome}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
