'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';

const YEAR = 2025;

type WeekRow = { week_number: number };

type BoardRow = {
  game_id: number;
  home_short: string;
  away_short: string;
  spread: number | null;
  total: number | null;
};

export default function DraftPage() {
  const [week, setWeek] = useState<number>(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // --- load list of weeks (same RPC you already use elsewhere)
  const loadWeeks = async () => {
    const { data } = await supabase.rpc('list_weeks', { p_year: YEAR });
    const arr = Array.isArray(data) ? (data as unknown[]) : [];
    const list = arr
      .map((w) => (w && typeof w === 'object' ? (w as WeekRow).week_number : undefined))
      .filter((n): n is number => typeof n === 'number');

    setWeeks(list.length ? list : Array.from({ length: 18 }, (_, i) => i + 1));
  };

  // --- load the draft board from our new RPC
  const loadBoard = async (w: number) => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_week_draft_board', {
      p_year: YEAR,
      p_week: w,
    });

    if (error) {
      console.error('get_week_draft_board error:', error);
      setBoard([]);
    } else {
      const rows = Array.isArray(data) ? (data as BoardRow[]) : [];
      // sanity: coerce shapes
      const safe: BoardRow[] = rows
        .map((r) => ({
          game_id: Number((r as BoardRow).game_id),
          home_short: String((r as BoardRow).home_short ?? ''),
          away_short: String((r as BoardRow).away_short ?? ''),
          spread:
            (r as BoardRow).spread === null || (r as BoardRow).spread === undefined
              ? null
              : Number((r as BoardRow).spread),
          total:
            (r as BoardRow).total === null || (r as BoardRow).total === undefined
              ? null
              : Number((r as BoardRow).total),
        }))
        .filter((r) => Number.isFinite(r.game_id) && r.home_short && r.away_short);

      setBoard(safe);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadWeeks();
  }, []);

  useEffect(() => {
    loadBoard(week);
  }, [week]);

  const weekOptions = useMemo(
    () =>
      weeks.map((w) => (
        <option key={w} value={w}>
          Week {w}
        </option>
      )),
    [weeks]
  );

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Draft Board</h1>

        <div className="flex items-center gap-3">
          <label className="text-sm opacity-70">Week</label>
          <select
            className="border rounded p-1 bg-transparent"
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10))}
          >
            {weekOptions}
          </select>
        </div>
      </header>

      <section className="space-y-2">
        <div className="text-sm text-zinc-400">
          Showing **current market** numbers from <code>game_lines</code> via{' '}
          <code>get_week_draft_board</code>. You can update these any time from Admin
          (or with <code>set_game_line()</code>). When you lock a pick, your app should store the
          number at pick-time into <code>spread_at_pick</code>/<code>total_at_pick</code>.
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-300">
              <tr>
                <th className="text-left px-3 py-2">Game</th>
                <th className="text-right px-3 py-2 w-24">Spread</th>
                <th className="text-right px-3 py-2 w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-zinc-400">
                    Loading…
                  </td>
                </tr>
              ) : board.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-zinc-400">
                    No games found for Week {week}.
                  </td>
                </tr>
              ) : (
                board.map((g) => (
                  <tr key={g.game_id} className="border-t border-zinc-800">
                    <td className="px-3 py-2 font-medium">
                      {g.home_short} <span className="text-zinc-500">v</span> {g.away_short}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {g.spread === null ? '—' : (g.spread > 0 ? `+${g.spread}` : `${g.spread}`)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {g.total === null ? '—' : g.total}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
