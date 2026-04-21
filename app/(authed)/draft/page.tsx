'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAppState } from '@/lib/useAppState';
import { whoIsOnClock, totalAtsPicks, BASE_ORDER, type Player, type Starter } from '@/lib/draftOrder';
import toast, { Toaster } from 'react-hot-toast';
import CountdownBanner from '@/src/components/CountdownBanner';

function coerceStarter(s: string | null): Starter {
  return (BASE_ORDER as readonly string[]).includes(s ?? '') ? (s as Starter) : BASE_ORDER[0];
}

const DEFAULT_PLAYER = (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null;
const LOGO_BASE = (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null;

const norm = (s: string) => s.trim().toLowerCase();
function toStr(x: unknown, fb = ''): string { return typeof x === 'string' ? x : x == null ? fb : String(x); }
function toNumOrNull(x: unknown): number | null { if (x == null) return null; const n = typeof x === 'number' ? x : Number(x); return Number.isFinite(n) ? n : null; }
function asRec(x: unknown): Record<string, unknown> { return (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}) as Record<string, unknown>; }
function teamLogo(short?: string | null): string { const s = (short || '').toUpperCase(); if (!s) return ''; return LOGO_BASE ? `${LOGO_BASE}/${s}.png` : `/teams/${s}.png`; }
function fmtSigned(n: number | null | undefined): string { if (n == null || n === 0) return 'Pick Em'; return n > 0 ? `+${n}` : `${n}`; }
const matchupKey = (home?: string | null, away?: string | null) => home && away ? `${home.toUpperCase()}-${away.toUpperCase()}` : null;

type DraftStatusState = 'ON_THE_CLOCK' | 'WAITING' | 'PAUSED';
function DraftStatusPill({ state, text }: { state: DraftStatusState; text: string }) {
  const base = 'flex-1 rounded-2xl border px-4 py-3 text-sm font-medium shadow-inner shadow-black/30';
  const variant = state === 'ON_THE_CLOCK' ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-100' : state === 'PAUSED' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-white/15 bg-white/5 text-white/80';
  return <div className={`${base} ${variant}`}>{text}</div>;
}

type BoardRow = { game_id: number; home_short: string; away_short: string; home_line: number; away_line: number; total: number | null; };
type PickViewRow = { pick_id: number; created_at: string | null; pick_number: number; season_year: number; week_number: number; player: string; home_short: string; away_short: string; picked_team_short: string | null; line_at_pick: number | null; total_at_pick: number | null; ou_side?: 'OVER' | 'UNDER' | null; game_id_hint?: number | null; };
type SpreadPickLockRow = { id: string; player: string; teamShort: string; spreadValue: string; isMine: boolean; };

export default function DraftPage() {
  const { season_year: YEAR, loading: appStateLoading } = useAppState();
  const [weekId, setWeekId] = useState<number | null>(null);
  const [weekNumber, setWeekNumber] = useState<number | null>(null);
  const [starter, setStarter] = useState<string | null>(null);
  const [livePickNumber, setLivePickNumber] = useState<number | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [picks, setPicks] = useState<PickViewRow[]>([]);
  const [myName, setMyName] = useState<string | null>(null);
  const [expandedMobileGame, setExpandedMobileGame] = useState<number | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [noOpenWeek, setNoOpenWeek] = useState(false);

  useEffect(() => {
    if (appStateLoading) return;
    (async () => {
      setWeekError(null); setNoOpenWeek(false);
      const { data, error } = await supabase.from('current_open_week').select('week_id').limit(2);
      if (error) { setWeekError('Unable to load open draft week.'); return; }
      if (!data || data.length === 0) { setNoOpenWeek(true); return; }
      if (data.length > 1) { setWeekError('Multiple open draft weeks found.'); return; }
      const row = data[0];
      if (!row?.week_id) { setWeekError('Invalid open draft week response.'); return; }
      const wid = Number(row.week_id);
      setWeekId(wid);
      const { data: weekRow } = await supabase.from('weeks').select('week_number, starter_player').eq('id', wid).maybeSingle();
      setStarter(weekRow?.starter_player ?? null);
      setWeekNumber(weekRow?.week_number ?? null);
    })();
  }, [appStateLoading, YEAR]);

  useEffect(() => {
    if (!weekId) return;
    (async () => {
      const { data } = await supabase.from('drafts').select('current_pick_number').eq('week_id', weekId).maybeSingle();
      setLivePickNumber(data?.current_pick_number ?? 0);
    })();
  }, [weekId]);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id || null;
      if (!uid) { setMyName(DEFAULT_PLAYER); return; }
      const { data } = await supabase.from('profiles').select('display_name').eq('id', uid).maybeSingle();
      setMyName(toStr(data?.display_name || DEFAULT_PLAYER || ''));
    })();
  }, []);

  async function loadBoard(wn: number) {
    const { data } = await supabase.rpc('get_week_draft_board', { p_year: YEAR, p_week: wn });
    const rows: unknown[] = Array.isArray(data) ? data : [];
    setBoard(rows.map((r) => { const o = asRec(r); return { game_id: Number(o.game_id ?? 0), home_short: toStr(o.home_short), away_short: toStr(o.away_short), home_line: Number(toNumOrNull(o.home_line) ?? 0), away_line: Number(toNumOrNull(o.away_line) ?? 0), total: toNumOrNull(o.total) }; }));
  }

  const lastCountRef = useRef(0);
  async function loadPicksMerged(wn: number, allowToast = false) {
    const { data } = await supabase.rpc('get_week_picks', { p_year: YEAR, p_week: wn });
    const spreadMapped: PickViewRow[] = (Array.isArray(data) ? data : []).map((r) => { const o = asRec(r); return { pick_id: Number(o.pick_id ?? 0), created_at: toStr(o.created_at, null as unknown as string), pick_number: Number(toNumOrNull(o.pick_number) ?? 0), season_year: YEAR, week_number: wn, player: toStr(o.player), home_short: toStr(o.home_short), away_short: toStr(o.away_short), picked_team_short: toStr(o.picked_team_short, '') || null, line_at_pick: toNumOrNull(o.line_at_pick), total_at_pick: toNumOrNull(o.total_at_pick), ou_side: null, game_id_hint: Number(toNumOrNull(o.game_id)) || null }; });
    const { data: ouRaw } = await supabase.rpc('get_week_ou_picks_admin', { p_year: YEAR, p_week: wn });
    const ouMapped: PickViewRow[] = (Array.isArray(ouRaw) ? ouRaw : []).map((r, idx) => { const o = asRec(r); return { pick_id: 10_000 + idx, created_at: null, pick_number: 100 + idx, season_year: YEAR, week_number: wn, player: toStr(o.player), home_short: toStr(o.home_short), away_short: toStr(o.away_short), picked_team_short: null, line_at_pick: null, total_at_pick: toNumOrNull(o.total_at_pick), ou_side: (toStr(o.pick_side).toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER') as 'OVER' | 'UNDER', game_id_hint: null }; });
    const merged = [...spreadMapped, ...ouMapped].sort((a, b) => a.pick_number === b.pick_number ? (a.created_at ?? '').localeCompare(b.created_at ?? '') : a.pick_number - b.pick_number);
    if (allowToast && merged.length > lastCountRef.current) {
      const latest = merged[merged.length - 1];
      if (latest?.picked_team_short) { const line = latest.line_at_pick ?? 0; const tone = line === 0 ? 'neutral' : line > 0 ? 'positive' : 'negative'; toast.custom((t) => (<div className={`toast-pop ${tone} ${t.visible ? 'in' : 'out'}`}><img src={teamLogo(latest.picked_team_short)} alt="" className="w-5 h-5 rounded-sm" /><span>{latest.player} picked {latest.picked_team_short} ({fmtSigned(line)})</span></div>), { duration: 4000 }); }
      else if (latest?.total_at_pick != null && latest.ou_side) { toast.custom((t) => <div className={`toast-pop neutral ${t.visible ? 'in' : 'out'}`}>{latest.player} picked {latest.ou_side} {latest.total_at_pick} — {latest.home_short} v {latest.away_short}</div>, { duration: 4000 }); }
    }
    lastCountRef.current = merged.length;
    setPicks(merged);
  }

  useEffect(() => { if (!weekId || !weekNumber) return; loadBoard(weekNumber); loadPicksMerged(weekNumber); }, [weekId, weekNumber]);

  useEffect(() => {
    if (!weekId || !weekNumber) return;
    const ch = supabase.channel('draft-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'picks' }, () => loadPicksMerged(weekNumber, true))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ou_picks' }, () => loadPicksMerged(weekNumber, true))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ou_picks' }, () => loadPicksMerged(weekNumber, true))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_lines' }, () => loadBoard(weekNumber))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `week_id=eq.${weekId}` }, (payload) => { const n = payload.new as Record<string, unknown>; const pick = toNumOrNull(n.current_pick_number); if (pick != null) setLivePickNumber(pick); })
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [weekId, weekNumber]);

  const playersR1Names: string[] = useMemo(() => { const s: Starter = coerceStarter(starter); const idx = BASE_ORDER.indexOf(s); return [...BASE_ORDER.slice(idx), ...BASE_ORDER.slice(0, idx)]; }, [starter]);
  const playersR1: Player[] = useMemo(() => playersR1Names.map((n) => ({ id: n, display_name: n })), [playersR1Names]);
  const spreadPicksCount = useMemo(() => picks.filter((p) => p.picked_team_short != null).length, [picks]);
  const atsTotal = totalAtsPicks(playersR1.length);
  const ouPhase = spreadPicksCount >= atsTotal;
  const ouPicksCount = useMemo(() => picks.filter((p) => p.total_at_pick != null).length, [picks]);
  const effectivePickNumber = livePickNumber ?? spreadPicksCount;
  const { player: onClockPlayerSpread } = whoIsOnClock({ current_pick_number: Math.min(effectivePickNumber, atsTotal - 1), players: playersR1 });
  const onClockSpread = onClockPlayerSpread.display_name;
  const ouOrder = useMemo(() => [playersR1Names[2], playersR1Names[1], playersR1Names[0]], [playersR1Names]);
  const onClockOu = ouPhase && ouPicksCount < ouOrder.length ? ouOrder[ouPicksCount] : '';
  const draftComplete = ouPhase && ouPicksCount >= ouOrder.length;
  const onClock = draftComplete ? '' : ouPhase ? onClockOu : onClockSpread;
  const isMyTurn = !draftComplete && myName != null && norm(onClock) === norm(myName);
  const pickedTeams = useMemo(() => { const s = new Set<string>(); for (const p of picks) { if (p.picked_team_short) s.add(p.picked_team_short.toUpperCase()); } return s; }, [picks]);
  const myOuAlreadyPicked = useMemo(() => { if (!myName) return false; const me = norm(myName); return picks.some((p) => p.total_at_pick != null && norm(p.player) === me); }, [picks, myName]);
  const myPicksByGame = useMemo(() => { const map = new Map<string, { label: string; kind: 'SPREAD' | 'OU' }>(); if (!myName) return map; const me = norm(myName); for (const p of picks) { if (norm(p.player) !== me) continue; const key = matchupKey(p.home_short, p.away_short); if (!key) continue; if (p.picked_team_short) map.set(key, { label: `${p.picked_team_short} ${p.line_at_pick != null ? fmtSigned(p.line_at_pick) : ''}`.trim(), kind: 'SPREAD' }); else if (p.total_at_pick != null && p.ou_side) map.set(key, { label: `${p.ou_side} ${p.total_at_pick}`, kind: 'OU' }); } return map; }, [picks, myName]);
  const spreadLocksByGame = useMemo(() => { const map = new Map<string, SpreadPickLockRow[]>(); const me = myName ? norm(myName) : null; for (const p of picks) { if (!p.picked_team_short) continue; const key = matchupKey(p.home_short, p.away_short); if (!key) continue; const lockRow: SpreadPickLockRow = { id: `${p.pick_id}-${p.pick_number}`, player: p.player, teamShort: p.picked_team_short, spreadValue: fmtSigned(p.line_at_pick), isMine: me != null && norm(p.player) === me }; const arr = map.get(key); if (arr) arr.push(lockRow); else map.set(key, [lockRow]); } return map; }, [picks, myName]);
  const lastPick = picks.length ? picks[picks.length - 1] : null;
  const lastPickLabel = lastPick ? lastPick.picked_team_short ? `${lastPick.player} — ${lastPick.picked_team_short} ${lastPick.line_at_pick != null ? fmtSigned(lastPick.line_at_pick) : ''} (${lastPick.away_short} @ ${lastPick.home_short})` : `${lastPick.player} — ${lastPick.ou_side ?? ''} ${lastPick.total_at_pick ?? '—'} (${lastPick.away_short} @ ${lastPick.home_short})` : null;

  async function makeSpreadPick(row: BoardRow, team_short: string) {
    if (!isMyTurn || ouPhase || !weekId || !weekNumber) return;
    const teamLine = team_short === row.home_short ? row.home_line : row.away_line;
    const nextPickNumber = spreadPicksCount + 1;
    const { error } = await supabase.from('picks').insert([{ season_year: YEAR, pick_number: nextPickNumber, player_display_name: myName, team_short, home_short: row.home_short, away_short: row.away_short, spread_at_pick: teamLine, game_id: row.game_id }]);
    if (error) { alert(`Could not place pick: ${error.message}`); return; }
    await supabase.from('drafts').upsert({ week_id: weekId, current_pick_number: nextPickNumber, updated_at: new Date().toISOString() });
    loadPicksMerged(weekNumber, true);
  }

  async function makeOuPick(row: BoardRow, side: 'OVER' | 'UNDER') {
    if (!isMyTurn || !ouPhase || myOuAlreadyPicked || row.total == null || !myName || !weekNumber) return;
    const { error } = await supabase.rpc('make_ou_pick_by_shorts', { p_year: YEAR, p_week: weekNumber, p_player: myName, p_home: row.home_short, p_away: row.away_short, p_side: side });
    if (error) { alert(String(error.message || '').toLowerCase().includes('uq') || String(error.message || '').toLowerCase().includes('unique') ? 'That game or player already has an O/U pick' : `Could not place O/U pick: ${error.message}`); return; }
    if (weekId) await supabase.from('drafts').upsert({ week_id: weekId, current_pick_number: atsTotal + ouPicksCount + 1, updated_at: new Date().toISOString() });
    loadPicksMerged(weekNumber, true);
  }

  if (appStateLoading || (!weekId && !weekError && !noOpenWeek)) return (<div className="max-w-4xl mx-auto p-6"><Toaster position="bottom-center" /><div className="opacity-70">Loading current draft week…</div></div>);
  if (weekError) return (<div className="max-w-4xl mx-auto p-6"><Toaster position="bottom-center" /><div className="text-rose-400">{weekError}</div></div>);
  if (noOpenWeek) return (<div className="max-w-4xl mx-auto p-6"><Toaster position="bottom-center" /><div className="opacity-70">No draft open this week. Check back soon!</div></div>);

  const statusText = draftComplete ? '🏁 Draft complete' : isMyTurn ? `🟢 On the clock: ${onClock || myName || '—'}` : myName ? `⏸ You are ${myName} — waiting for ${onClock || '…'}` : '⏳ Identifying player…';
  const statusState: DraftStatusState = draftComplete ? 'PAUSED' : isMyTurn ? 'ON_THE_CLOCK' : 'WAITING';

  return (
    <div className="relative max-w-6xl mx-auto p-6 space-y-6 pb-28 md:pb-6">
      <Toaster position="bottom-center" />
      <div className="space-y-3">
        <CountdownBanner className="w-full" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <DraftStatusPill state={statusState} text={statusText} />
          {lastPickLabel && (<div className="flex-1 rounded-2xl border border-purple-400/30 bg-purple-500/10 px-4 py-3 text-sm font-medium text-purple-100 shadow-inner shadow-black/30 sm:self-start">🟣 Last pick: {lastPickLabel}</div>)}
        </div>
      </div>
      {draftComplete && (<div className="flex items-center justify-center gap-3 py-2 rounded bg-zinc-900/50 border border-zinc-800"><span className="text-emerald-400 font-semibold tracking-wide">🏈 PICKS ARE IN 🏈</span></div>)}

      {/* MOBILE */}
      <section className="md:hidden space-y-3">
        {board.map((g) => {
          const key = matchupKey(g.home_short, g.away_short);
          const spreadLocks = key ? spreadLocksByGame.get(key) ?? [] : [];
          const myPickInfo = key ? myPicksByGame.get(key) : null;
          const hasMySpreadPick = spreadLocks.some((row) => row.isMine);
          const hasMyOuPickHere = myPickInfo?.kind === 'OU';
          const hasMyLock = hasMySpreadPick || hasMyOuPickHere;
          const hasOtherLock = !hasMyLock && spreadLocks.length > 0;
          const isExpanded = expandedMobileGame === g.game_id;
          const homeTaken = pickedTeams.has(g.home_short.toUpperCase());
          const awayTaken = pickedTeams.has(g.away_short.toUpperCase());
          return (
            <div key={g.game_id} className={`rounded-2xl border px-4 py-3 shadow-sm transition ${hasMyLock ? 'border-emerald-400/60 bg-emerald-500/5 shadow-emerald-500/20' : hasOtherLock ? 'border-amber-400/60 bg-amber-500/5 shadow-amber-500/20' : 'border-white/10 bg-white/5'}`}>
              <button type="button" onClick={() => setExpandedMobileGame(isExpanded ? null : g.game_id)} className="flex w-full items-center justify-between text-left">
                <div>
                  <div className="text-sm font-semibold text-white">{g.home_short} @ {g.away_short}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">Spread: {g.home_short} {fmtSigned(g.home_line)} / {g.away_short} {fmtSigned(g.away_line)}</div>
                  <div className="text-xs text-zinc-400">Total: O/U {g.total ?? '—'}</div>
                </div>
                <span className={`text-lg transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {(spreadLocks.length > 0 || hasMyOuPickHere) && (
                <div className="mt-2 flex flex-col gap-1">
                  {spreadLocks.map((row) => (<div key={row.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${row.isMine ? isMyTurn ? 'text-emerald-200 border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_16px_rgba(16,185,129,0.4)]' : 'text-emerald-200 border-emerald-400/30' : 'text-amber-100 border-amber-400/50 bg-amber-500/10'}`}>🔒 {row.isMine ? 'Your pick' : row.player} · {row.teamShort} {row.spreadValue}</div>))}
                  {hasMyOuPickHere && (<div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-emerald-200 ${isMyTurn ? 'border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_16px_rgba(16,185,129,0.4)]' : 'border-emerald-400/30'}`}>🔒 Your pick {myPickInfo?.label ? `· ${myPickInfo.label}` : ''}</div>)}
                </div>
              )}
              {isExpanded && (
                <div className="mt-3 space-y-3 text-sm">
                  {!ouPhase && (<div className="flex flex-col gap-2"><button className="rounded-2xl border border-white/15 px-3 py-2 text-left transition hover:border-white/40 disabled:opacity-40" disabled={!isMyTurn || homeTaken || hasMyLock} onClick={() => makeSpreadPick(g, g.home_short)}>Pick {g.home_short} ({fmtSigned(g.home_line)})</button><button className="rounded-2xl border border-white/15 px-3 py-2 text-left transition hover:border-white/40 disabled:opacity-40" disabled={!isMyTurn || awayTaken || hasMyLock} onClick={() => makeSpreadPick(g, g.away_short)}>Pick {g.away_short} ({fmtSigned(g.away_line)})</button></div>)}
                  {ouPhase && (<div className="flex flex-col gap-2"><button className="rounded-2xl border border-white/15 px-3 py-2 text-left transition hover:border-white/40 disabled:opacity-40" disabled={!isMyTurn || g.total == null || myOuAlreadyPicked || hasMyLock} onClick={() => makeOuPick(g, 'OVER')}>OVER {g.total ?? '—'}</button><button className="rounded-2xl border border-white/15 px-3 py-2 text-left transition hover:border-white/40 disabled:opacity-40" disabled={!isMyTurn || g.total == null || myOuAlreadyPicked || hasMyLock} onClick={() => makeOuPick(g, 'UNDER')}>UNDER {g.total ?? '—'}</button></div>)}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* DESKTOP TABLE */}
      <section className="hidden md:block border rounded overflow-hidden max-w-4xl mx-auto w-full">
        <div className="px-3 py-2 text-xs bg-zinc-900/60 border-b border-zinc-800 uppercase tracking-wide">Game Lines</div>
        <table className="w-full text-sm table-fixed">
          <thead className="bg-zinc-900/30 text-zinc-400"><tr><th className="w-3/4 text-left px-3 py-2">Game</th><th className="w-1/4 text-right px-3 py-2">Total</th></tr></thead>
          <tbody className="divide-y divide-zinc-800/60">
            {board.map((g) => (<tr key={g.game_id} className="hover:bg-zinc-900/40"><td className="px-3 py-2"><div className="flex items-center gap-3"><img src={teamLogo(g.home_short) || ''} alt={g.home_short} className="w-5 h-5 rounded-sm" /><span className="font-semibold">{g.home_short}</span><span className="text-xs text-zinc-400 ml-1">{fmtSigned(g.home_line)}</span><span className="text-zinc-500 mx-2">v</span><img src={teamLogo(g.away_short) || ''} alt={g.away_short} className="w-5 h-5 rounded-sm" /><span className="font-semibold">{g.away_short}</span><span className="text-xs text-zinc-400 ml-1">{fmtSigned(g.away_line)}</span></div></td><td className="px-3 py-2 text-right text-xs text-zinc-400">O/U <span className="text-zinc-200">{g.total ?? '—'}</span></td></tr>))}
          </tbody>
        </table>
      </section>

      {/* DESKTOP PICKS */}
      <section className="hidden md:block max-w-4xl mx-auto w-full">
        <div className="px-3 py-2 text-xs bg-zinc-900/60 border border-zinc-800 rounded-t uppercase tracking-wide">Make Picks</div>
        <div className="grid md:grid-cols-2 gap-3 border border-t-0 border-zinc-800 rounded-b p-3">
          {board.map((g) => {
            const homeTaken = pickedTeams.has(g.home_short.toUpperCase());
            const awayTaken = pickedTeams.has(g.away_short.toUpperCase());
            const key = matchupKey(g.home_short, g.away_short);
            const spreadLocks = key ? spreadLocksByGame.get(key) ?? [] : [];
            const myPickInfo = key ? myPicksByGame.get(key) : null;
            const hasMySpreadPick = spreadLocks.some((row) => row.isMine);
            const hasMyOuPickHere = myPickInfo?.kind === 'OU';
            const hasMyLock = hasMySpreadPick || hasMyOuPickHere;
            const hasOtherLock = !hasMyLock && spreadLocks.length > 0;
            return (
              <div key={g.game_id} className={`border rounded p-3 bg-zinc-950/50 ${hasMyLock ? 'border-emerald-400/60 shadow-inner shadow-emerald-500/30' : hasOtherLock ? 'border-amber-400/50 shadow-inner shadow-amber-500/30' : ''}`}>
                <div className="text-sm text-zinc-300 mb-2">{g.home_short} vs {g.away_short}</div>
                {(spreadLocks.length > 0 || hasMyOuPickHere) && (<div className="mb-2 flex flex-col gap-1">{spreadLocks.map((row) => (<div key={row.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${row.isMine ? isMyTurn ? 'text-emerald-200 border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_16px_rgba(16,185,129,0.4)]' : 'text-emerald-200 border-emerald-400/30' : 'text-amber-100 border-amber-400/50 bg-amber-500/10'}`}>🔒 {row.isMine ? 'Your pick' : row.player} · {row.teamShort} {row.spreadValue}</div>))}{hasMyOuPickHere && (<div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-emerald-200 ${isMyTurn ? 'border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_16px_rgba(16,185,129,0.4)]' : 'border-emerald-400/30'}`}>🔒 Your pick {myPickInfo?.label ? `· ${myPickInfo.label}` : ''}</div>)}</div>)}
                {!ouPhase && (<div className="flex flex-wrap gap-2"><button className="border rounded px-2 py-1 text-sm disabled:opacity-40" disabled={!isMyTurn || homeTaken || hasMyLock} onClick={() => makeSpreadPick(g, g.home_short)}>Pick {g.home_short} ({fmtSigned(g.home_line)})</button><button className="border rounded px-2 py-1 text-sm disabled:opacity-40" disabled={!isMyTurn || awayTaken || hasMyLock} onClick={() => makeSpreadPick(g, g.away_short)}>Pick {g.away_short} ({fmtSigned(g.away_line)})</button></div>)}
                {ouPhase && (<div className="flex flex-wrap gap-2"><button className="border rounded px-2 py-1 text-sm disabled:opacity-40" disabled={!isMyTurn || g.total == null || myOuAlreadyPicked || hasMyLock} onClick={() => makeOuPick(g, 'OVER')}>OVER {g.total ?? '—'}</button><button className="border rounded px-2 py-1 text-sm disabled:opacity-40" disabled={!isMyTurn || g.total == null || myOuAlreadyPicked || hasMyLock} onClick={() => makeOuPick(g, 'UNDER')}>UNDER {g.total ?? '—'}</button></div>)}
              </div>
            );
          })}
        </div>
      </section>

      {/* PICKS FEED */}
      <section className="border rounded overflow-hidden max-w-4xl mx-auto w-full">
        <div className="px-3 py-2 text-xs bg-zinc-900/60 border-b">Picks</div>
        <ul className="divide-y divide-zinc-800/60">
          {picks.length === 0 ? (<li className="px-3 py-2 text-zinc-400">No picks yet.</li>) : (picks.map((p) => { const isSpread = p.picked_team_short != null; return (<li key={`${p.pick_id}-${p.pick_number}`} className="px-3 py-2"><strong>{p.player}</strong>{' '}{isSpread ? (<>picked <strong>{p.picked_team_short}</strong>{' '}{p.line_at_pick != null ? fmtSigned(p.line_at_pick) : ''} — {p.home_short} v {p.away_short}</>) : (<>O/U — <strong>{p.home_short} v {p.away_short}</strong> {p.ou_side} {p.total_at_pick ?? '—'}</>)}</li>); }))}
        </ul>
      </section>

      <style jsx global>{`
        .toast-pop { display:inline-flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); box-shadow:0 8px 24px rgba(0,0,0,0.35); color:#e5e7eb; background:#27272a; transform:translateY(8px); opacity:0; transition:transform 250ms ease,opacity 250ms ease; font-size:0.9rem; }
        .toast-pop.in { transform:translateY(0); opacity:1; }
        .toast-pop.out { transform:translateY(8px); opacity:0; }
        .toast-pop.positive { background:#064e3b; border-color:#065f46; color:#d1fae5; }
        .toast-pop.negative { background:#7f1d1d; border-color:#991b1b; color:#fee2e2; }
        .toast-pop.neutral { background:#27272a; border-color:#3f3f46; color:#e5e7eb; }
      `}</style>
    </div>
  );
}
