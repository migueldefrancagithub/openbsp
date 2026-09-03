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
      className={`rounded-lg border border-line bg-surface p-1 ${className}`}
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
                  ? "bg-nav-active text-white"
                  : "text-body hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {Icon && (
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                    active
                      ? "bg-white/10 text-white"
                      : "bg-surface-3 text-muted group-hover:bg-surface"
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
                      active ? "text-white/65" : "text-faint"
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
