'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import Image from 'next/image'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Game = {
  game_id: number
  home_short: string
  away_short: string
  home_line: number | null
  away_line: number | null
  total: number | null
}

type Pick = {
  player: string
  team_short: string
}

const NFL_LOGO = '/NFL.png'

export default function DraftPage() {
  const [board, setBoard] = useState<Game[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [currentTurn, setCurrentTurn] = useState<string | null>(null)
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [ouPhase, setOuPhase] = useState(false)
  const [finalized, setFinalized] = useState(false)
  const playerName = 'Pud' // ← dynamically resolve from session in prod

  // ---- helpers -------------------------------------------------------
  const fmtSigned = (n: number | null) =>
    n == null ? 'Pick Em' : n > 0 ? `+${n}` : n.toString()

  const teamLogo = (short: string) =>
    `/team-logos/${short.toUpperCase()}.png`

  const pickedTeams = new Set(picks.map((p) => p.team_short.toUpperCase()))
  const myOuAlreadyPicked = picks.some(
    (p) => p.player === playerName && p.team_short.includes('O/U')
  )

  // ---- data fetch ----------------------------------------------------
  const loadBoard = async () => {
    const { data, error } = await supabase.rpc('get_week_draft_board', {
      p_year: 2025,
      p_week: 11,
    })
    if (!error) setBoard(data ?? [])
  }

  const loadPicks = async () => {
    const { data, error } = await supabase.rpc('get_week_picks', {
      p_year: 2025,
      p_week: 11,
    })
    if (!error) setPicks(data ?? [])
  }

  const loadTurn = async () => {
    const { data } = await supabase.rpc('get_current_turn')
    if (data) {
      setCurrentTurn(data.player)
      setOuPhase(!!data.ou_phase)
    }
  }

  // ---- realtime channel ----------------------------------------------
  useEffect(() => {
    loadBoard()
    loadPicks()
    loadTurn()

    const ch = supabase.channel('draft_realtime')
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, () => loadPicks())
    ch.subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  useEffect(() => {
    setIsMyTurn(currentTurn?.toLowerCase() === playerName.toLowerCase())
  }, [currentTurn])

  // ---- make picks ----------------------------------------------------
  const makeSpreadPick = async (g: Game, team: string) => {
    if (!isMyTurn) return
    const { error } = await supabase.rpc('make_pick_by_teams', {
      p_year: 2025,
      p_week: 11,
      p_player: playerName,
      p_home: g.home_short,
      p_away: g.away_short,
      p_pick_team: team,
    })
    if (!error) {
      showToast(`${playerName} picked ${team} (${fmtSigned(
        team === g.home_short ? g.home_line : g.away_line
      )})`, team, team === g.home_short ? g.home_line : g.away_line)
    }
  }

  const makeOuPick = async (g: Game, side: string) => {
    if (!isMyTurn) return
    const { error } = await supabase.rpc('make_ou_pick_by_shorts', {
      p_year: 2025,
      p_week: 11,
      p_player: playerName,
      p_home: g.home_short,
      p_away: g.away_short,
      p_side: side,
    })
    if (!error) {
      showToast(`${playerName} picked ${side} ${g.total}`, side, null)
    }
  }

  // ---- toast system --------------------------------------------------
  const [toasts, setToasts] = useState<
    { id: number; msg: string; logo: string; color: string }[]
  >([])
  const toastId = useRef(0)

  const showToast = (msg: string, team: string, spread: number | null) => {
    const id = ++toastId.current
    const color =
      spread == null
        ? '#444'
        : spread > 0
        ? '#14532d' // green
        : '#7f1d1d' // red

    const logo = teamLogo(team)
    setToasts((t) => [...t, { id, msg, logo, color }])
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
    }, 3000)
  }

  // ---- render --------------------------------------------------------
  if (finalized) {
    return (
      <div className="flex flex-col items-center mt-20 text-center">
        <Image src={NFL_LOGO} alt="NFL" width={80} height={80} />
        <h2 className="text-2xl mt-4 font-bold">🏈 PICKS ARE IN 🏈</h2>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Draft Board</h2>
        <div className="text-sm text-zinc-400">Week 11</div>
      </div>

      <div className="text-sm">
        On the clock: <b>{currentTurn ?? '...'}</b>{' '}
        {isMyTurn ? (
          <span className="text-green-400 ml-2">you’re up</span>
        ) : (
          <span className="text-zinc-400 ml-2">wait for your turn</span>
        )}
      </div>

      {/* ================= GAME LINES ================= */}
      <section className="border rounded overflow-hidden">
        <div className="px-3 py-2 text-xs bg-zinc-900/60 border-b border-zinc-800 uppercase tracking-wide">
          Game Lines
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/30 text-zinc-400">
            <tr>
              <th className="text-left px-3 py-2">Game</th>
              <th className="text-right px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {board.map((g) => (
              <tr key={g.game_id} className="hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <img src={teamLogo(g.home_short)} alt={g.home_short} className="w-5 h-5 rounded-sm" />
                    <span className="font-semibold">{g.home_short}</span>
                    <span className="text-xs text-zinc-400 ml-1">{fmtSigned(g.home_line)}</span>
                    <span className="text-zinc-500 mx-2">v</span>
                    <img src={teamLogo(g.away_short)} alt={g.away_short} className="w-5 h-5 rounded-sm" />
                    <span className="font-semibold">{g.away_short}</span>
                    <span className="text-xs text-zinc-400 ml-1">{fmtSigned(g.away_line)}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-xs text-zinc-400">
                  O/U <span className="text-zinc-200">{g.total ?? '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ================= PICK SECTION ================= */}
      <section>
        <div className="px-3 py-2 text-xs bg-zinc-900/60 border border-zinc-800 rounded-t uppercase tracking-wide">
          Make Picks
        </div>
        <div className="grid md:grid-cols-2 gap-3 border border-t-0 border-zinc-800 rounded-b p-3">
          {board.map((g) => {
            const homeTaken = pickedTeams.has(g.home_short.toUpperCase())
            const awayTaken = pickedTeams.has(g.away_short.toUpperCase())
            const showSpreadButtons = !ouPhase
            const showOuButtons = ouPhase

            return (
              <div key={g.game_id} className="border rounded p-3 bg-zinc-950/50">
                <div className="text-sm text-zinc-300 mb-2">
                  {g.home_short} vs {g.away_short}
                </div>

                {showSpreadButtons && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                      disabled={!isMyTurn || homeTaken}
                      onClick={() => makeSpreadPick(g, g.home_short)}
                    >
                      Pick {g.home_short} ({fmtSigned(g.home_line)})
                    </button>
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                      disabled={!isMyTurn || awayTaken}
                      onClick={() => makeSpreadPick(g, g.away_short)}
                    >
                      Pick {g.away_short} ({fmtSigned(g.away_line)})
                    </button>
                  </div>
                )}

                {showOuButtons && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                      disabled={!isMyTurn || g.total == null || myOuAlreadyPicked}
                      onClick={() => makeOuPick(g, 'OVER')}
                    >
                      OVER {g.total ?? '—'}
                    </button>
                    <button
                      className="border rounded px-2 py-1 text-sm disabled:opacity-40"
                      disabled={!isMyTurn || g.total == null || myOuAlreadyPicked}
                      onClick={() => makeOuPick(g, 'UNDER')}
                    >
                      UNDER {g.total ?? '—'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ================= TOASTS ================= */}
      <div className="fixed bottom-5 right-5 space-y-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 text-white px-3 py-2 rounded shadow-md animate-toast"
            style={{ backgroundColor: t.color }}
          >
            <img src={t.logo} alt="" className="w-5 h-5" />
            <span className="text-sm">{t.msg}</span>
          </div>
        ))}
      </div>

      <style jsx global>{`
        @keyframes toastFade {
          0% {
            opacity: 0;
            transform: translateY(20px);
          }
          20% {
            opacity: 1;
            transform: translateY(0);
          }
          80% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(-10px);
          }
        }
        .animate-toast {
          animation: toastFade 2s ease-in-out forwards;
        }
      `}</style>
    </div>
  )
}
