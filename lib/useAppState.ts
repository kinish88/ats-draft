'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export type AppState = {
  season_year: number;
  current_week: number;
};

const FALLBACK: AppState = { season_year: 2026, current_week: 1 };

export function useAppState(): AppState & { loading: boolean } {
  const [state, setState] = useState<AppState>(FALLBACK);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('app_state')
        .select('season_year, current_week')
        .limit(1)
        .maybeSingle();
      if (data?.season_year) {
        setState({
          season_year: Number(data.season_year),
          current_week: Number(data.current_week ?? 1),
        });
      }
      setLoading(false);
    })();
  }, []);

  return { ...state, loading };
}
