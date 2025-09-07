'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

/** ---------- Types ---------- */
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

type WeekOption = { week_number: number };

type SeasonRow = {
  display_name: string;
  spread_wins: number;
  spread_losses: number;
  spread_pushes: number;
  ou_wins: number;
  ou_losses: number;
  ou_pushes: number;
};

type WeekSummaryRow = {
  display_name: string;
  spread_wins: number;
  spread_losses: number;
  spread_pushes: number;
  ou_result: string;
  is_gold_winner: boolean;
  is_ou_winner: boolean;
};

const YEAR = 2025;

/** ---------- Small UI helpers ---------- */
function ResultPill({ colour, text }: { colour: string; text: string }) {
  const map: Record<string, string> = {
    green: 'text-green-500',
    red: 'text-red-500',
    orange: 'text-orange-400',
    grey: 'text-gray-400',
  };
  return <span className={map[colour] ?? 'text-gray-400'}>{text}</span>;
}

/** ---------- Page ---------- */
export default function ScoreboardPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);

  const [picks, setPicks] = useState<PickRow[]>([]);
  const [ouPicks, setOUPicks] = useState<OUPick[]>([]);
  const [season, setSeason] = useState<SeasonRow[]>([]);
  const [weekSummary, setWeekSummary] = useState<WeekSummaryRow[]>([]);

  // Group spread picks by player, in your preferred order
  const grouped = useMemo(() => {
    const by: Record<string, PickRow[]> = {};
    for (const p of picks) {
      if (!by[p.picker]) by[p.picker] = [];
      by[p.picker].push(p);
    }
    Object.values(by).forEach(arr => arr.sort((a, b) => a.pick_number - b.pick_number));

    const preferred = ['Big Dawg', 'Pud', 'Kinish'];
    const names = Object.keys(by);
    const sortedNames = names.sort((a, b) => {
      const ia = preferred.indexOf(a);
      const ib = preferred.indexOf(b);
      const va = ia === -1 ? 99 + a.localeCompare(b) : ia; // unknowns go after, alphabetically
      const vb = ib === -1 ? 99 + b.localeCompare(a) : ib;
      return va - vb;
    });

    return sortedNames.map(name => ({ name, picks: by[name] }));
  }, [picks]);

  // Winner banner text (gold or O/U)
  const winnerText = useMemo(() => {
    if (!weekSummary.length) return 'No winner yet — scores pending or tie/push.';
    const gold = weekSummary.find(r => r.is_gold_winner);
    if (gold) return `🏅 ${gold.display_name} wins Week ${week} (3–0 gold)!`;
    const ou = weekSummary.find(r => r.is_ou_winner);
    if (ou) return `✅ ${ou.display_name} wins Week ${week} via O/U tiebreaker.`;
    return 'No winner yet — scores pending or tie/push.';
  }, [weekSummary, week]);

  async function loadWeeks() {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    if (data) setWeeks((data as WeekOption[]).map(w => w.week_number));
    else setWeeks(Array.from({ length: 18 }, (_, i) => i + 1));
  }

  async function loadData() {
    const sess = await supabase.auth.getSession();
    setUserEmail(sess.data.session?.user.email ?? null);

    const [spreads, ous, seasonRes, wsRes] = await Promise.all([
      supabase.rpc('get_week_spread_picks_v2', { p_year: YEAR, p_week: week }),
      supabase.rpc('get_week_ou_picks_v2', { p_year: YEAR, p_week: week }),
      supabase.rpc('get_season_standings', { p_year: YEAR }),
      supabase.rpc('get_week_summary', { p_year: YEAR, p_week: week }),
    ]);

    setPicks((spreads.data as PickRow[]) ?? []);
    setOUPicks((ous.data as OUPick[]) ?? []);
    setSeason((seasonRes.data as SeasonRow[]) ?? []);
    setWeekSummary((wsRes.data as WeekSummaryRow[]) ?? []);
  }

  useEffect(() => { loadWeeks(); }, []);
  useEffect(() => { loadData(); }, [week]);

  useEffect(() => {
    const ch1 = supabase
      .channel('picks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, loadData)
      .subscribe();
    const ch2 = supabase
      .channel('ou_picks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ou_picks' }, loadData)
      .subscribe();
    // If you enable realtime on `games`, uncomment below to refresh on score changes too.
    // const ch3 = supabase
    //   .channel('games')
    //   .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, loadData)
    //   .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      // supabase.removeChannel(ch3);
    };
  }, [week]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold">Week {week} — Scoreboard</h1>
          <select
            className="border rounded p-1 bg-transparent"
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10))}
          >
            {weeks.map(w => <option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>
        <div className="text-sm">
          {userEmail ? <>Signed in as <b>{userEmail}</b> • <Link className="underline" href="/login">Switch</Link></> : <Link className="underline" href="/login">Login</Link>}
          {' '}• <Link className="underline" href="/admin">Admin</Link>
          {' '}• <Link className="underline" href="/standings">Standings</Link>
        </div>
      </header>

      {/* Week Winner banner */}
      <div className="p-3 rounded border">{winnerText}</div>

      {/* PICKS grouped by player */}
      <section>
        <h2 className="text-xl font-semibold mb-3">Picks</h2>
        <div className="grid md:grid-cols-3 gap-3">
          {grouped.map(g => (
            <div key={g.name} className="border rounded p-3">
              <div className="font-medium mb-2">{g.name}</div>
              <div className="space-y-2">
                {g.picks.map(p => (
                  <div key={`${p.pick_number}-${p.picked_team}-${p.created_at}`} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      {p.picked_logo_url && <img src={p.picked_logo_url} alt={p.picked_team} className="h-5 w-5 object-contain" />}
                      <span className="font-medium">{p.picked_team}</span>
                      <span className="text-gray-400">({p.matchup})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>{p.spread_at_pick}</span>
                      <ResultPill colour={p.colour} text={p.result} />
                    </div>
                  </div>
                ))}
                {g.picks.length === 0 && <div className="text-xs text-gray-400">No picks.</div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* O/U Tie-breakers */}
      <section>
        <h2 className="text-xl font-semibold mb-2">O/U Tie-breakers</h2>
        <div className="space-y-1">
          {ouPicks.map(p => (
            <div key={`${p.picker}-${p.matchup}`} className="grid grid-cols-6 gap-2 text-sm p-2 border rounded items-center">
              <div className="font-medium">{p.picker}</div>
              <div className="col-span-2 flex items-center gap-2">
                {p.home_logo_url && <img src={p.home_logo_url} alt="home" className="h-5 w-5 object-contain" />}
                <span>{p.matchup}</span>
                {p.away_logo_url && <img src={p.away_logo_url} alt="away" className="h-5 w-5 object-contain" />}
              </div>
              <div className="uppercase">{p.pick_side}</div>
              <div>{p.total_at_pick}</div>
              <div><ResultPill colour={p.colour} text={p.result} /></div>
            </div>
          ))}
          {ouPicks.length === 0 && <div className="text-sm text-gray-400">No O/U picks.</div>}
        </div>
      </section>

      {/* Season Summary */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Season Summary</h2>
        <div className="border rounded overflow-hidden">
          <div className="grid grid-cols-7 gap-2 text-sm font-medium p-2 border-b bg-black/30">
            <div>Player</div>
            <div className="text-center">ATS W</div>
            <div className="text-center">ATS L</div>
            <div className="text-center">ATS P</div>
            <div className="text-center">OU W</div>
            <div className="text-center">OU L</div>
            <div className="text-center">OU P</div>
          </div>
          {season.map(r => (
            <div key={r.display_name} className="grid grid-cols-7 gap-2 text-sm p-2 border-b last:border-b-0">
              <div className="font-medium">{r.display_name}</div>
              <div className="text-center">{r.spread_wins}</div>
              <div className="text-center">{r.spread_losses}</div>
              <div className="text-center">{r.spread_pushes}</div>
              <div className="text-center">{r.ou_wins}</div>
              <div className="text-center">{r.ou_losses}</div>
              <div className="text-center">{r.ou_pushes}</div>
            </div>
          ))}
          {season.length === 0 && <div className="p-3 text-sm text-gray-400">No data yet.</div>}
        </div>
      </section>
    </div>
  );
}
