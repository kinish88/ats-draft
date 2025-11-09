'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { whoIsOnClock, totalAtsPicks, type Player } from '@/lib/draftOrder'

/* ------------------------------- constants ------------------------------- */

const YEAR = 2025

/** Canonical league order; DB starter rotates this each week */
const BASE_ORDER = ['Big Dawg', 'Pud', 'Kinish'] as const
type Starter = typeof BASE_ORDER[number]

/** Safely coerce a DB string into a valid starter */
function coerceStarter(s: string | null): Starter {
  const valid = BASE_ORDER.find((v) => v === s)
  return valid ?? BASE_ORDER[0]
}

const DEFAULT_PLAYER =
  (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null

const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null

const NFL_LOGO = (process.env.NEXT_PUBLIC_NFL_LOGO || '/nfl.svg').trim()

/* --------------------------------- types --------------------------------- */

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

/* --------------------------------- utils --------------------------------- */

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

/* -------------------------------- component ------------------------------- */

export default function DraftPage() {
  const [week, setWeek] = useState<number | null>(null)
  const [starter, setStarter] = useState<string | null>(null)
  const [board, setBoard] = useState<BoardRow[]>([])
  const [picks, setPicks] = useState<PickViewRow[]>([])
  const [myName, setMyName] = useState<string | null>(null)

  /* 🧠 Load current open week automatically */
  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('current_open_week')
        .select('week_id')
        .maybeSingle()
      if (error) {
        console.error('Failed to fetch current week:', error.message)
        return
      }
      if (data?.week_id) setWeek(Number(data.week_id))
    })()
  }, [])

  /* Who am I? */
  useEffect(() => {
    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth.user?.id || null
      if (!uid) {
        setMyName(DEFAULT_PLAYER)
        return
      }
      const { data: prof } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', uid)
        .maybeSingle()
      const nm = toStr(prof?.display_name || DEFAULT_PLAYER || '')
      setMyName(nm || null)
    })()
  }, [])

  /* Load starter rotation */
  async function loadStarter(w: number) {
    const { data, error } = await supabase
      .from('weeks')
      .select('starter_player')
      .eq('season_year', YEAR)
      .eq('week_number', w)
      .maybeSingle()
    if (!error) setStarter(toStr(data?.starter_player || ''))
  }

  /* Load board */
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

  /* Load picks */
  async function loadPicksMerged(w: number) {
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
    setPicks(mapped)
  }

  /* Load data when week changes */
  useEffect(() => {
    if (!week) return
    loadStarter(week)
    loadBoard(week)
    loadPicksMerged(week)
  }, [week])

  /* Realtime subscriptions */
  useEffect(() => {
    if (!week) return
    const ch = supabase
      .channel('draft-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, () => loadPicksMerged(week))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_lines' }, () => loadBoard(week))
      .subscribe()
    return () => void supabase.removeChannel(ch)
  }, [week])

  /* Derived state */
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

  if (!week) {
    return (
      <div className="text-center mt-12 opacity-70">
        Loading current draft week…
      </div>
    )
  }

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Draft Board</h1>
        <div className="text-sm opacity-70">Week {week}</div>
      </header>

      {/* --- your existing board and picks rendering below --- */}
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
                {p.line_at_pick != null ? fmtSigned(p.line_at_pick) : ''} —{' '}
                {p.home_short} v {p.away_short}
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  )
}
