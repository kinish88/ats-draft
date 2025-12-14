'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import CountdownBanner from '@/src/components/CountdownBanner';
import { supabase } from '@/lib/supabaseClient';

export type ControlBarItem =
  | {
      type: 'week';
      label?: string;
      ariaLabel?: string;
      value: number;
      options: number[];
      onChange: (value: number) => void;
    }
  | {
      type: 'toggle';
      label: string;
      ariaLabel?: string;
      checked: boolean;
      onChange: (value: boolean) => void;
    }
  | {
      type: 'text';
      text: string;
    };

interface ControlBarProps {
  items?: ControlBarItem[];
  showLogout?: boolean;
}

const containerCls =
  'mx-auto w-full rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/70 via-slate-900/70 to-slate-950/80 px-4 py-4 text-slate-100 shadow-2xl shadow-black/30 backdrop-blur';

const pillCls =
  'flex h-10 items-center justify-between gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 text-sm text-white/90 shadow-inner shadow-black/20';

export default function ControlBar({ items = [], showLogout = true }: ControlBarProps) {
  const router = useRouter();

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  }, [router]);

  return (
    <div className="px-4 sm:px-6">
      <div className={containerCls}>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
          <CountdownBanner className="w-full lg:w-auto" />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {items.map((item, idx) => {
              if (item.type === 'week') {
                return (
                  <div key={`week-${idx}`} className={`${pillCls} min-w-[180px]`}>
                    {item.label && <span className="text-xs uppercase tracking-wide opacity-60">{item.label}</span>}
                    <select
                      aria-label={item.ariaLabel ?? 'Week selector'}
                      className="h-8 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm focus:border-white focus:outline-none"
                      value={item.value}
                      onChange={(e) => item.onChange(parseInt(e.target.value, 10))}
                    >
                      {item.options.map((w) => (
                        <option key={w} value={w} className="bg-slate-900 text-white">
                          Week {w}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (item.type === 'toggle') {
                return (
                  <label
                    key={`toggle-${idx}`}
                    className={`${pillCls} select-none`}
                    aria-label={item.ariaLabel ?? item.label}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-400"
                      checked={item.checked}
                      onChange={(e) => item.onChange(e.target.checked)}
                    />
                    <span>{item.label}</span>
                  </label>
                );
              }

              return (
                <div key={`text-${idx}`} className={pillCls}>
                  <span className="text-sm">{item.text}</span>
                </div>
              );
            })}
          </div>

          {showLogout && (
            <button
              type="button"
              onClick={handleLogout}
              className="h-10 rounded-2xl border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Log out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
