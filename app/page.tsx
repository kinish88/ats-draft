'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/** ---------- Types returned by our RPCs ---------- */
type GameRow = {
  game_id: number;
  home: string;
  away: string;
  home_spread: number | null;
  away_spread: number | null;
  home_taken: boolean;
  away_taken: boolean;
  home_logo_url?: string | null;
  away_logo_url?: string | null;
};

type PickRow = {
  pick_number: number;
  picker: string;
  picked_team: string;
  picked_logo_url?: string | null;
  matchup: string;
  spread_at_pick: number;
  result: 'pending' | 'win' | 'loss' | 'push' | string;
  colour: 'green' | 'red' | 'orange' | 'grey' | string;
  created_at: string;
};

type OUPick = {
  picker: string;
  matchup: string;
  pick_side: 'over' | 'under';
  total_at_pick: number;
  result: 'pending' | 'win' | 'loss' | 'push' | string;
  colour: 'green' | 'red' | 'orange' | 'grey' | string;
  home_logo_url?: string | null;
  away_logo_url?: string | null;
};

type TotalsRow = { game_id: number; home: string; away: string; total_line: number };

const YEAR = 2025;
const WEEK = 1;

/** ---------- Small UI helpers ---------- */
function Spread({ v }: { v: number | null }) {
  if (v === null) return <span className="text-gray-400">n/a</span>;
  const sign = v > 0 ? '+' : '';
  const cls = v > 0 ? 'text-green-500' : 'text-red-500';
  return <span className={cls}>{sign}{v}</span>;
}

function ResultPill({ colour, text }: { colour: string; text: string }) {
  const map: Record<string, string> = {
    green: 'text-green-500',
    red: 'text-red-500',
    orange: 'text-orange-400',
    grey: 'text-gray-400',
  };
  return <span className={map[colour] ?? 'text-gray-400'}>{text}</span>;
}

function OUPickForm({
  games,
  onSubmit,
  disabled,
}: {
  games: TotalsRow[];
  onSubmit: (home: string, away: string, side: 'over' | 'under') => Promise<void>;
  disabled?: boolean;
}) {
  const [sel, setSel] = useState<string>('');
  const [side, setSide] = useState<'over' | 'under'>('over');

  return (
    <div className="p-3 border rounded space-y-2">
      <div className="font-medium">Make your O/U pick</div>
      <div className="flex gap-2 items-center">
        <select
          className="border rounded p-1 flex-1 bg-transparent"
          value={sel}
          onChange={(e) => setSel(e.target.value)}
        >
          <option value="">Select a game…</option>
          {games.map((g) => (
            <option key={g.game_id} value={`${g.home}|${g.away}`}>
              {g.home} v {g.away} — {g.total_line}
            </option>
          ))}
        </select>

        <select
          className="border rounded p-1 bg-transparent"
          value={side}
          onChange={(e) => setSide(e.target.value as 'over' | 'under')}
        >
          <option value="over">OVER</option>
          <option value="under">UNDER</option>
        </select>

        <button
          className="px-3 py-1 border rounded disabled:opacity-50"
          disabled={disabled || !sel}
          onClick={async () => {
            const [home, away] = sel.split('|');
            await onSubmit(home, away, side);
          }}
        >
          Submit O/U
        </button>
      </div>
      <p className="text-xs text-gray-400">One O/U per player per week (enforced server-side).</p>
    </div>
  );
}

/** ---------- Page ---------- */
export default function DraftPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [turn, setTurn] = useState<{ pick_number: number; display_name: string; email: string } | null>(null);

  const [games, setGames] = useState<GameRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [ouPicks, setOUPicks] = useState<OUPick[]>([]);
  const [totals, setTotals] = useState<TotalsRow[]>([]); // for O/U form (optional)

  const myTurn = useMemo(
    () => !!turn && userEmail?.toLowerCase() === turn.email?.toLowerCase(),
    [turn, userEmail]
  );

  async function loadAll() {
    // auth
    const sess = await supabase.auth.getSession();
    setUserEmail(sess.data.session?.user.email ?? null);

    // state
    const [gamesRes, picksRes, ouRes, turnRes] = await Promise.all([
      supabase.rpc('get_week_games_with_status', { p_year: YEAR, p_week: WEEK }),
      supabase.rpc('get_week_spread_picks_v2', { p_year: YEAR, p_week: WEEK }),
      supabase.rpc('get_week_ou_picks_v2', { p_year: YEAR, p_week: WEEK }),
      supabase.rpc('get_current_turn', { p_year: YEAR, p_week: WEEK }),
    ]);

    setGames((gamesRes.data as GameRow[]) ?? []);
    setPicks((picksRes.data as PickRow[]) ?? []);
    setOUPicks((ouRes.data as OUPick[]) ?? []);
    setTurn(((turnRes.data as any[]) ?? [])[0] ?? null);

    // optional totals list (if the RPC exists)
    const totalsRes = await supabase.rpc('get_week_totals', { p_year: YEAR, p_week: WEEK });
    if (!totalsRes.error) setTotals((totalsRes.data as TotalsRow[]) ?? []);
  }

  useEffect(() => {
    loadAll();

    // realtime refresh
    const ch1 = supabase
      .channel('picks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, loadAll)
      .subscribe();
    const ch2 = supabase
      .channel('drafts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drafts' }, loadAll)
      .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, []);

  async function pick(home: string, away: string, team: string) {
    if (!userEmail) {
      alert('Please log in');
      return;
    }
    const { data, error } = await supabase.rpc('make_pick_by_teams', {
      p_player_email: userEmail,
      p_year: YEAR,
      p_week_number: WEEK,
      p_home_short: home,
      p_away_short: away,
      p_pick_short: team,
    });

    if (error) alert(error.message);
    else if (data && (data as any)[0]?.ok === false) alert((data as any)[0]?.message);
    await loadAll();
  }

  async function submitOU(home: string, away: string, side: 'over' | 'under') {
    if (!userEmail) {
      alert('Please log in');
      return;
    }
    const { data, error } = await supabase.rpc('make_ou_pick_by_teams', {
      p_player_email: userEmail,
      p_year: YEAR,
      p_week_number: WEEK,
      p_home_short: home,
      p_away_short: away,
      p_pick_side: side,
    });
    if (error) alert(error.message);
    else if (data && (data as any)[0]?.ok === false) alert((data as any)[0]?.message);
    await loadAll();
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Week {WEEK} Draft</h1>
        <div className="text-sm">
          {userEmail ? (
            <>
              Signed in as <b>{userEmail}</b> •{' '}
              <a className="underline" href="/login">
                Switch
              </a>
            </>
          ) : (
            <a className="underline" href="/login">
              Login
            </a>
          )}
        </div>
      </header>

      {turn && (
        <div className="p-3 rounded border">
          Current pick #{turn.pick_number}: <b>{turn.display_name}</b>
          {myTurn ? ' — your turn' : ''}
        </div>
      )}

      {/* Games list */}
      <section className="space-y-3">
        {games.map((g) => {
          const bothTaken = g.home_taken && g.away_taken;
          if (bothTaken) return null;

          return (
            <div key={g.game_id} className="grid grid-cols-3 gap-3 items-center p-3 rounded border">
              {/* LEFT (home) */}
              <div className="flex gap-2 items-center">
                {g.home_logo_url && (
                  <img src={g.home_logo_url} alt={g.home} className="h-6 w-6 object-contain" />
                )}
                <span className={g.home_taken ? 'line-through text-gray-500' : ''}>{g.home}</span>
                <Spread v={g.home_spread} />
              </div>

              {/* CENTER */}
              <div className="text-center">v</div>

              {/* RIGHT (away) */}
              <div className="flex gap-2 items-center justify-end">
                <Spread v={g.away_spread} />
                <span className={g.away_taken ? 'line-through text-gray-500' : ''}>{g.away}</span>
                {g.away_logo_url && (
                  <img src={g.away_logo_url} alt={g.away} className="h-6 w-6 object-contain" />
                )}
              </div>

              {/* Buttons */}
              <div className="col-span-3 flex justify-end gap-2">
                <button
                  disabled={!myTurn || g.home_taken}
                  onClick={() => pick(g.home, g.away, g.home)}
                  className="px-3 py-1 border rounded disabled:opacity-50"
                >
                  Pick {g.home}
                </button>
                <button
                  disabled={!myTurn || g.away_taken}
                  onClick={() => pick(g.home, g.away, g.away)}
                  className="px-3 py-1 border rounded disabled:opacity-50"
                >
                  Pick {g.away}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {/* Spread picks list */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Picks</h2>
        <div className="space-y-1">
          {picks.map((p) => (
            <div
              key={`${p.pick_number}-${p.picker}-${p.picked_team}-${p.created_at}`}
              className="grid grid-cols-7 gap-2 text-sm p-2 border rounded items-center"
            >
              <div>#{p.pick_number}</div>
              <div>{p.picker}</div>
              <div className="flex items-center gap-2">
                {p.picked_logo_url && (
                  <img
                    src={p.picked_logo_url}
                    alt={p.picked_team}
                    className="h-5 w-5 object-contain"
                  />
                )}
                <span>{p.picked_team}</span>
              </div>
              <div className="col-span-2">{p.matchup}</div>
              <div>{p.spread_at_pick}</div>
              <div>
                <ResultPill colour={p.colour} text={p.result} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* O/U form (optional) */}
      {userEmail && totals.length > 0 && (
        <OUPickForm games={totals} onSubmit={submitOU} />
      )}

      {/* O/U picks list */}
      <section>
        <h2 className="text-xl font-semibold mb-2">O/U Tie-breakers</h2>
        <div className="space-y-1">
          {ouPicks.map((p) => (
            <div
              key={`${p.picker}-${p.matchup}`}
              className="grid grid-cols-6 gap-2 text-sm p-2 border rounded items-center"
            >
              <div>{p.picker}</div>
              <div className="col-span-2 flex items-center gap-2">
                {p.home_logo_url && (
                  <img src={p.home_logo_url} alt="home" className="h-5 w-5 object-contain" />
                )}
                <span>{p.matchup}</span>
                {p.away_logo_url && (
                  <img src={p.away_logo_url} alt="away" className="h-5 w-5 object-contain" />
                )}
              </div>
              <div className="uppercase">{p.pick_side}</div>
              <div>{p.total_at_pick}</div>
              <div>
                <ResultPill colour={p.colour} text={p.result} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
