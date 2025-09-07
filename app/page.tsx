'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type GameRow = {
  game_id: number;
  home: string; away: string;
  home_spread: number | null; away_spread: number | null;
  home_taken: boolean; away_taken: boolean;
  home_logo_url?: string | null; away_logo_url?: string | null;
};
type PickRow = {
  pick_number: number; picker: string; picked_team: string;
  picked_logo_url?: string | null;
  matchup: string; spread_at_pick: number;
  result: 'pending'|'win'|'loss'|'push'|string; colour: 'green'|'red'|'orange'|'grey'|string;
  created_at: string;
};
type OUPick = {
  picker: string; matchup: string; pick_side: 'over'|'under';
  total_at_pick: number; result: 'pending'|'win'|'loss'|'push'|string; colour: 'green'|'red'|'orange'|'grey'|string;
  home_logo_url?: string | null; away_logo_url?: string | null;
};
type TotalsRow = { game_id: number; home: string; away: string; total_line: number };
type TurnRow = { pick_number: number; display_name: string; email: string };
type WeekOption = { week_number: number };

type WeekSummaryRow = {
  display_name: string;
  spread_wins: number;
  spread_losses: number;
  spread_pushes: number;
  ou_result: string;
  is_gold_winner: boolean;
  is_ou_winner: boolean;
};

type MakePickResult = { ok: boolean; message: string | null };
type MakeOUPickResult = { ok: boolean; message: string | null };

const YEAR = 2025;

function Spread({ v }: { v: number | null }) {
  if (v === null) return <span className="text-gray-400">n/a</span>;
  const sign = v > 0 ? '+' : '';
  const cls = v > 0 ? 'text-green-500' : 'text-red-500';
  return <span className={cls}>{sign}{v}</span>;
}
function ResultPill({ colour, text }: { colour: string; text: string }) {
  const map: Record<string,string> = { green:'text-green-500', red:'text-red-500', orange:'text-orange-400', grey:'text-gray-400' };
  return <span className={map[colour] ?? 'text-gray-400'}>{text}</span>;
}

export default function DraftPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);

  const [turn, setTurn] = useState<TurnRow | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [ouPicks, setOUPicks] = useState<OUPick[]>([]);
  const [totals, setTotals] = useState<TotalsRow[]>([]);
  const [summary, setSummary] = useState<WeekSummaryRow[]>([]);

  const myTurn = useMemo(() => !!turn && userEmail?.toLowerCase() === turn.email?.toLowerCase(), [turn, userEmail]);

  async function loadWeeks() {
    const { data, error } = await supabase.rpc('list_weeks', { p_year: YEAR });
    if (!error && data) setWeeks((data as WeekOption[]).map(w => w.week_number));
    else setWeeks(Array.from({length:18}, (_,i)=>i+1));
  }

  async function loadAll() {
    const sess = await supabase.auth.getSession();
    setUserEmail(sess.data.session?.user.email ?? null);

    const [gRes, sRes, oRes, tRes, sumRes] = await Promise.all([
      supabase.rpc('get_week_games_with_status', { p_year: YEAR, p_week: week }),
      supabase.rpc('get_week_spread_picks_v2', { p_year: YEAR, p_week: week }),
      supabase.rpc('get_week_ou_picks_v2', { p_year: YEAR, p_week: week }),
      supabase.rpc('get_current_turn', { p_year: YEAR, p_week: week }),
      supabase.rpc('get_week_summary', { p_year: YEAR, p_week: week }),
    ]);

    setGames((gRes.data as GameRow[]) ?? []);
    setPicks((sRes.data as PickRow[]) ?? []);
    setOUPicks((oRes.data as OUPick[]) ?? []);
    setTurn(((tRes.data as TurnRow[] | null)?.[0]) ?? null);
    setSummary((sumRes.data as WeekSummaryRow[]) ?? []);

    const tots = await supabase.rpc('get_week_totals', { p_year: YEAR, p_week: week });
    if (!tots.error) setTotals((tots.data as TotalsRow[]) ?? []);
  }

  useEffect(() => { loadWeeks(); }, []);
  useEffect(() => { loadAll(); }, [week]);

  useEffect(() => {
    const ch1 = supabase.channel('picks').on('postgres_changes', { event:'*', schema:'public', table:'picks' }, loadAll).subscribe();
    const ch2 = supabase.channel('drafts').on('postgres_changes', { event:'*', schema:'public', table:'drafts' }, loadAll).subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, [week]);

  async function pick(home: string, away: string, team: string) {
    if (!userEmail) { alert('Please log in'); return; }
    const { data, error } = await supabase.rpc('make_pick_by_teams', {
      p_player_email: userEmail, p_year: YEAR, p_week_number: week,
      p_home_short: home, p_away_short: away, p_pick_short: team
    });
    if (error) alert(error.message);
    else {
      const res = (data as MakePickResult[] | null)?.[0];
      if (res && res.ok === false) alert(res.message ?? 'Pick not allowed');
    }
    await loadAll();
  }

  async function submitOU(home: string, away: string, side: 'over'|'under') {
    if (!userEmail) { alert('Please log in'); return; }
    const { data, error } = await supabase.rpc('make_ou_pick_by_teams', {
      p_player_email: userEmail, p_year: YEAR, p_week_number: week,
      p_home_short: home, p_away_short: away, p_pick_side: side
    });
    if (error) alert(error.message);
    else {
      const res = (data as MakeOUPickResult[] | null)?.[0];
      if (res && res.ok === false) alert(res.message ?? 'O/U not allowed');
    }
    await loadAll();
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold">Week {week} Draft</h1>
          <select
            className="border rounded p-1 bg-transparent"
            value={week}
            onChange={(e)=>setWeek(parseInt(e.target.value,10))}
          >
            {weeks.map(w => <option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>
        <div className="text-sm">
          {userEmail ? <>Signed in as <b>{userEmail}</b> • <Link className="underline" href="/login">Switch</Link></> : <Link className="underline" href="/login">Login</Link>}
          {' '}• <Link className="underline" href="/admin">Admin</Link>
        </div>
      </header>

      {turn && (
        <div className="p-3 rounded border">
          Current pick #{turn.pick_number}: <b>{turn.display_name}</b>{myTurn ? ' — your turn' : ''}
        </div>
      )}

      {/* Games list */}
      <section className="space-y-3">
        {games.map(g => {
          const bothTaken = g.home_taken && g.away_taken;
          if (bothTaken) return null;
          return (
            <div key={g.game_id} className="grid grid-cols-3 gap-3 items-center p-3 rounded border">
              <div className="flex gap-2 items-center">
                {g.home_logo_url && <img src={g.home_logo_url} alt={g.home} className="h-6 w-6 object-contain" />}
                <span className={g.home_taken ? 'line-through text-gray-500' : ''}>{g.home}</span>
                <Spread v={g.home_spread} />
              </div>
              <div className="text-center">v</div>
              <div className="flex gap-2 items-center justify-end">
                <Spread v={g.away_spread} />
                <span className={g.away_taken ? 'line-through text-gray-500' : ''}>{g.away}</span>
                {g.away_logo_url && <img src={g.away_logo_url} alt={g.away} className="h-6 w-6 object-contain" />}
              </div>
              <div className="col-span-3 flex justify-end gap-2">
                <button disabled={!myTurn || g.home_taken} onClick={()=>pick(g.home,g.away,g.home)} className="px-3 py-1 border rounded disabled:opacity-50">Pick {g.home}</button>
                <button disabled={!myTurn || g.away_taken} onClick={()=>pick(g.home,g.away,g.away)} className="px-3 py-1 border rounded disabled:opacity-50">Pick {g.away}</button>
              </div>
            </div>
          );
        })}
      </section>

      {/* Picks */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Picks</h2>
        <div className="space-y-1">
          {picks.map(p => (
            <div key={`${p.pick_number}-${p.picker}-${p.picked_team}-${p.created_at}`} className="grid grid-cols-7 gap-2 text-sm p-2 border rounded items-center">
              <div>#{p.pick_number}</div>
              <div>{p.picker}</div>
              <div className="flex items-center gap-2">
                {p.picked_logo_url && <img src={p.picked_logo_url} alt={p.picked_team} className="h-5 w-5 object-contain" />}
                <span>{p.picked_team}</span>
              </div>
              <div className="col-span-2">{p.matchup}</div>
              <div>{p.spread_at_pick}</div>
              <div><ResultPill colour={p.colour} text={p.result} /></div>
            </div>
          ))}
        </div>
      </section>

      {/* O/U form (optional) */}
      {userEmail && totals.length > 0 && (
        <div className="mt-4">
          <div className="font-semibold mb-2">O/U (Tie-breaker)</div>
          <div className="p-3 border rounded space-y-2">
            <div className="text-sm text-gray-400 mb-1">Make one O/U pick per week.</div>
            {/* small inline form */}
            <div className="flex gap-2 items-center">
              <select className="border rounded p-1 bg-transparent" defaultValue="">
                <option value="">Select a game…</option>
                {totals.map(g => <option key={g.game_id} value={`${g.home}|${g.away}`}>{g.home} v {g.away} — {g.total_line}</option>)}
              </select>
              {/* For brevity, use the admin page if you want a full widget; earlier message had a full OUPickForm component */}
            </div>
          </div>
        </div>
      )}

      {/* O/U picks */}
      <section>
        <h2 className="text-xl font-semibold mb-2">O/U Tie-breakers</h2>
        <div className="space-y-1">
          {ouPicks.map(p => (
            <div key={`${p.picker}-${p.matchup}`} className="grid grid-cols-6 gap-2 text-sm p-2 border rounded items-center">
              <div>{p.picker}</div>
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
        </div>
      </section>

      {/* Week Summary */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Week Summary</h2>
        <div className="space-y-1">
          {summary.map(s => (
            <div key={s.display_name} className="grid grid-cols-7 gap-2 text-sm p-2 border rounded items-center">
              <div className="font-medium">{s.display_name}</div>
              <div>Wins: {s.spread_wins}</div>
              <div>Losses: {s.spread_losses}</div>
              <div>Pushes: {s.spread_pushes}</div>
              <div>O/U: {s.ou_result}</div>
              <div className="col-span-2">
                {s.is_gold_winner && <span className="text-yellow-400 font-semibold">🏅 Gold winner</span>}
                {!s.is_gold_winner && s.is_ou_winner && <span className="text-emerald-400 font-semibold">✅ Wins by O/U</span>}
              </div>
            </div>
          ))}
          {summary.every(s => !s.is_gold_winner && !s.is_ou_winner) && (
            <div className="text-sm text-gray-400">No weekly winner yet (either pending or tie/push).</div>
          )}
        </div>
      </section>
    </div>
  );
}
