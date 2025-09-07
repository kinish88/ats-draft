'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  display_name: string;
  spread_wins: number; spread_losses: number; spread_pushes: number;
  ou_wins: number; ou_losses: number; ou_pushes: number;
};

const YEAR = 2025;

export default function StandingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('get_season_standings', { p_year: YEAR });
      if (!error && data) {
        // Optional: keep your preferred order
        const order = ['Big Dawg', 'Pud', 'Kinish'];
        const sorted = (data as Row[]).sort((a, b) => {
          const ia = order.indexOf(a.display_name);
          const ib = order.indexOf(b.display_name);
          const va = ia === -1 ? 99 : ia;
          const vb = ib === -1 ? 99 : ib;
          return va - vb;
        });
        setRows(sorted);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Season Standings</h1>
        <Link className="underline" href="/">← Back</Link>
      </header>

      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="border rounded overflow-hidden">
          <div className="grid grid-cols-7 gap-2 text-sm font-medium p-2 border-b bg-black/30">
            <div>Player</div>
            <div className="text-center">ATS W</div>
            <div className="text-center">ATS L</div>
            <div className="text-center">ATS P</div>
            <div className="text-center">OU W</div>
            <div className="text-center">OU L</div>
            <div className="text-center">OU P</div>
          </div>
          {rows.map(r => (
            <div key={r.display_name} className="grid grid-cols-7 gap-2 text-sm p-2 border-b last:border-b-0">
              <div className="font-medium">{r.display_name}</div>
              <div className="text-center">{r.spread_wins}</div>
              <div className="text-center">{r.spread_losses}</div>
              <div className="text-center">{r.spread_pushes}</div>
              <div className="text-center">{r.ou_wins}</div>
              <div className="text-center">{r.ou_losses}</div>
              <div className="text-center">{r.ou_pushes}</div>
            </div>
          ))}
          {rows.length === 0 && <div className="p-3 text-sm text-gray-400">No data yet.</div>}
        </div>
      )}
    </div>
  );
}
