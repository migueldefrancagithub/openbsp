"use client";

import type { LucideIcon } from "lucide-react";

type TabItem = {
  key: string;
  label: string;
  value?: string;
  icon?: LucideIcon;
};

export function SegmentedTabs({
  items,
  selected,
  onChange,
  className = "",
}: {
  items: TabItem[];
  selected: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const gridClass = items.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6";

  return (
    <div
      role="tablist"
      className={`rounded-lg border border-slate-200 bg-white p-1 ${className}`}
    >
      <div className={`grid gap-1 ${gridClass}`}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.key === selected;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.key)}
              className={`group flex min-h-12 min-w-0 items-center gap-1.5 rounded-md px-2 text-left transition-colors sm:gap-2 sm:px-2.5 ${
                active
                  ? "bg-[#0a152d] text-white"
                  : "text-slate-600 hover:bg-slate-50 hover:text-[#0a1b33]"
              }`}
            >
              {Icon && (
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                    active
                      ? "bg-white/10 text-white"
                      : "bg-slate-100 text-slate-500 group-hover:bg-white"
                  }`}
                >
                  <Icon size={15} />
                </span>
              )}
                <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {item.label}
                </span>
                {item.value && (
                  <span
                    className={`block truncate text-[11px] font-medium ${
                      active ? "text-white/65" : "text-slate-400"
                    }`}
                  >
                    {item.value}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
