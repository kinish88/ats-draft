'use client';

import CountdownBanner from '@/src/components/CountdownBanner';

type BaseItem = {
  className?: string;
};

export type ControlBarItem =
  | {
      type: 'week';
      ariaLabel?: string;
      value: number;
      options: number[];
      onChange: (value: number) => void;
    } & BaseItem
  | {
      type: 'toggle';
      label: string;
      ariaLabel?: string;
      checked: boolean;
      onChange: (value: boolean) => void;
    } & BaseItem
  | {
      type: 'text';
      text: string;
    } & BaseItem;

interface ControlBarProps {
  items?: ControlBarItem[];
}

const containerCls =
  'mx-auto w-full rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/70 via-slate-900/70 to-slate-950/80 px-4 py-4 text-slate-100 shadow-2xl shadow-black/30 backdrop-blur';
const pillBaseCls =
  'flex h-10 items-center justify-between gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 text-sm text-white/90 shadow-inner shadow-black/20 transition-colors';

export default function ControlBar({ items = [] }: ControlBarProps) {
  return (
    <div className="px-4 sm:px-6">
      <div className={containerCls}>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
          <CountdownBanner className="w-full lg:w-auto" />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {items.map((item, idx) => {
              if (item.type === 'week') {
                return (
                  <div
                    key={`week-${idx}`}
                    className={`${pillBaseCls} min-w-[170px] ${item.className ?? ''}`}
                  >
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
                const activeCls = item.checked
                  ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                  : '';
                return (
                  <label
                    key={`toggle-${idx}`}
                    className={`${pillBaseCls} select-none ${activeCls} ${item.className ?? ''}`}
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
                <div key={`text-${idx}`} className={`${pillBaseCls} ${item.className ?? ''}`}>
                  <span className="text-sm">{item.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
