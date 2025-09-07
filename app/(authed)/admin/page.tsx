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

const YEAR = 2025;

export default function AdminScoresPage() {
  const router = useRouter();

  // --- Admin guard state (must be before any returns) ---
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // --- Page state (also before any early returns) ---
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [rows, setRows] = useState<GameForScore[]>([]);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [onlyPicked, setOnlyPicked] = useState<boolean>(true);

  // --- Admin guard effect ---
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user.email?.toLowerCase() ?? null;
      if (!email) { router.replace('/login'); return; }

      // OPTION A: lock by email (change to your admin email)
      const okByEmail = email === 'me@chrismcarthur.co.uk';

      // OPTION B: lock by players.display_name === 'Kinish'
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

  // --- Data loaders ---
  async function loadWeeks() {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    if (data) setWeeks((data as WeekOption[]).map(w => w.week_number));
    else setWeeks(Array.from({ length: 18 }, (_, i) => i + 1));
  }

  async function loadWeekGames(w: number) {
    setLoading(true);
    const fn = onlyPicked
      ? 'get_week_picked_games_with_details'
      : 'get_week_games_for_scoring';
    const { data, error } = await supabase.rpc(fn, { p_year: YEAR, p_week: w });
    if (!error && data) setRows(data as GameForScore[]);
    setLoading(false);
  }

  useEffect(() => { if (isAdmin) loadWeeks(); }, [isAdmin]);
  useEffect(() => { if (isAdmin) loadWeekGames(week); }, [week, onlyPicked, isAdmin]);

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

  // --- Early returns AFTER all hooks ---
  if (checkingAdmin) return <div className="max-w-5xl mx-auto p-6">Checking access…</div>;
  if (!isAdmin) return null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin · Final Scores</h1>
        {/* If you want to go back to Draft explicitly, link to /draft */}
        <Link className="underline" href="/draft">← Back to Draft</Link>
      </header>

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

      {loading ? (
        <div className="text-sm text-gray-400">Loading games…</div>
      ) : (
        <div className="space-y-2">
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
                    onChange={(e) =>
                      updateRow(r.game_id, 'home_score', e.target.value === '' ? null : parseInt(e.target.value, 10))
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Away</span>
                  <input
                    type="number"
                    className="w-16 border rounded p-1 bg-transparent"
                    value={r.away_score ?? ''}
                    onChange={(e) =>
                      updateRow(r.game_id, 'away_score', e.target.value === '' ? null : parseInt(e.target.value, 10))
                    }
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
        </div>
      )}

      <p className="text-xs text-gray-400">
        Scores update spreads/OUs on the main page automatically.
      </p>
    </div>
  );
}
