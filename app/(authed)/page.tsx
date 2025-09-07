'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;

/* ================================ types ================================ */

type Team = { short_name: string; logo_url: string | null };

type GameRow = {
  game_id: number;
  home: string; // short
  away: string; // short
  home_score: number | null;
  away_score: number | null;
  is_final?: boolean | null;
};

type BoardRow = {
  game_id: number;
  home: string;
  away: string;
  // lines (various DB shapes supported, we normalize in code)
  spread_home?: number | null;
  spread_away?: number | null;
  spread?: number | null; // single line (home is usually negative)
  // live/final
  live_home_score?: number | null;
  live_away_score?: number | null;
  home_score?: number | null;
  away_score?: number | null;
  is_live?: boolean | null;
  is_final?: boolean | null;
  kickoff?: string | null;
};

type SpreadPickRow = {
  pick_number: number;
  player_name: string;
  team_short?: string;
  opponent_short?: string;
  home_short?: string;
  away_short?: string;
  spread?: number | null;
};

type OuPickRow = {
  player_name: string;
  home_short?: string;
  away_short?: string;
  choice?: 'OVER' | 'UNDER' | string | null;
  total?: number | null;
};

type PlayerCard = {
  name: string;
  picks: {
    team: string;
    opp: string;
    spread: number | null;
    result: 'win' | 'loss' | 'push' | 'pending';
  }[];
};

type OuCard = {
  name: string;
  home: string;
  away: string;
  choice: 'OVER' | 'UNDER';
  total: number;
  result: 'win' | 'loss' | 'push' | 'pending';
};

/* =============================== helpers =============================== */

function plus(num: number | null | undefined): string {
  if (num == null) return '';
  if (num === 0) return 'PK';
  return num > 0 ? `+${num}` : `${num}`;
}

function toNum(x: unknown): number | null {
  if (x == null) return null;
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function keyPair(a: string, b: string) {
  return `${a}__${b}`;
}

function resultForATS(
  g: GameRow | BoardRow | undefined,
  pickedTeam: string,
  spreadForPick: number | null
): 'win' | 'loss' | 'push' | 'pending' {
  const hs = (g?.home_score ?? null) || (g as BoardRow | undefined)?.live_home_score ?? null;
  const as = (g?.away_score ?? null) || (g as BoardRow | undefined)?.live_away_score ?? null;
  const isFinal = Boolean((g as BoardRow | undefined)?.is_final ?? (g as GameRow | undefined)?.is_final);

  if (hs == null || as == null || !isFinal) return 'pending';

  const s = spreadForPick ?? 0;
  const diff =
    pickedTeam === g?.home
      ? hs - as
      : pickedTeam === g?.away
      ? as - hs
      : 0;
  const cover = diff + s;
  if (cover > 0) return 'win';
  if (cover < 0) return 'loss';
  return 'push';
}

function resultForOU(
  g: GameRow | BoardRow | undefined,
  choice: 'OVER' | 'UNDER',
  total: number
): 'win' | 'loss' | 'push' | 'pending' {
  const hs = (g?.home_score ?? null) || (g as BoardRow | undefined)?.live_home_score ?? null;
  const as = (g?.away_score ?? null) || (g as BoardRow | undefined)?.live_away_score ?? null;
  const isFinal = Boolean((g as BoardRow | undefined)?.is_final ?? (g as GameRow | undefined)?.is_final);

  if (hs == null || as == null || !isFinal) return 'pending';
  const sum = hs + as;
  if (sum > total) return choice === 'OVER' ? 'win' : 'loss';
  if (sum < total) return choice === 'UNDER' ? 'win' : 'loss';
  return 'push';
}

/* ============================== tiny cells ============================= */

function TinyLogo({ url, alt }: { url?: string | null; alt: string }) {
  if (!url) return <span className="inline-block w-4 h-4 mr-2 align-middle" />;
  return (
    <img
      src={url}
      alt={alt}
      className="inline-block w-4 h-4 mr-2 align-middle"
      width={16}
      height={16}
      loading="lazy"
    />
  );
}

function StatusPill({ status }: { status: 'win' | 'loss' | 'push' | 'pending' }) {
  const color =
    status === 'win'
      ? 'text-green-400'
      : status === 'loss'
      ? 'text-red-400'
      : status === 'push'
      ? 'text-yellow-300'
      : 'text-gray-300';
  return <span className={`text-sm ${color}`}>{status}</span>;
}

function ScoreCell({
  row,
}: {
  row: BoardRow;
}) {
  const hs = row.live_home_score ?? row.home_score ?? null;
  const as = row.live_away_score ?? row.away_score ?? null;
  const live = Boolean(row.is_live) && !row.is_final;

  if (hs == null || as == null) return <span className="opacity-50">—</span>;
  return (
    <span className={`tabular-nums ${live ? 'animate-pulse' : ''}`}>
      {hs} — {as}
    </span>
  );
}

/* ================================ page ================================= */

export default function ScoreboardPage() {
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [cards, setCards] = useState<PlayerCard[]>([]);
  const [ouCards, setOuCards] = useState<OuCard[]>([]);
  const [logos, setLogos] = useState<Map<string, string | null>>(new Map());
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [full, setFull] = useState<boolean>(false);

  // load week options
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
      if (data && Array.isArray(data)) {
        const ws = (data as { week_number: number }[]).map((w) => w.week_number);
        setWeeks(ws);
      } else {
        setWeeks(Array.from({ length: 18 }, (_, i) => i + 1));
      }
    })();
  }, []);

  // load everything for a week
  useEffect(() => {
    (async () => {
      setLoading(true);

      // team logos
      const { data: tms } = await supabase.from('teams').select('short_name, logo_url');
      const logosMap = new Map<string, string | null>();
      (tms as Team[] | null)?.forEach((t) => logosMap.set(t.short_name, t.logo_url ?? null));
      setLogos(logosMap);

      // games (full board + lines if available)
      let boardRows: BoardRow[] = [];
      const { data: boardTry } = await supabase.rpc('get_week_games_with_status', {
        p_year: YEAR,
        p_week: week,
      });
      if (boardTry && Array.isArray(boardTry)) {
        boardRows = boardTry as BoardRow[];
      } else {
        // fallback: no lines, just scores
        const { data: games } = await supabase.rpc('get_week_games_for_scoring', {
          p_year: YEAR,
          p_week: week,
        });
        boardRows =
          (games as GameRow[] | null)?.map((g) => ({
            game_id: g.game_id,
            home: g.home,
            away: g.away,
            home_score: g.home_score,
            away_score: g.away_score,
            is_final: g.is_final ?? null,
            is_live: false,
          })) ?? [];
      }
      // normalize lines if DB sends a single "spread" (home negative)
      const normalized = boardRows.map((r) => {
        const homeLine =
          toNum((r as Record<string, unknown>)['spread_home']) ??
          toNum((r as Record<string, unknown>)['home_spread']) ??
          toNum((r as Record<string, unknown>)['line_home']) ??
          (toNum((r as Record<string, unknown>)['spread']) !== null
            ? toNum((r as Record<string, unknown>)['spread'])
            : null);

        const awayLine =
          homeLine !== null
            ? -homeLine
            : toNum((r as Record<string, unknown>)['spread_away']) ??
              toNum((r as Record<string, unknown>)['away_spread']) ??
              toNum((r as Record<string, unknown>)['line_away']);

        return { ...r, spread_home: homeLine, spread_away: awayLine };
      });
      setBoard(normalized);

      // quick map to compute results for picks
      const byPair = new Map<string, BoardRow>();
      for (const g of normalized) {
        byPair.set(keyPair(g.home, g.away), g);
        byPair.set(keyPair(g.away, g.home), g);
      }

      // spread picks (group later)
      const { data: sp } = await supabase.rpc('get_week_spread_picks_admin', {
        p_year: YEAR,
        p_week: week,
      });
      const spreadRows = (sp as SpreadPickRow[] | null) ?? [];

      // O/U picks
      const { data: oup } = await supabase.rpc('get_week_ou_picks_admin', {
        p_year: YEAR,
        p_week: week,
      });
      const ouRows = (oup as OuPickRow[] | null) ?? [];

      // ----- shape spread cards -----
      const byPlayer = new Map<string, PlayerCard>();
      for (const r of spreadRows) {
        const player = r.player_name;
        const team =
          r.team_short ??
          (r.home_short && r.opponent_short ? r.home_short : '') ??
          '';
        const opp =
          r.opponent_short ??
          (r.home_short && r.opponent_short ? r.away_short ?? r.opponent_short : r.opponent_short ?? '') ??
          '';

        const t = (team || '').toUpperCase();
        const o = (opp || '').toUpperCase();

        const spreadVal =
          toNum(r.spread) ??
          toNum((r as unknown as Record<string, unknown>)['pick_spread']) ??
          toNum((r as unknown as Record<string, unknown>)['line']) ??
          null;

        const g = byPair.get(keyPair(t, o));
        const res = resultForATS(g, t, spreadVal);

        const card = byPlayer.get(player) ?? { name: player, picks: [] };
        card.picks.push({ team: t, opp: o, spread: spreadVal, result: res });
        byPlayer.set(player, card);
      }
      const cardsArr = Array.from(byPlayer.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      setCards(cardsArr);

      // ----- shape O/U cards -----
      const ouByPlayer = new Map<string, OuCard>();
      for (const r of ouRows) {
        const name = r.player_name;
        const home = (r.home_short ?? '').toUpperCase();
        const away = (r.away_short ?? '').toUpperCase();
        const choice = (r.choice ?? 'OVER').toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
        const total = toNum(r.total) ?? 0;

        const g = byPair.get(keyPair(home, away));
        const res = resultForOU(g, choice as 'OVER' | 'UNDER', total);

        ouByPlayer.set(name, { name, home, away, choice: choice as 'OVER' | 'UNDER', total, result: res });
      }
      setOuCards(Array.from(ouByPlayer.values()).sort((a, b) => a.name.localeCompare(b.name)));

      setLoading(false);
    })();
  }, [week]);

  /* =============================== render =============================== */

  const weekTitle = useMemo(() => `Week ${week} Scoreboard`, [week]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* top bar */}
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{weekTitle}</h1>
        <nav className="flex items-center gap-4 text-sm">
          <Link className="underline" href="/(authed)/draft">Draft</Link>
          <span>•</span>
          <Link className="underline" href="/(authed)/standings">Standings</Link>
          <span>•</span>
          <Link className="underline" href="/(authed)/admin">Admin</Link>
        </nav>
      </header>

      {/* controls */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-80">Week</span>
          <select
            className="border rounded bg-transparent px-2 py-1"
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10))}
          >
            {weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </div>

        <label className="text-sm flex items-center gap-2 select-none">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          Show full scoreboard
        </label>
      </div>

      {/* picks grouped by player */}
      <section>
        <h2 className="text-lg font-medium mb-2">Picks</h2>

        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="space-y-3">
            {cards.map((c) => (
              <div key={c.name} className="border rounded p-3">
                <div className="font-semibold mb-2">{c.name}</div>

                {c.picks.length === 0 ? (
                  <div className="text-sm text-gray-400">No picks</div>
                ) : (
                  c.picks.map((p, idx) => (
                    <div
                      key={`${c.name}-${idx}-${p.team}`}
                      className="flex items-center justify-between py-1"
                    >
                      <div className="flex items-center gap-2">
                        <TinyLogo url={logos.get(p.team)} alt={p.team} />
                        <span className="font-medium">{p.team}</span>
                        <span className="text-sm opacity-70">
                          ({p.team} v {p.opp})
                        </span>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="text-sm opacity-80">{plus(p.spread)}</span>
                        <StatusPill status={p.result} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* FULL SCOREBOARD (toggle) */}
      {full && (
        <section>
          <h2 className="text-lg font-medium mb-2">Week {week} Scoreboard</h2>
          {loading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : (
            <div className="space-y-2">
              {board.map((r) => (
                <div key={r.game_id} className="border rounded p-2">
                  <div className="grid grid-cols-5 gap-2 items-center">
                    {/* left (home) */}
                    <div className="flex items-center gap-2">
                      <TinyLogo url={logos.get(r.home)} alt={r.home} />
                      <span className="font-medium">{r.home}</span>
                      <span className="text-sm opacity-80">{plus(r.spread_home ?? null)}</span>
                    </div>

                    {/* center */}
                    <div className="col-span-2 text-center">
                      <span className="text-sm opacity-70">v</span>
                    </div>

                    {/* score */}
                    <div className="text-center">
                      <ScoreCell row={r} />
                    </div>

                    {/* right (away) */}
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-sm opacity-80">{plus(r.spread_away ?? null)}</span>
                      <span className="font-medium">{r.away}</span>
                      <TinyLogo url={logos.get(r.away)} alt={r.away} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* O/U tie-breakers */}
      <section>
        <h2 className="text-lg font-medium mb-2">O/U Tie-breakers</h2>

        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="space-y-3">
            {ouCards.map((o) => (
              <div key={o.name} className="border rounded p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TinyLogo url={logos.get(o.home)} alt={o.home} />
                  <span className="font-medium">{o.name}</span>
                  <span className="text-sm opacity-80 ml-3">
                    {o.home} v {o.away} · {o.choice} {o.total}
                  </span>
                </div>
                <StatusPill status={o.result} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* footer links (small) */}
      <div className="text-sm opacity-70 space-x-3">
        <Link className="underline" href="/(authed)/draft">Draft</Link>
        <span>•</span>
        <Link className="underline" href="/(authed)/standings">Standings</Link>
        <span>•</span>
        <Link className="underline" href="/(authed)/admin">Admin</Link>
      </div>
    </div>
  );
}
