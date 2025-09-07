'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type GameForScore = {
  game_id: number;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  kickoff: string;
  home_spread_pickers?: string[];
  away_spread_pickers?: string[];
  ou_over_pickers?: string[];
  ou_under_pickers?: string[];
};
type WeekOption = { week_number: number };

type AdminSpreadRow = {
  pick_id: number; // BIGINT from DB
  pick_number: number;
  player: string;
  home_short: string;
  away_short: string;
  team_short: string;
  spread_at_pick: number;
};

type AdminOURow = {
  player: string;
  home_short: string;
  away_short: string;
  pick_side: 'over' | 'under';
  total_at_pick: number;
};

const YEAR = 2025;

export default function AdminScoresPage() {
  const router = useRouter();

  // --- Admin guard ---
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // --- Scores UI state ---
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [rows, setRows] = useState<GameForScore[]>([]);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [onlyPicked, setOnlyPicked] = useState<boolean>(true);

  // --- Admin editors state ---
  const [spreadsAdmin, setSpreadsAdmin] = useState<AdminSpreadRow[]>([]);
  const [ouAdmin, setOuAdmin] = useState<AdminOURow[]>([]);
  const [spreadEdits, setSpreadEdits] = useState<Record<number, number>>({});
  const [ouSideEdits, setOuSideEdits] = useState<Record<string, 'over' | 'under'>>({});
  const [ouTotalEdits, setOuTotalEdits] = useState<Record<string, number>>({});

  // Utility key for OU per row
  const ouKey = (r: AdminOURow) => `${r.player}|${r.home_short}|${r.away_short}`;

  // --- Admin guard effect ---
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user.email?.toLowerCase() ?? null;
      if (!email) { router.replace('/login'); return; }

      // A) by email (change to your admin email)
      const okByEmail = email === 'me@chrismcarthur.co.uk';

      // B) by players.display_name === 'Kinish'
      let okByDisplay = false;
      if (!okByEmail) {
        const { data: player } = await supabase
          .from('players')
          .select('display_name')
          .eq('email', email)
          .maybeSingle();
        okByDisplay = player?.display_name === 'Kinish';
      }

      const ok = okByEmail || okByDisplay;
      setIsAdmin(ok);
      setCheckingAdmin(false);

      if (!ok) router.replace('/');
    })();
  }, [router]);

  // --- Loaders ---
  async function loadWeeks() {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    if (data) setWeeks((data as WeekOption[]).map(w => w.week_number));
    else setWeeks(Array.from({ length: 18 }, (_, i) => i + 1));
  }

  async function loadWeekGames(w: number) {
    setLoading(true);
    const fn = onlyPicked ? 'get_week_picked_games_with_details' : 'get_week_games_for_scoring';
    const { data, error } = await supabase.rpc(fn, { p_year: YEAR, p_week: w });
    if (!error && data) setRows(data as GameForScore[]);
    setLoading(false);
  }

  async function loadAdminEditors(w: number) {
    const [spr, ou] = await Promise.all([
      supabase.rpc('get_week_spread_picks_admin', { p_year: YEAR, p_week: w }),
      supabase.rpc('get_week_ou_picks_admin',     { p_year: YEAR, p_week: w }),
    ]);
    if (!spr.error && spr.data) {
      const list = spr.data as AdminSpreadRow[];
      setSpreadsAdmin(list);
      // initialize spread edits
      const se: Record<number, number> = {};
      for (const r of list) se[r.pick_id] = r.spread_at_pick;
      setSpreadEdits(se);
    }
    if (!ou.error && ou.data) {
      const list = ou.data as AdminOURow[];
      setOuAdmin(list);
      const side: Record<string, 'over'|'under'> = {};
      const tot: Record<string, number> = {};
      for (const r of list) {
        const k = ouKey(r);
        side[k] = r.pick_side;
        tot[k] = r.total_at_pick;
      }
      setOuSideEdits(side);
      setOuTotalEdits(tot);
    }
  }

  useEffect(() => { if (isAdmin) loadWeeks(); }, [isAdmin]);
  useEffect(() => { if (isAdmin) loadWeekGames(week); }, [week, onlyPicked, isAdmin]);
  useEffect(() => { if (isAdmin) loadAdminEditors(week); }, [week, isAdmin]);

  // --- Score editing ---
  function updateRow(id: number, field: 'home_score' | 'away_score', value: number | null) {
    setRows(prev => prev.map(r => (r.game_id === id ? { ...r, [field]: value } : r)));
  }

  async function saveScore(r: GameForScore) {
    const hs = r.home_score ?? 0;
    const as = r.away_score ?? 0;
    setSavingId(r.game_id);
    const { error } = await supabase.rpc('set_final_score', {
      p_year: YEAR,
      p_week_number: week,
      p_home_short: r.home,
      p_away_short: r.away,
      p_home_score: hs,
      p_away_score: as,
    });
    setSavingId(null);
    if (error) alert(error.message);
    else await loadWeekGames(week);
  }

  // --- Admin spread editor save ---
  async function saveSpread(r: AdminSpreadRow, nextTeam: string) {
    const nextSpread = spreadEdits[r.pick_id] ?? r.spread_at_pick;
    const { error } = await supabase.rpc('admin_replace_spread_pick_by_id', {
      p_pick_id: r.pick_id,                 // BIGINT/number
      p_home_short: r.home_short,
      p_away_short: r.away_short,
      p_team_short: nextTeam,
      p_spread: nextSpread,
    });
    if (error) alert(error.message);
    await Promise.all([loadWeekGames(week), loadAdminEditors(week)]);
  }

  // --- Admin O/U editor save (upsert) ---
  async function saveOU(r: AdminOURow) {
    const key = ouKey(r);
    const nextSide  = ouSideEdits[key]  ?? r.pick_side;
    const nextTotal = ouTotalEdits[key] ?? r.total_at_pick;
    const { error } = await supabase.rpc('admin_set_ou_pick', {
      p_year: YEAR,
      p_week: week,
      p_player_display: r.player,
      p_home_short: r.home_short,
      p_away_short: r.away_short,
      p_pick_side: nextSide,
      p_total: nextTotal,
    });
    if (error) alert(error.message);
    await Promise.all([loadWeekGames(week), loadAdminEditors(week)]);
  }

  // --- Early returns after hooks ---
  if (checkingAdmin) return <div className="max-w-5xl mx-auto p-6">Checking access…</div>;
  if (!isAdmin) return null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin · Final Scores & Edits</h1>
        <div className="flex gap-4 text-sm">
          <Link className="underline" href="/draft">Draft</Link>
          <Link className="underline" href="/">Scoreboard</Link>
        </div>
      </header>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm">Week</label>
          <select
            className="border rounded p-1 bg-transparent"
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10))}
          >
            {weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>

        <label className="text-sm flex items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={onlyPicked}
            onChange={(e) => setOnlyPicked(e.target.checked)}
          />
          Only games with Picks or O/U
        </label>
      </div>

      {/* Scores editor */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Enter Final Scores</h2>
        {loading ? (
          <div className="text-sm text-gray-400">Loading games…</div>
        ) : (
          <>
            {rows.map((r) => (
              <div key={r.game_id} className="p-2 border rounded">
                <div className="grid grid-cols-6 gap-2 items-center">
                  <div className="col-span-2 text-sm">{r.home} vs {r.away}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Home</span>
                    <input
                      type="number"
                      className="w-16 border rounded p-1 bg-transparent"
                      value={r.home_score ?? ''}
                      onChange={(e) => updateRow(r.game_id, 'home_score', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Away</span>
                    <input
                      type="number"
                      className="w-16 border rounded p-1 bg-transparent"
                      value={r.away_score ?? ''}
                      onChange={(e) => updateRow(r.game_id, 'away_score', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                    />
                  </div>
                  <div className="text-right">
                    <button
                      onClick={() => saveScore(r)}
                      disabled={savingId === r.game_id}
                      className="px-3 py-1 border rounded disabled:opacity-50"
                    >
                      {savingId === r.game_id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>

                {(r.home_spread_pickers?.length || r.away_spread_pickers?.length ||
                  r.ou_over_pickers?.length || r.ou_under_pickers?.length) ? (
                  <div className="mt-1 text-xs text-gray-400">
                    {r.home_spread_pickers?.length ? <>ATS {r.home}: {r.home_spread_pickers.join(', ')}</> : null}
                    {r.away_spread_pickers?.length ? <> {r.home_spread_pickers?.length ? ' • ' : ''}ATS {r.away}: {r.away_spread_pickers.join(', ')}</> : null}
                    {r.ou_over_pickers?.length ? <> {(r.home_spread_pickers?.length || r.away_spread_pickers?.length) ? ' • ' : ''}O/U OVER: {r.ou_over_pickers.join(', ')}</> : null}
                    {r.ou_under_pickers?.length ? <> { (r.ou_over_pickers?.length || r.home_spread_pickers?.length || r.away_spread_pickers?.length) ? ' • ' : ''}O/U UNDER: {r.ou_under_pickers.join(', ')}</> : null}
                  </div>
                ) : null}
              </div>
            ))}
            {rows.length === 0 && (
              <div className="text-sm text-gray-400">
                {onlyPicked ? 'No picked games for this week yet.' : 'No games found for this week.'}
              </div>
            )}
          </>
        )}
      </section>

      {/* Admin: Edit Spread Picks */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Edit Spread Picks</h2>
        {spreadsAdmin.map((r) => {
          const isHome = r.team_short === r.home_short;
          const nextTeam = isHome ? r.away_short : r.home_short;
          const value = spreadEdits[r.pick_id] ?? r.spread_at_pick;

          return (
            <div key={r.pick_id} className="grid grid-cols-7 gap-2 items-center p-2 border rounded text-sm">
              <div>#{r.pick_number}</div>
              <div className="font-medium">{r.player}</div>
              <div className="col-span-2">{r.home_short} v {r.away_short}</div>
              <div>Team: <b>{r.team_short}</b></div>
              <div className="flex items-center gap-2">
                <label>Spread</label>
                <input
                  type="number"
                  className="w-20 border rounded p-1 bg-transparent"
                  value={value}
                  onChange={(e) =>
                    setSpreadEdits((prev) => ({
                      ...prev,
                      [r.pick_id]: parseFloat(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="text-right">
                <button
                  className="px-3 py-1 border rounded"
                  title="Flip to the other side of this game (and/or update spread)"
                  onClick={() => saveSpread(r, nextTeam)}
                >
                  Save (flip to {nextTeam})
                </button>
              </div>
            </div>
          );
        })}
        {spreadsAdmin.length === 0 && <div className="text-sm text-gray-400">No spread picks this week.</div>}
      </section>

      {/* Admin: Edit O/U Picks */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Edit O/U Picks</h2>
        {ouAdmin.map((r, idx) => {
          const key = ouKey(r);
          const side  = ouSideEdits[key]  ?? r.pick_side;
          const total = ouTotalEdits[key] ?? r.total_at_pick;

          return (
            <div key={`${r.player}-${idx}`} className="grid grid-cols-6 gap-2 items-center p-2 border rounded text-sm">
              <div className="font-medium">{r.player}</div>
              <div className="col-span-2">{r.home_short} v {r.away_short}</div>
              <div>
                <select
                  className="border rounded p-1 bg-transparent"
                  value={side}
                  onChange={(e)=> setOuSideEdits(prev => ({ ...prev, [key]: e.target.value as 'over'|'under' }))}
                >
                  <option value="over">OVER</option>
                  <option value="under">UNDER</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label>Total</label>
                <input
                  type="number"
                  className="w-24 border rounded p-1 bg-transparent"
                  value={total}
                  onChange={(e)=> setOuTotalEdits(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                />
              </div>
              <div className="text-right">
                <button className="px-3 py-1 border rounded" onClick={() => saveOU(r)}>Save</button>
              </div>
            </div>
          );
        })}
        {ouAdmin.length === 0 && <div className="text-sm text-gray-400">No O/U picks this week.</div>}
      </section>
    </div>
  );
}
