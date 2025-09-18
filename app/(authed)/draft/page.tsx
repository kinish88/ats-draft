'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Draft = { week_id: number; current_pick_number: number };
type DraftOrder = { id: number; week_id: number; pick_number: number; player_id: string };
type OuPick = {
  id: number; week_id: number; player_id: string; game_id: number;
  pick_side: 'over' | 'under'; total_at_pick: number; created_at: string;
};
type GameCard = { game_id: number; label: string; total: number };

export default function DraftPage() {
  const router = useRouter();
  const params = useSearchParams();

  // ---------- Week selection (URL is source of truth, localStorage fallback)
  const [weekId, setWeekId] = useState<number | null>(null);
  useEffect(() => {
    const urlWeek = params.get('week');
    const saved = typeof window !== 'undefined' ? localStorage.getItem('ats.week') : null;
    if (urlWeek) {
      setWeekId(Number(urlWeek));
    } else if (saved) {
      setWeekId(Number(saved));
      router.replace(`?week=${saved}`, { scroll: false });
    } else {
      setWeekId(3);
      router.replace(`?week=3`, { scroll: false });
    }
  }, [params, router]);

  const onWeekChange = useCallback((w: number) => {
    setWeekId(w);
    if (typeof window !== 'undefined') localStorage.setItem('ats.week', String(w));
    router.replace(`?week=${w}`, { scroll: false });
  }, [router]);

  // ---------- Auth (player_id must match draft_order.player_id)
  const [playerId, setPlayerId] = useState<string | null>(null);
  useEffect(() => { (async () => {
    const { data } = await supabase.auth.getUser();
    setPlayerId(data.user?.id ?? null);
  })(); }, []);

  // ---------- Data state
  const [draft, setDraft] = useState<Draft | null>(null);
  const [order, setOrder] = useState<DraftOrder[]>([]);
  const [ouPicks, setOuPicks] = useState<OuPick[]>([]);
  const [games, setGames] = useState<GameCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---------- Fetchers
  const refetchDraft = useCallback(async () => {
    if (!weekId) return;
    const { data, error } = await supabase
      .from('drafts')
      .select('week_id, current_pick_number')
      .eq('week_id', weekId)
      .maybeSingle();
    if (!error) setDraft(data as Draft);
  }, [weekId]);

  const refetchOrder = useCallback(async () => {
    if (!weekId) return;
    const { data, error } = await supabase
      .from('draft_order')
      .select('id, week_id, pick_number, player_id')
      .eq('week_id', weekId)
      .order('pick_number', { ascending: true });
    if (!error) setOrder((data ?? []) as DraftOrder[]);
  }, [weekId]);

  const refetchOuPicks = useCallback(async () => {
    if (!weekId) return;
    const { data, error } = await supabase
      .from('ou_picks')
      .select('id, week_id, player_id, game_id, pick_side, total_at_pick, created_at')
      .eq('week_id', weekId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (!error) setOuPicks((data ?? []) as OuPick[]);
  }, [weekId]);

  const refetchGames = useCallback(async () => {
    if (!weekId) return;
    const { data, error } = await supabase
      .from('v_ou_candidates')
      .select('game_id, label, total')
      .eq('week_id', weekId)
      .order('game_id', { ascending: true });
    if (!error) setGames((data ?? []) as GameCard[]);
  }, [weekId]);

  // ---------- Initial fetch + realtime
  useEffect(() => {
    if (!weekId) return;
    setLoading(true);
    Promise.all([refetchDraft(), refetchOrder(), refetchOuPicks(), refetchGames()])
      .finally(() => setLoading(false));
  }, [weekId, refetchDraft, refetchOrder, refetchOuPicks, refetchGames]);

  useEffect(() => {
    if (!weekId) return;
    const ch = supabase.channel(`draft:${weekId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drafts',   filter: `week_id=eq.${weekId}` }, refetchDraft)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ou_picks', filter: `week_id=eq.${weekId}` }, () => {
        refetchOuPicks();
        refetchDraft(); // pick number will advance
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [weekId, refetchDraft, refetchOuPicks]);

  // ---------- Derived
  const onTheClock = useMemo(() => {
    if (!draft || !order.length) return null;
    return order.find(o => o.pick_number === draft.current_pick_number)?.player_id ?? null;
  }, [draft, order]);

  // ---------- Make O/U pick via RPC
  const makeOuPick = useCallback(async (gameId: number, side: 'over' | 'under', total: number) => {
    if (!weekId || !playerId) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('make_ou_pick', {
        p_week: weekId,
        p_player: playerId,
        p_game_id: gameId,
        p_side: side,   // lowercase expected by constraint
        p_total: total,
      });
      if (error) throw error;
      // realtime will refresh UI
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Failed to make O/U pick.');
    } finally {
      setSubmitting(false);
    }
  }, [playerId, weekId]);

  // ---------- UI
  if (weekId == null) return <div className="p-6">Loading week…</div>;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Draft</h1>
        <select
          className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
          value={weekId}
          onChange={e => onWeekChange(Number(e.target.value))}
        >
          {Array.from({ length: 18 }, (_, i) => i + 1).map(w => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
        {loading && <span className="text-sm text-neutral-400">Refreshing…</span>}
      </header>

      {/* On-the-clock banner */}
      <div className="text-sm">
        <span className="text-neutral-400 mr-2">On the clock:</span>
        <code className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700">
          {onTheClock ?? '—'}
        </code>
        {playerId && (
          <span className="ml-3 text-neutral-400">
            You are <code className="px-1 bg-neutral-900 border border-neutral-700 rounded">{playerId}</code>
            {onTheClock === playerId ? ' — your turn' : ' — wait'}
          </span>
        )}
      </div>

      {/* O/U Picks so far */}
      <section className="space-y-2">
        <h2 className="font-medium">O/U Picks</h2>
        <div className="space-y-1 text-sm">
          {ouPicks.length === 0 && <div className="text-neutral-400">No O/U picks yet.</div>}
          {ouPicks.map(p => (
            <div key={p.id} className="flex items-center justify-between rounded border border-neutral-700 bg-neutral-900 px-3 py-2">
              <div className="truncate">
                <span className="text-neutral-400 mr-2">{p.player_id}</span>
                <span className="mr-2">game #{p.game_id}</span>
                <b className="uppercase">{p.pick_side}</b>
                <span className="ml-1">{p.total_at_pick}</span>
              </div>
              <span className="text-neutral-500 text-xs">{new Date(p.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Game cards */}
      <section className="space-y-2">
        <h2 className="font-medium">Make your O/U pick</h2>
        {errorMsg && (
          <div className="text-sm text-red-400 border border-red-700 bg-red-950/30 rounded px-3 py-2">
            {errorMsg}
          </div>
        )}
        {games.length === 0 && (
          <div className="text-neutral-400 text-sm">
            No games found for Week {weekId} in <code>v_ou_candidates</code>.
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          {games.map(g => {
            const disabled = submitting || onTheClock !== playerId;
            return (
              <div key={g.game_id} className="rounded border border-neutral-700 bg-neutral-900 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{g.label}</div>
                  <div className="text-sm text-neutral-400">/{g.total}</div>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={disabled}
                    onClick={() => makeOuPick(g.game_id, 'over', g.total)}
                    className={`px-3 py-1 rounded border ${
                      disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-neutral-500'
                    } border-neutral-700`}
                  >
                    OVER {g.total}
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() => makeOuPick(g.game_id, 'under', g.total)}
                    className={`px-3 py-1 rounded border ${
                      disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-neutral-500'
                    } border-neutral-700`}
                  >
                    UNDER {g.total}
                  </button>
                </div>
                {onTheClock !== playerId && (
                  <div className="text-xs text-neutral-500 mt-2">Waiting for current player…</div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
