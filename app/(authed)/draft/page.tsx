'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { whoIsOnClock, totalAtsPicks, type Player } from '@/lib/draftOrder'

/* ----------------------------- constants ----------------------------- */

const YEAR = 2025
const BASE_ORDER = ['Big Dawg', 'Pud', 'Kinish'] as const
type Starter = typeof BASE_ORDER[number]

function coerceStarter(s: string | null): Starter {
  const valid = BASE_ORDER.find((v) => v === s)
  return valid ?? BASE_ORDER[0]
}

const DEFAULT_PLAYER =
  (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null

const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null

/* ----------------------------- helpers ----------------------------- */

const norm = (s: string) => s.trim().toLowerCase()
function toStr(x: unknown, fb = ''): string {
  return typeof x === 'string' ? x : x == null ? fb : String(x)
}
function toNumOrNull(x: unknown): number | null {
  if (x == null) return null
  const n = typeof x === 'number' ? x : Number(x)
  return Number.isFinite(n) ? n : null
}
function asRec(x: unknown): Record<string, unknown> {
  return (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}) as Record<string, unknown>
}
function teamLogo(short?: string | null): string | null {
  if (!short) return null
  return LOGO_BASE ? `${LOGO_BASE}/${short}.png` : `/teams/${short}.png`
}
function fmtSigned(n: number) {
  if (n === 0) return 'Pick Em'
  return n > 0 ? `+${n}` : `${n}`
}

/* ----------------------------- types ----------------------------- */

type BoardRow = {
  game_id: number
  home_short: string
  away_short: string
  home_line: number
  away_line: number
  total: number | null
}

type PickViewRow = {
  pick_id: number
  created_at: string | null
  pick_number: number
  season_year: number
  week_number: number
  player: string
  home_short: string
  away_short: string
  picked_team_short: string | null
  line_at_pick: number | null
  total_at_pick: number | null
  ou_side?: 'OVER' | 'UNDER' | null
  game_id_hint?: number | null
}

/* ----------------------------- component ----------------------------- */

export default function DraftPage() {
  const [week, setWeek] = useState<number | null>(null)
  const [starter, setStarter] = useState<string | null>(null)
  const [board, setBoard] = useState<BoardRow[]>([])
  const [picks, setPicks] = useState<PickViewRow[]>([])
  const [myName, setMyName] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; logo?: string } | null>(null)

  /* 🧠 Load current open week automatically */
  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('current_open_week')
        .select('week_id')
        .maybeSingle()
      if (!error && data?.week_id) setWeek(Number(data.week_id))
    })()
  }, [])

  /* Identify user */
  useEffect(() => {
    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth.user?.id || null
      if (!uid) return setMyName(DEFAULT_PLAYER)
      const { data } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', uid)
        .maybeSingle()
      setMyName(toStr(data?.display_name || DEFAULT_PLAYER || ''))
    })()
  }, [])

  async function loadStarter(w: number) {
    const { data } = await supabase
      .from('weeks')
      .select('starter_player')
      .eq('season_year', YEAR)
      .eq('week_number', w)
      .maybeSingle()
    setStarter(toStr(data?.starter_player || ''))
  }

  async function loadBoard(w: number) {
    const { data } = await supabase.rpc('get_week_draft_board', {
      p_year: YEAR,
      p_week: w,
    })
    const rows: unknown[] = Array.isArray(data) ? data : []
    const mapped: BoardRow[] = rows.map((r) => {
      const o = asRec(r)
      const home = toStr(o.home_short)
      const away = toStr(o.away_short)
      let hLine = toNumOrNull(o.home_line)
      let aLine = toNumOrNull(o.away_line)
      if (hLine == null || aLine == null) {
        const raw = toNumOrNull(o.spread)
        if (raw != null) {
          hLine = -raw
          aLine = +raw
        } else {
          hLine = aLine = 0
        }
      }
      return {
        game_id: Number(o.game_id ?? 0),
        home_short: home,
        away_short: away,
        home_line: hLine,
        away_line: aLine,
        total: toNumOrNull(o.total),
      }
    })
    setBoard(mapped)
  }

  async function loadPicksMerged(w: number, showToast = false) {
    const { data } = await supabase.rpc('get_week_picks', {
      p_year: YEAR,
      p_week: w,
    })
    const arr: unknown[] = Array.isArray(data) ? data : []
    const mapped: PickViewRow[] = arr.map((r) => {
      const o = asRec(r)
      return {
        pick_id: Number(o.pick_id ?? 0),
        created_at: toStr(o.created_at),
        pick_number: Number(o.pick_number ?? 0),
        season_year: YEAR,
        week_number: w,
        player: toStr(o.player),
        home_short: toStr(o.home_short),
        away_short: toStr(o.away_short),
        picked_team_short: toStr(o.picked_team_short, '') || null,
        line_at_pick: toNumOrNull(o.line_at_pick),
        total_at_pick: toNumOrNull(o.total_at_pick),
        ou_side: null,
      }
    })

    // 🔔 Toast: show the newest pick
    if (showToast && mapped.length > picks.length) {
      const latest = mapped[mapped.length - 1]
      if (latest && latest.picked_team_short) {
        setToast({
          msg: `${latest.player} picked ${latest.picked_team_short} (${fmtSigned(
            latest.line_at_pick ?? 0
          )})`,
          logo: teamLogo(latest.picked_team_short) || undefined,
        })
        setTimeout(() => setToast(null), 3500)
      }
    }

    setPicks(mapped)
  }

  useEffect(() => {
    if (!week) return
    loadStarter(week)
    loadBoard(week)
    loadPicksMerged(week)
  }, [week])

  /* 🔄 Realtime updates */
  useEffect(() => {
    if (!week) return
    const ch = supabase
      .channel('draft-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'picks' },
        () => loadPicksMerged(week, true)
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_lines' }, () =>
        loadBoard(week)
      )
      .subscribe()
    return () => void supabase.removeChannel(ch)
  }, [week])

  /* Derived draft state */
  const playersR1Names = useMemo(() => {
    const s: Starter = coerceStarter(starter)
    const idx = BASE_ORDER.indexOf(s)
    return [...BASE_ORDER.slice(idx), ...BASE_ORDER.slice(0, idx)]
  }, [starter])

  const playersR1: Player[] = useMemo(
    () => playersR1Names.map((n) => ({ id: n, display_name: n })),
    [playersR1Names]
  )

  const spreadPicksCount = useMemo(
    () => picks.filter((p) => p.picked_team_short != null).length,
    [picks]
  )

  const atsTotal = totalAtsPicks(playersR1.length)
  const draftComplete = spreadPicksCount >= atsTotal

  const { player: onClockPlayer } = whoIsOnClock({
    current_pick_number: Math.min(spreadPicksCount, atsTotal - 1),
    players: playersR1,
  })
  const onClock = draftComplete ? '' : onClockPlayer.display_name

  if (!week)
    return <div className="text-center mt-12 opacity-70">Loading current draft week…</div>

  /* ----------------------------- render ----------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Draft Board</h1>
        <div className="text-sm opacity-70">Week {week}</div>
      </header>

      {/* 🏈 On clock */}
      {!draftComplete ? (
        <div className="text-sm text-zinc-400">
          On the clock: <span className="text-zinc-100 font-medium">{onClock}</span>
          {myName ? (
            <span className="ml-3">
              You are <span className="font-medium">{myName}</span> —{' '}
              {norm(onClock) === norm(myName) ? (
                <span className="text-emerald-400 font-medium">your turn</span>
              ) : (
                <span className="text-zinc-400">wait</span>
              )}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-3 py-2 rounded bg-zinc-900/50 border border-zinc-800">
          <span className="text-emerald-400 font-semibold tracking-wide">🏈 PICKS ARE IN 🏈</span>
        </div>
      )}

      {/* Board */}
      <section className="border rounded overflow-hidden">
        <div className="grid grid-cols-[1fr,64px] text-xs px-3 py-2 bg-zinc-900/60 border-b">
          <div>Game</div>
          <div className="text-right">Total</div>
        </div>
        <div className="divide-y divide-zinc-800/60">
          {board.map((r, i) => (
            <div key={`${r.game_id}-${i}`} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <img src={teamLogo(r.home_short) || ''} alt={r.home_short} className="w-4 h-4 rounded-sm" />
                <span className="w-8 font-semibold">{r.home_short}</span>
                <span className="ml-1 text-xs text-zinc-400">{fmtSigned(r.home_line)}</span>
                <span className="text-zinc-500 mx-2">v</span>
                <img src={teamLogo(r.away_short) || ''} alt={r.away_short} className="w-4 h-4 rounded-sm" />
                <span className="w-8 font-semibold">{r.away_short}</span>
                <span className="ml-1 text-xs text-zinc-400">{fmtSigned(r.away_line)}</span>
              </div>
              <span className="w-12 text-right tabular-nums">{r.total ?? '—'}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Picks list */}
      <section className="border rounded overflow-hidden">
        <div className="px-3 py-2 text-xs bg-zinc-900/60 border-b">Picks</div>
        <ul className="divide-y divide-zinc-800/60">
          {picks.length === 0 ? (
            <li className="px-3 py-2 text-zinc-400">No picks yet.</li>
          ) : (
            picks.map((p) => (
              <li key={p.pick_id} className="px-3 py-2">
                <strong>{p.player}</strong> picked{' '}
                <strong>{p.picked_team_short}</strong>{' '}
                {p.line_at_pick != null ? fmtSigned(p.line_at_pick) : ''} — {p.home_short} v {p.away_short}
              </li>
            ))
          )}
        </ul>
      </section>

      {/* 🔔 Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-fadein text-sm">
          {toast.logo && <img src={toast.logo} alt="team" className="w-5 h-5 rounded-sm" />}
          <span>{toast.msg}</span>
        </div>
      )}
      <style jsx>{`
        @keyframes fadein {
          0% {
            opacity: 0;
            transform: translate(-50%, 10px);
          }
          10%,
          90% {
            opacity: 1;
            transform: translate(-50%, 0);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, 10px);
          }
        }
        .animate-fadein {
          animation: fadein 3.5s ease-in-out;
        }
      `}</style>
    </div>
  )
}
