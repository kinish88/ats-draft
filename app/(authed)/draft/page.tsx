'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  whoIsOnClock,
  totalAtsPicks,
  type Player,
} from '@/lib/draftOrder'

const YEAR = 2025
const BASE_ORDER = ['Big Dawg', 'Pud', 'Kinish'] as const
type Starter = typeof BASE_ORDER[number]
const STARTER_SET: ReadonlySet<string> = new Set(BASE_ORDER)
function coerceStarter(s: string | null): Starter {
  return s && STARTER_SET.has(s) ? (s as Starter) : BASE_ORDER[0]
}

const DEFAULT_PLAYER =
  (process.env.NEXT_PUBLIC_DEFAULT_PLAYER_NAME || '').trim() || null
const LOGO_BASE =
  (process.env.NEXT_PUBLIC_TEAM_LOGO_BASE || '').replace(/\/+$/, '') || null
const NFL_LOGO = (process.env.NEXT_PUBLIC_NFL_LOGO || '/nfl.svg').trim()

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

type AdminOuRowUnknown = {
  player?: unknown
  home_short?: unknown
  away_short?: unknown
  pick_side?: unknown
  total_at_pick?: unknown
  game_id?: unknown
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
function fmtSigned(n: number): string {
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

      if (data?.week_id) {
        setWeek(Number(data.week_id))
      } else {
        console.warn('No open week found')
      }
    })()
  }, [])

  /* who am I? */
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

  async function loadStarter(w: number) {
    const { data, error } = await supabase
      .from('weeks')
      .select('starter_player')
      .eq('season_year', YEAR)
      .eq('week_number', w)
      .maybeSingle()
    if (!error) setStarter(toStr(data?.starter_player || ''))
  }

  async function loadBoard(w: number) {
    const { data } = await supabase.rpc('get_week_draft_board', {
      p_year: YEAR,
      p_week: w,
    })
    const rows: unknown[] = Array.isArray(data) ? (data as unknown[]) : []
    const mapped: BoardRow[] = rows.map((r) => {
      const o = asRec(r)
      const home = toStr(o.home_short)
      const away = toStr(o.away_short)

      let hLine =
        toNumOrNull(o.home_line) ??
        toNumOrNull(o.home_spread) ??
        toNumOrNull(o.spread_home)
      let aLine =
        toNumOrNull(o.away_line) ??
        toNumOrNull(o.away_spread) ??
        toNumOrNull(o.spread_away)

      if (hLine == null || aLine == null) {
        const raw = toNumOrNull(o.spread)
        const favShort = toStr(o.favorite_short, '').toUpperCase()
        const favIsHome: boolean | null =
          favShort
            ? favShort === home.toUpperCase()
            : typeof o.favorite_is_home === 'boolean'
            ? Boolean(o.favorite_is_home)
            : typeof o.is_home_favorite === 'boolean'
            ? Boolean(o.is_home_favorite)
            : null

        if (raw != null) {
          const mag = Math.abs(raw)
          if (favIsHome === true) {
            hLine = -mag
            aLine = +mag
          } else if (favIsHome === false) {
            hLine = +mag
            aLine = -mag
          } else {
            hLine = raw
            aLine = -raw
          }
        }
      }

      if (hLine == null || aLine == null) {
        hLine = 0
        aLine = 0
      }

      return {
        game_id: Number(o.game_id ?? o.id ?? 0),
        home_short: home,
        away_short: away,
        home_line: hLine,
        away_line: aLine,
        total: toNumOrNull(o.total),
      }
    })

    setBoard(mapped)
  }

  async function loadPicksMerged(w: number) {
    const { data } = await supabase.rpc('get_week_picks', {
      p_year: YEAR,
      p_week: w,
    })
    const spreadArr: unknown[] = Array.isArray(data) ? (data as unknown[]) : []
    const spreadMapped: PickViewRow[] = spreadArr.map((r) => {
      const o = asRec(r)
      return {
        pick_id: Number(o.pick_id ?? 0),
        created_at: toStr(o.created_at, null as unknown as string),
        pick_number: Number(toNumOrNull(o.pick_number) ?? 0),
        season_year: Number(toNumOrNull(o.season_year) ?? YEAR),
        week_number: Number(toNumOrNull(o.week_number) ?? w),
        player: toStr(o.player),
        home_short: toStr(o.home_short),
        away_short: toStr(o.away_short),
        picked_team_short: toStr(o.picked_team_short, '') || null,
        line_at_pick: toNumOrNull(o.line_at_pick),
        total_at_pick: toNumOrNull(o.total_at_pick),
        ou_side: null,
        game_id_hint: Number(toNumOrNull(o.game_id)),
      }
    })

    const { data: ouRaw } = await supabase.rpc('get_week_ou_picks_admin', {
      p_year: YEAR,
      p_week: w,
    })
    const ouArr: unknown[] = Array.isArray(ouRaw) ? (ouRaw as unknown[]) : []

    const findGameId = (homeShort: string, awayShort: string): number | null => {
      const item = board.find(
        (b) =>
          norm(b.home_short) === norm(homeShort) &&
          norm(b.away_short) === norm(awayShort)
      )
      return item?.game_id ?? null
    }

    const ouMapped: PickViewRow[] = ouArr.map((r, idx) => {
      const x = r as AdminOuRowUnknown
      const side: 'OVER' | 'UNDER' =
        toStr(x.pick_side).trim().toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER'
      const home = toStr(x.home_short)
      const away = toStr(x.away_short)
      const gid =
        Number(toNumOrNull(x.game_id)) ?? (findGameId(home, away) ?? null)

      return {
        pick_id: 10_000 + idx,
        created_at: null,
        pick_number: 100 + idx,
        season_year: YEAR,
        week_number: w,
        player: toStr(x.player),
        home_short: home,
        away_short: away,
        picked_team_short: null,
        line_at_pick: null,
        total_at_pick: toNumOrNull(x.total_at_pick),
        ou_side: side,
        game_id_hint: gid,
      }
    })

    const merged = [...spreadMapped, ...ouMapped].sort((a, b) =>
      a.pick_number === b.pick_number
        ? (a.created_at ?? '').localeCompare(b.created_at ?? '')
        : a.pick_number - b.pick_number
    )

    setPicks(merged)
  }

  /* Load data once week is known */
  useEffect(() => {
    if (!week) return
    loadStarter(week)
    loadBoard(week)
    loadPicksMerged(week)
  }, [week])

  /* realtime */
  useEffect(() => {
    if (!week) return
    const ch = supabase
      .channel('draft-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'picks' }, () => loadPicksMerged(week))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ou_picks' }, () => loadPicksMerged(week))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ou_picks' }, () => loadPicksMerged(week))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games' }, () => loadBoard(week))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_lines' }, () => loadBoard(week))
      .subscribe()

    return () => {
      void supabase.removeChannel(ch)
    }
  }, [week])

  /* Derived values (unchanged from before) */

  const playersR1Names: string[] = useMemo(() => {
    const s: Starter = coerceStarter(starter)
    return [...BASE_ORDER.slice(BASE_ORDER.indexOf(s)), ...BASE_ORDER.slice(0, BASE_ORDER.indexOf(s))]
  }, [starter])

  const playersR1: Player[] = useMemo(
    () => playersR1Names.map((name) => ({ id: name, display_name: name })),
    [playersR1Names]
  )

  const spreadPicksCount = useMemo(
    () => picks.filter((p) => p.picked_team_short != null).length,
    [picks]
  )
  const ouPicksCount = useMemo(
    () => picks.filter((p) => p.total_at_pick != null).length,
    [picks]
  )

  const atsTotal = totalAtsPicks(playersR1.length)
  const totalPicksThisWeek = atsTotal + playersR1.length
  const totalPicksMade = spreadPicksCount + ouPicksCount
  const ouPhase = spreadPicksCount >= atsTotal
  const draftComplete = totalPicksMade >= totalPicksThisWeek

  const currentPickNumber = draftComplete
    ? totalPicksThisWeek
    : ouPhase
    ? atsTotal + ouPicksCount
    : spreadPicksCount

  const { player: onClockPlayer } = whoIsOnClock({
    current_pick_number: Math.min(currentPickNumber, totalPicksThisWeek - 1),
    players: playersR1,
  })

  const onClock = draftComplete ? '' : onClockPlayer.display_name
  const isMyTurn = !draftComplete && myName != null && norm(onClock) === norm(myName)

  const myOuAlreadyPicked = useMemo(() => {
    if (!myName) return false
    const me = norm(myName)
    return picks.some((p) => p.total_at_pick != null && norm(p.player) === me)
  }, [picks, myName])

  const pickedTeams = useMemo(() => {
    const s = new Set<string>()
    for (const p of picks) if (p.picked_team_short) s.add(p.picked_team_short.toUpperCase())
    return s
  }, [picks])

  const takenOuGameIds = useMemo(() => {
    const s = new Set<number>()
    for (const p of picks) if (p.total_at_pick != null && p.game_id_hint != null) s.add(p.game_id_hint)
    return s
  }, [picks])

  const picksByPlayer = useMemo(() => {
    const map = new Map<string, PickViewRow[]>()
    for (const name of playersR1Names) map.set(name, [])
    for (const p of picks) {
      const key =
        (playersR1Names.find((n) => norm(n) === norm(p.player)) ?? p.player) || 'Unknown'
      const list = map.get(key) ?? []
      list.push(p)
      map.set(key, list)
    }
    for (const [, list] of map) list.sort((a, b) => a.pick_number - b.pick_number)
    return Array.from(map.entries())
  }, [picks, playersR1Names])

  async function makePick(row: BoardRow, team_short: string) {
    if (!week || !isMyTurn || draftComplete || ouPhase) return
    const teamLine =
      team_short === row.home_short ? row.home_line : row.away_line
    const { error } = await supabase.from('picks').insert([
      {
        season_year: YEAR,
        pick_number: spreadPicksCount + 1,
        player_display_name: myName,
        team_short,
        home_short: row.home_short,
        away_short: row.away_short,
        spread_at_pick: teamLine,
        game_id: row.game_id,
      },
    ])
    if (error) alert(`Could not place pick: ${error.message}`)
    else loadPicksMerged(week)
  }

  async function handleOuPick(
    game: { id: number; home: string; away: string },
    side: 'OVER' | 'UNDER',
    playerName: string | null
  ) {
    if (!week || !isMyTurn || draftComplete || !ouPhase || !playerName) return
    const { error } = await supabase.rpc('make_ou_pick_by_shorts', {
      p_year: YEAR,
      p_week: week,
      p_player: playerName,
      p_home: game.home,
      p_away: game.away,
      p_side: side,
    })
    if (error) alert(`Could not place O/U pick: ${error.message}`)
    else loadPicksMerged(week)
  }

  if (!week) {
    return <div className="text-center mt-12 opacity-70">Loading current draft week...</div>
  }

  /* ------------------------------- render ------------------------------- */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Draft Board</h1>
        <div className="text-sm opacity-70">Week {week}</div>
      </header>

      {/* Rest of your render unchanged from your existing component */}
      {/* (board, picks, grouped by player, buttons, etc.) */}
      {/* I’ve omitted here for brevity because the rest of your render stays identical */}
    </div>
  )
}
