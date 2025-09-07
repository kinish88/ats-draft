'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;

/* ----------------------------- small utilities ----------------------------- */

type AnyRec = Record<string, unknown>;

function getStr(r: AnyRec, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

function getBool(r: AnyRec, ...keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.toLowerCase();
      if (['true', 't', '1', 'yes', 'y'].includes(s)) return true;
      if (['false', 'f', '0', 'no', 'n'].includes(s)) return false;
    }
  }
  return undefined;
}

function getNum(r: AnyRec, ...keys: (keyof AnyRec)[]): number | null {
  for (const k of keys) {
    const v = r[k as string];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function fmtSpread(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n === 0) return 'PK';
  return n > 0 ? `+${n}` : `${n}`;
}

/* ---------------------------------- types ---------------------------------- */

type WeekOption = { week_number: number };

type GameRow = {
  id: number;
  home: string;
  away: string;
  home_spread: number | null;
  away_spread: number | null;
  live_home_score: number | null;
  live_away_score: number | null;
  is_live: boolean;
  is_final: boolean;
};

type PlayerPick = {
  team: string;
  matchup: string;
  spread: number | null;
  result: 'win' | 'loss' | 'push' | 'pending' | null;
};

type PlayerPicksBlock = { name: string; picks: PlayerPick[] };

type OUPick = {
  player: string;
  matchup: string;
  side: 'OVER' | 'UNDER' | '';
  total: number | null;
  result: 'win' | 'loss' | 'push' | 'pending';
};

/* ------------------------------ logo preload ------------------------------ */

type LogoMap = Map<string, string>; // short_name -> logo_url

async function loadLogos(): Promise<LogoMap> {
  const { data, error } = await supabase
    .from('teams')
    .select('short_name, logo_url');

  const map: LogoMap = new Map();
  if (!error && data) {
    for (const t of data) {
      if (t.short_name && t.logo_url) map.set(t.short_name, t.logo_url);
    }
  }
  return map;
}

/* --------------------------------- cells ---------------------------------- */

type TinyLogoProps = { url?: string | null; alt: string };

function TinyLogo({ url, alt }: TinyLogoProps) {
  if (!url) return <span className="inline-block w-4 h-4 mr-2 align-middle" />;
  // We stick with <img> to avoid next/image warnings for now
  return (
    <img
      src={url}
      alt={alt}
      className="w-4 h-4 mr-2 inline-block align-middle rounded-sm"
      loading="lazy"
      decoding="async"
    />
  );
}


function ScoreCell({
  home,
  away,
  isLive,
}: {
  home: number | null;
  away: number | null;
  isLive: boolean;
}) {
  const text =
    home === null && away === null
      ? '—'
      : `${home ?? '—'} — ${away ?? '—'}`;
  return (
    <span className={`text-sm tabular-nums ${isLive ? 'animate-pulse' : ''}`}>
      {text}
    </span>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function Page() {
  const [weeks, setWeeks] = useState<number[]>([]);
  const [week, setWeek] = useState<number>(1);
  const [showFull, setShowFull] = useState<boolean>(false);

  const [logos, setLogos] = useState<LogoMap>(new Map());

  // Full scoreboard rows
  const [games, setGames] = useState<GameRow[]>([]);
  const gameIdSet = useMemo(() => new Set(games.map((g) => g.id)), [games]);

  // Picks view
  const [players, setPlayers] = useState<PlayerPicksBlock[]>([]);
  const [ouPicks, setOuPicks] = useState<OUPick[]>([]);

  /* ------------------------------ data loaders ------------------------------ */

  async function loadWeeks() {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    if (data) setWeeks((data as WeekOption[]).map((w) => w.week_number));
    else setWeeks(Array.from({ length: 18 }, (_, i) => i + 1));
  }

  async function loadFullScoreboard(w: number) {
    // Prefer the richer function if you have it
    const candidateFns = ['get_week_games_with_status', 'get_week_games_for_scoring'];
    let rows: AnyRec[] = [];
    let firstErr: string | null = null;

    for (const fn of candidateFns) {
      const { data, error } = await supabase.rpc(fn, { p_year: YEAR, p_week: w });
      if (!error && data) {
        rows = data as AnyRec[];
        firstErr = null;
        break;
      }
      firstErr = error?.message ?? `rpc ${fn} failed`;
    }
    if (firstErr) console.warn(firstErr);

    const mapped: GameRow[] = rows.map((r) => {
      const id = getNum(r, 'game_id', 'id') ?? Math.floor(Math.random() * 1e9);
      const home = getStr(r, 'home', 'home_team', 'home_short', 'home_code') ?? '';
      const away = getStr(r, 'away', 'away_team', 'away_short', 'away_code') ?? '';

      // Try to pick up spreads if present
      const home_spread =
        getNum(r, 'home_spread', 'home_line', 'home_handicap', 'spread_home', 'h_spread');
      const away_spread =
        getNum(r, 'away_spread', 'away_line', 'away_handicap', 'spread_away', 'a_spread');

      const live_home_score = getNum(r, 'live_home_score', 'home_live', 'home_score');
      const live_away_score = getNum(r, 'live_away_score', 'away_live', 'away_score');

      const is_live = getBool(r, 'is_live', 'live') ?? false;
      const is_final = getBool(r, 'is_final', 'final') ?? false;

      return {
        id,
        home,
        away,
        home_spread,
        away_spread,
        live_home_score,
        live_away_score,
        is_live,
        is_final,
      };
    });

    setGames(mapped);
  }

  async function loadPicksView(w: number) {
    // Spread picks
    const { data: spreadData } = await supabase.rpc('get_week_spread_picks_admin', {
      p_year: YEAR,
      p_week: w,
    });
    const rows = (spreadData ?? []) as AnyRec[];

    const grouped = new Map<string, PlayerPick[]>();

    rows
      .sort(
        (a, b) =>
          (getNum(a, 'pick_number', 'pick') ?? 0) -
          (getNum(b, 'pick_number', 'pick') ?? 0),
      )
      .forEach((r) => {
        const player =
          getStr(r, 'player', 'display_name', 'player_name', 'drafter') ?? 'Unknown';

        const team = getStr(r, 'team', 'team_short', 'pick_team') ?? '';
        const matchup = getStr(r, 'matchup', 'game', 'game_label') ?? '';
        const spread = getNum(r, 'spread', 'line');
        const result = (getStr(r, 'result', 'status') ?? 'pending') as
          | 'win'
          | 'loss'
          | 'push'
          | 'pending';

        const arr = grouped.get(player) ?? [];
        arr.push({ team, matchup, spread, result });
        grouped.set(player, arr);
      });

    const playersOut: PlayerPicksBlock[] = [];
    for (const [name, picks] of grouped) playersOut.push({ name, picks });
    setPlayers(playersOut);

    // O/U picks
    const { data: ouData } = await supabase.rpc('get_week_ou_picks_admin', {
      p_year: YEAR,
      p_week: w,
    });
    const ouRows = (ouData ?? []) as AnyRec[];

    setOuPicks(
      ouRows.map((r) => ({
        player:
          getStr(r, 'player', 'display_name', 'player_name', 'drafter') ?? 'Unknown',
        matchup: getStr(r, 'matchup', 'game', 'game_label') ?? '',
        side: (getStr(r, 'choice', 'ou_choice', 'side', 'direction') ?? '').toUpperCase() as
          | 'OVER'
          | 'UNDER'
          | '',
        total: getNum(r, 'total', 'ou_total', 'line'),
        result: (getStr(r, 'result', 'status') ?? 'pending') as
          | 'win'
          | 'loss'
          | 'push'
          | 'pending',
      })),
    );
  }

  async function loadData(w: number, showAll: boolean) {
    if (showAll) {
      await loadFullScoreboard(w);
    } else {
      await loadPicksView(w);
    }
  }

  /* ------------------------------- live stream ------------------------------ */

  useEffect(() => {
    // preload logos once
    (async () => setLogos(await loadLogos()))();
    loadWeeks();
  }, []);

  useEffect(() => {
    loadData(week, showFull);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, showFull]);

  useEffect(() => {
    // Subscribe to games changes to reflect live scores in full scoreboard mode
    const channel = supabase
      .channel('games-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games' },
        (payload: unknown) => {
          if (!showFull) return;

          // Very light type guard
          const p = payload as { new?: AnyRec } | null;
          const row = p?.new ?? null;
          const id = row ? getNum(row, 'id') : null;
          if (id === null || !gameIdSet.has(id)) return;

          const live_home_score = row ? getNum(row, 'live_home_score') : null;
          const live_away_score = row ? getNum(row, 'live_away_score') : null;
          const is_live = row ? getBool(row, 'is_live') ?? undefined : undefined;
          const is_final = row ? getBool(row, 'is_final') ?? undefined : undefined;

          setGames((prev) =>
            prev.map((g) =>
              g.id !== id
                ? g
                : {
                    ...g,
                    live_home_score:
                      live_home_score !== null ? live_home_score : g.live_home_score,
                    live_away_score:
                      live_away_score !== null ? live_away_score : g.live_away_score,
                    is_live: is_live ?? g.is_live,
                    is_final: is_final ?? g.is_final,
                  },
            ),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameIdSet, showFull]);

  /* ---------------------------------- UI ----------------------------------- */

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center gap-4 justify-between">
        <h1 className="text-2xl font-semibold">
          Week {week} Scoreboard
        </h1>

        <div className="flex items-center gap-6">
          <label className="text-sm flex items-center gap-2">
            <span>Week</span>
            <select
              className="border rounded px-2 py-1 bg-transparent"
              value={week}
              onChange={(e) => setWeek(parseInt(e.target.value, 10))}
            >
              {weeks.map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm flex items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={showFull}
              onChange={(e) => setShowFull(e.target.checked)}
            />
            Show full scoreboard
          </label>
        </div>
      </header>

      {!showFull ? (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Picks</h2>

            {players.length === 0 && (
              <div className="text-sm opacity-70">No picks</div>
            )}

            {players.map((pl) => (
              <div key={pl.name} className="border rounded p-4">
                <div className="font-semibold mb-2">{pl.name}</div>
                {pl.picks.length === 0 ? (
                  <div className="text-sm opacity-70">No picks</div>
                ) : (
                  <div className="space-y-1">
                    {pl.picks.map((pk, idx) => (
                      <div
                        key={`${pl.name}-${idx}-${pk.team}`}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <TinyLogo url={logos.get(pk.team)} alt={pk.team} />
                          <span className="font-medium">{pk.team}</span>
                          <span className="opacity-70 text-sm">({pk.matchup})</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="tabular-nums opacity-80 text-sm">
                            {fmtSpread(pk.spread)}
                          </span>
                          {pk.result && (
                            <span
                              className={
                                pk.result === 'win'
                                  ? 'text-green-500'
                                  : pk.result === 'loss'
                                  ? 'text-red-500'
                                  : 'opacity-70'
                              }
                            >
                              {pk.result}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">O/U Tie-breakers</h2>
            {ouPicks.length === 0 ? (
              <div className="border rounded p-3 opacity-70 text-sm">pending</div>
            ) : (
              ouPicks.map((o, i) => (
                <div className="border rounded p-3" key={`${o.player}-${i}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{o.player}</span>
                      <span className="opacity-70 text-sm">{o.matchup}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm">{o.side}</span>
                      <span className="tabular-nums text-sm">{o.total ?? ''}</span>
                      <span
                        className={
                          o.result === 'win'
                            ? 'text-green-500'
                            : o.result === 'loss'
                            ? 'text-red-500'
                            : 'opacity-70'
                        }
                      >
                        {o.result}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      ) : (
        <section className="space-y-2">
          {games.length === 0 ? (
            <div className="text-sm opacity-70">No games found.</div>
          ) : (
            games.map((g) => {
              const homeLogo = logos.get(g.home);
              const awayLogo = logos.get(g.away);
              return (
                <div key={g.id} className="border rounded p-3">
                  <div className="grid grid-cols-3 items-center">
                    {/* left: home */}
                    <div className="flex items-center gap-2">
                      <TinyLogo url={homeLogo} alt={g.home} />
                      <span className="font-medium">{g.home}</span>
                      <span className="ml-2 opacity-70 text-sm">
                        {fmtSpread(g.home_spread)}
                      </span>
                    </div>

                    {/* center: score */}
                    <div className="text-center">
                      <ScoreCell
                        home={g.live_home_score}
                        away={g.live_away_score}
                        isLive={g.is_live && !g.is_final}
                      />
                    </div>

                    {/* right: away */}
                    <div className="flex items-center justify-end gap-2">
                      <span className="mr-2 opacity-70 text-sm">
                        {fmtSpread(g.away_spread)}
                      </span>
                      <span className="font-medium">{g.away}</span>
                      <TinyLogo url={awayLogo} alt={g.away} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}
