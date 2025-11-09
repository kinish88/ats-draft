'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { whoIsOnClock, totalAtsPicks, type Player } from '@/lib/draftOrder'

const YEAR = 2025
const BASE_ORDER = ['Big Dawg', 'Pud', 'Kinish'] as const
type Starter = typeof BASE_ORDER[number]
const STARTER_SET = new Set(BASE_ORDER)
function coerceStarter(s: string | null): Starter {
  return s && STARTER_SET.has(s) ? (s as Starter) : BASE_ORDER[0]
}

const DEFAULT_PLAYER =
  (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null
const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null
const NFL_LOGO = (process.env.NEXT_PUBLIC_NFL_LOGO || '/nfl.svg').trim()

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
  return short ? (LOGO_BASE ? `${LOGO_BASE}/${short}.png` : `/teams/${short}.png`) : null
}
function fmtSigned(n: number) {
  if (n === 0) return 'Pick Em'
  return n > 0 ? `+${n}` : `${n}`
}

export default function DraftPage() {
  const [week, setWeek] = useState<number | null>(null)
  const [starter, setStarter] = useState<string | null>(null)
  const [board, setBoard] = useState<any[]>([])
  const [picks, setPicks] = useState<any[]>([])
  const [myName, setMyName] = useState<string | null>(null)

  // 🧠 fetch current open week once
  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('current_open_week')
        .select('week_id')
        .maybeSingle()
      if (error) console.error('Fetch week failed:', error.message)
      if (data?.week_id) setWeek(Number(data.week_id))
    })()
  }, [])

  // identify user
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
    const { data } = await supabase.rpc('get_week_draft_board', { p_year: YEAR, p_week: w })
    const rows: any[] = Array.isArray(data) ? data : []
    setBoard(
      rows.map((r) => {
        const o = asRec(r)
        const home = toStr(o.home_short)
        const away = toStr(o.away_short)
        let h = toNumOrNull(o.home_line)
        let a = toNumOrNull(o.away_line)
        if (h == null || a == null) {
          const raw = toNumOrNull(o.spread)
          if (raw != null) {
            h = -raw
            a = +raw
          } else {
            h = a = 0
          }
        }
        return {
          game_id: Number(o.game_id ?? 0),
          home_short: home,
          away_short: away,
          home_line: h!,
          away_line: a!,
          total: toNumOrNull(o.total),
        }
      })
    )
  }

  async function loadPicksMerged(w: number) {
    const { data } = await supabase.rpc('get_week_picks', { p_year: YEAR, p_week: w })
    const spreadArr: any[] = Array.isArray(data) ? data : []
    const spreadMapped = spreadArr.map((o) => ({
      pick_id: Number(o.pick_id ?? 0),
      created_at: toStr(o.created_at),
      pick_number: Number(o.pick_number ?? 0),
      week_number: w,
      player: toStr(o.player),
      home_short: toStr(o.home_short),
      away_short: toStr(o.away_short),
      picked_team_short: toStr(o.picked_team_short, '') || null,
      line_at_pick: toNumOrNull(o.line_at_pick),
      total_at_pick: toNumOrNull(o.total_at_pick),
      ou_side: null,
    }))
    setPicks(spreadMapped)
  }

  useEffect(() => {
    if (!week) return
    loadStarter(week)
    loadBoard(week)
    loadPicksMerged(week)
  }, [week])

  // realtime reloads
  useEffect(() => {
    if (!week) return
    const ch = supabase
      .channel('draft-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, () => loadPicksMerged(week))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_lines' }, () => loadBoard(week))
      .subscribe()
    return () => void supabase.removeChannel(ch)
  }, [week])

  /* derived */
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
  const isMyTurn = !draftComplete && myName && norm(onClock) === norm(myName)

  if (!week)
    return (
      <div className="text-center mt-12 opacity-70">
        Loading current draft week…
      </div>
    )

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Draft Board</h1>
        <div className="text-sm opacity-70">Week {week}</div>
      </header>

      {/* --- existing board / picks render here unchanged --- */}
    </div>
  )
}
