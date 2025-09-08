'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

const YEAR = 2025;
const PLAYERS = ['Big Dawg', 'Pud', 'Kinish'] as const;

// Storage base for logos, e.g. "https://<ref>.supabase.co/storage/v1/object/public/team-logos/"
const LOGO_BASE = process.env.NEXT_PUBLIC_TEAM_LOGO_BASE ?? '';

/* ------------------------------- data types ------------------------------- */

type WeekRow = { week_number: number };

type GameRow = {
  id: number;                 // normalized from RPC game_id
  home: string;               // short, e.g. 'PHI'
  away: string;               // short, e.g. 'DAL'
  home_score: number | null;
  away_score: number | null;
  // we stick to final scores only (no extra live columns required)
};

type SpreadPickRow = {
  pick_id?: number;
  pick_number: number;
  player: string;             // display name
  team_short: string;         // picked team (short)
  spread_at_pick: number | null;
  home_short: string;
  away_short: string;
};

type OuPickRow = {
  player: string;             // display name
  home_short: string;
  away_short: string;
  pick_side: 'OVER' | 'UNDER';
  total_at_pick: number;
};

type TeamRow = {
  short_name: string;
  name: string;               // full name
  logo_url: string | null;
};

/* --------------------------------- helpers -------------------------------- */

const signed = (n: number | null | undefined) =>
  n == null ? '' : n > 0 ? `+${n}` : `${n}`;

const teamLogoUrl = (short?: string | null, fallback?: string | null) => {
  if (!short) return fallback ?? null;
  if (LOGO_BASE) return `${LOGO_BASE}${short}.png`;
  return fallback ?? null;
};

const nflLogoUrl = LOGO_BASE ? `${LOGO_BASE}NFL.png` : null;

// Outcome logic (ATS)
type Outcome = 'win' | 'loss' | 'push' | 'pending';

function pickOutcomeATS(
  g: GameRow | undefined,
  pickedTeam: string,
  spread: number | null
): Outcome {
  if (!g || spread == null) return 'pending';
  if (g.home_score == null || g.away_score == null) return 'pending';

  const pickIsHome = pickedTeam === g.home;
  const pickScore = pickIsHome ? g.home_score : g.away_score;
  const oppScore  = pickIsHome ? g.away_score : g.home_score;

  const adj = pickScore + spread;
  if (adj > oppScore) return 'win';
  if (adj < oppScore) return 'loss';
  return 'push';
}

// Outcome logic (O/U)
function pickOutcomeOU(
  g: GameRow | undefined,
  side: 'OVER' | 'UNDER',
  total: number
): Outcome {
  if (!g) return 'pending';
  if (g.home_score == null || g.away_score == null) return 'pending';

  const sum = g.home_score + g.away_score;
  if (sum === total) return 'push';
  if (side === 'OVER') return sum > total ? 'win' : 'loss';
  return sum < total ? 'win' : 'loss';
}

const outcomeClass = (o: Outcome) =>
  o === 'win' ? 'text-emerald-400'
: o === 'loss' ? 'text-rose-400'
: o === 'push' ? 'text-zinc-300'
: 'text-zinc-400';

function TinyLogo({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return <span className="inline-block w-5 h-5 mr-2 align-middle" />;
  return (
    <img
      alt={alt}
      src={url}
      className="inline-block w-5 h-5 mr-2 rounded-sm align-middle"
      loading="eager"
    />
  );
}

/* --------------------------------- page ---------------------------------- */

export default function ScoreboardPage() {
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const [games, setGames] = useState<GameRow[]>([]);
  const [spreadPicks, setSpreadPicks] = useState<SpreadPickRow[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPickRow[]>([]);
  const [teams, setTeams] = useState<Map<string, TeamRow>>(new Map());

  const [showBoard, setShowBoard] = useState<boolean>(false);

  // Load week list
  const loadWeeks = async () => {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    const list = (data as WeekRow[] | null)?.map(w => w.week_number) ?? [];
    setWeeks(list.length ? list : Array.from({ length: 18 }, (_, i) => i + 1));
  };

  // Load all data for a week
  const loadAll = async (w: number) => {
    setLoading(true);

    const [gms, sp, ou, tms] = await Promise.all([
      supabase.rpc('get_week_games_for_scoring', { p_year: YEAR, p_week: w }),
      supabase.rpc('get_week_spread_picks_admin', { p_year: YEAR, p_week: w }),
      supabase.rpc('get_week_ou_picks_admin', { p_year: YEAR, p_week: w }),
      supabase.from('teams').select('short_name,name,logo_url'),
    ]);

    // Teams map
    const trows = (tms.data as TeamRow[] | null) ?? [];
    const tmap = new Map<string, TeamRow>();
    for (const t of trows) tmap.set(t.short_name, t);
    setTeams(tmap);

    // Games
    const graw = (gms.data as unknown[] | null) ?? [];
    const gnorm: GameRow[] = graw.map((r: any) => ({
      id: Number(r.game_id),           // normalize
      home: r.home,
      away: r.away,
      home_score: r.home_score ?? null,
      away_score: r.away_score ?? null,
    }));
    setGames(gnorm);

    // Spread picks
    const spRows = (sp.data as unknown[] | null) ?? [];
    const spNorm: SpreadPickRow[] = spRows.map((r: any) => ({
      pick_id: r.pick_id ?? undefined,
      pick_number: r.pick_number,
      player: r.player,
      team_short: r.team_short,
      spread_at_pick: r.spread_at_pick,
      home_short: r.home_short,
      away_short: r.away_short,
    }));
    setSpreadPicks(spNorm);

    // O/U picks
    const ouRows = (ou.data as unknown[] | null) ?? [];
    const ouNorm: OuPickRow[] = ouRows.map((r: any) => ({
      player: r.player,
      home_short: r.home_short,
      away_short: r.away_short,
      pick_side: r.pick_side,
      total_at_pick: Number(r.total_at_pick),
    }));
    setOuPicks(ouNorm);

    setLoading(false);
  };

  // Initial load
  useEffect(() => { loadWeeks(); }, []);
  useEffect(() => { loadAll(week); }, [week]);

  // Realtime: update scores when games table changes
  useEffect(() => {
    if (!games.length) return;

    const idSet = new Set(games.map(g => g.id));
    const chan = supabase
      .channel('scoreboard-games')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games' },
        (payload: RealtimePostgresChangesPayload<Partial<GameRow>>) => {
          const row = payload.new;
          if (!row || typeof row.id !== 'number' || !idSet.has(row.id)) return;

          setGames(prev =>
            prev.map(g =>
              g.id === row.id
                ? {
                    ...g,
                    home_score: row.home_score ?? g.home_score,
                    away_score: row.away_score ?? g.away_score,
                  }
                : g
            )
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(chan); };
  }, [games]);

  /* ------------------------------ derived maps ----------------------------- */

  const teamsByShort = teams;
  const fullName = (short: string) => teamsByShort.get(short)?.name ?? short;

  const logoFor = (short: string) =>
    teamLogoUrl(short, teamsByShort.get(short)?.logo_url ?? null);

  const gameByPair = useMemo(() => {
    // Normalize both "H-A" and "A-H" -> same record
    const m = new Map<string, GameRow>();
    for (const g of games) {
      m.set(`${g.home}-${g.away}`, g);
      m.set(`${g.away}-${g.home}`, g); // allow lookup either way
    }
    return m;
  }, [games]);

  // Group spread picks by player (order pick_number asc)
  const picksByPlayer = useMemo(() => {
    const init = new Map<string, SpreadPickRow[]>();
    for (const p of PLAYERS) init.set(p, []);
    for (const r of spreadPicks) {
      if (!init.has(r.player)) init.set(r.player, []);
      init.get(r.player)!.push(r);
    }
    for (const [, arr] of init) arr.sort((a, b) => a.pick_number - b.pick_number);
    return init;
  }, [spreadPicks]);

  // Index O/U picks by player (one per player)
  const ouByPlayer = useMemo(() => {
    const m = new Map<string, OuPickRow | null>();
    for (const p of PLAYERS) m.set(p, null);
    for (const r of ouPicks) m.set(r.player, r);
    return m;
  }, [ouPicks]);

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      {/* Header with NFL crest */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {nflLogoUrl ? (
            <img
              src={nflLogoUrl}
              alt="NFL"
              className="w-7 h-7 rounded-sm"
              loading="eager"
            />
          ) : null}
          <h1 className="text-2xl font-semibold">Week {week} Scoreboard</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm opacity-70">Week</label>
            <select
              className="border rounded p-1 bg-transparent"
              value={week}
              onChange={(e) => setWeek(parseInt(e.target.value, 10))}
            >
              {weeks.map(w => <option key={w} value={w}>Week {w}</option>)}
            </select>
          </div>

          <label className="text-sm flex items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={showBoard}
              onChange={(e) => setShowBoard(e.target.checked)}
            />
            Show full scoreboard
          </label>

          <button
            onClick={() => loadAll(week)}
            className="text-sm border rounded px-2 py-1"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* ------------------------------- PICKS ------------------------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Picks</h2>

        {loading ? (
          <div className="text-sm text-zinc-400">Loading…</div>
        ) : (
          PLAYERS.map(player => {
            const rows = picksByPlayer.get(player) ?? [];
            return (
              <div key={player} className="border rounded p-4">
                <div className="font-semibold mb-3">{player}</div>

                {rows.length === 0 ? (
                  <div className="text-sm text-zinc-400">No picks</div>
                ) : (
                  <div className="space-y-2">
                    {rows.map((r) => {
                      const g = gameByPair.get(`${r.home_short}-${r.away_short}`);
                      const outcome = pickOutcomeATS(g, r.team_short, r.spread_at_pick ?? null);

                      const home = g?.home_score;
                      const away = g?.away_score;

                      return (
                        <div key={r.pick_number} className="flex items-center justify-between">
                          {/* Left: one logo (picked team) + full team name + matchup short */}
                          <div className="flex items-center gap-2">
                            <TinyLogo url={logoFor(r.team_short)} alt={r.team_short} />
                            <span className="font-semibold">{fullName(r.team_short)}</span>
                            <span className="text-sm text-zinc-400 ml-2">
                              ({r.home_short} v {r.away_short})
                            </span>
                          </div>

                          {/* Right: spread, score, status */}
                          <div className="flex items-center gap-4">
                            <span className="w-12 text-right tabular-nums">{signed(r.spread_at_pick)}</span>
                            <span className="w-16 text-right tabular-nums">
                              {home != null && away != null ? `${home} — ${away}` : '— —'}
                            </span>
                            <span className={outcomeClass(outcome)}>{outcome}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* ---------------------------- O/U TIE-BREAKERS ---------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">O/U Tie-breakers</h2>

        {PLAYERS.map(name => {
          const r = ouByPlayer.get(name) || null;
          if (!r) {
            return (
              <div key={name} className="border rounded p-3 text-sm text-zinc-400">
                {name}
              </div>
            );
          }

          const g = gameByPair.get(`${r.home_short}-${r.away_short}`);
          const outcome = pickOutcomeOU(g, r.pick_side, r.total_at_pick);
          const home = g?.home_score;
          const away = g?.away_score;

          return (
            <div key={name} className="border rounded p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* One crest for O/U: NFL */}
                <TinyLogo url={nflLogoUrl} alt="NFL" />
                <span className="mr-2">{name}</span>
                <span className="text-zinc-300">
                  {r.home_short} v {r.away_short}
                </span>
                <span className="ml-3">{r.pick_side}</span>
                <span className="ml-1">{r.total_at_pick}</span>
                <span className="ml-3 tabular-nums opacity-80">
                  {home != null && away != null ? `${home} — ${away}` : '— —'}
                </span>
              </div>
              <span className={outcomeClass(outcome)}>{outcome}</span>
            </div>
          );
        })}
      </section>

      {/* --------------------------- FULL SCOREBOARD --------------------------- */}
      {showBoard && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">All Games</h2>
          {games.length === 0 ? (
            <div className="text-sm text-zinc-400">No games for this week.</div>
          ) : (
            games.map(g => (
              <div key={g.id} className="border rounded p-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TinyLogo url={logoFor(g.home)} alt={g.home} />
                  <span className="w-12">{g.home}</span>
                  <span className="text-sm text-zinc-500">v</span>
                  <TinyLogo url={logoFor(g.away)} alt={g.away} />
                  <span className="w-12">{g.away}</span>
                </div>
                <div className="tabular-nums">
                  {g.home_score != null && g.away_score != null ? `${g.home_score} — ${g.away_score}` : '— —'}
                </div>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}
