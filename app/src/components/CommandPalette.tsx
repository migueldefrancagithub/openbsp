"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  Inbox,
  Users,
  Send,
  FileText,
  Settings,
  LayoutDashboard,
  BarChart3,
  MessageSquare,
  Search,
  ArrowRight,
  MousePointerClick,
  LifeBuoy,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { friendlyId } from "@/lib/friendlyId";

type Item = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  group: "Navigate" | "Conversations" | "Settings";
};

const NAV_ITEMS: Item[] = [
  { id: "nav-overview", label: "Overview", href: "/app", icon: LayoutDashboard, group: "Navigate" },
  { id: "nav-inbox", label: "Inbox", href: "/app/inbox", icon: Inbox, group: "Navigate" },
  { id: "nav-contacts", label: "Contacts", href: "/app/contacts", icon: Users, group: "Navigate" },
  { id: "nav-leads", label: "Ad leads", href: "/app/leads", icon: MousePointerClick, group: "Navigate" },
  { id: "nav-campaigns", label: "Campaigns", href: "/app/campaigns", icon: Send, group: "Navigate" },
  { id: "nav-analytics", label: "Analytics", href: "/app/analytics", icon: BarChart3, group: "Navigate" },
  { id: "nav-templates", label: "Templates", href: "/app/templates", icon: FileText, group: "Navigate" },
  { id: "nav-support", label: "Support", href: "/app/support", icon: LifeBuoy, group: "Navigate" },
];

const SETTINGS_ITEMS: Item[] = [
  { id: "set-workspace", label: "Workspace settings", href: "/app/settings", icon: Settings, group: "Settings" },
  { id: "set-waba", label: "Connect WhatsApp Business Account", href: "/app/settings", icon: Settings, group: "Settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const router = useRouter();
  const conversations = useQuery(
    api.conversations.listOpen,
    open ? { limit: 30 } : "skip",
  );

  // Cmd+K / Ctrl+K toggle
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setActiveIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const items = useMemo<Item[]>(() => {
    const convItems: Item[] = (conversations ?? []).map((c) => ({
      id: c._id,
      label: c.contactName ?? c.contactE164,
      hint: friendlyId("CONV", c._id) + " · " + c.contactE164,
      href: `/app/inbox/${c._id}`,
      icon: MessageSquare,
      group: "Conversations" as const,
    }));
    return [...NAV_ITEMS, ...convItems, ...SETTINGS_ITEMS];
  }, [conversations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.hint && i.hint.toLowerCase().includes(q)),
    );
  }, [items, query]);

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIdx(0);
  }, [query, conversations]);

  function navigate(item: Item) {
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (item) navigate(item);
    }
  }

  if (!open) return null;

  // Group filtered items
  const grouped: Record<string, Item[]> = {};
  filtered.forEach((it) => {
    grouped[it.group] = grouped[it.group] ?? [];
    grouped[it.group].push(it);
  });
  const groupOrder: Item["group"][] = ["Navigate", "Conversations", "Settings"];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
    >
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm"
        aria-hidden
      />
      <div
        className="relative w-full max-w-xl bg-white rounded-2xl border border-slate-200 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.25)] overflow-hidden cmd-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Search size={16} className="text-slate-400" strokeWidth={2} />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to a conversation, page, or setting…"
            className="flex-1 bg-transparent outline-none text-[14px] text-[#0a1b33] placeholder:text-slate-400"
          />
          <KbdHint keys={["esc"]} />
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              No matches.
            </div>
          ) : (
            groupOrder.map((g) =>
              grouped[g] ? (
                <div key={g} className="px-2 pb-1">
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {g}
                  </div>
                  <ul>
                    {grouped[g].map((item) => {
                      const flatIdx = filtered.indexOf(item);
                      const isActive = flatIdx === activeIdx;
                      const Icon = item.icon;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onMouseEnter={() => setActiveIdx(flatIdx)}
                            onClick={() => navigate(item)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-100",
                              isActive
                                ? "bg-slate-100 text-[#0a1b33]"
                                : "text-slate-700 hover:bg-slate-50",
                            )}
                          >
                            <Icon
                              size={14}
                              strokeWidth={1.5}
                              className="text-slate-400"
                            />
                            <span className="flex-1 text-[13px] font-medium truncate">
                              {item.label}
                            </span>
                            {item.hint && (
                              <span className="text-[10px] text-slate-400 font-mono truncate max-w-[180px]">
                                {item.hint}
                              </span>
                            )}
                            {isActive && (
                              <ArrowRight
                                size={12}
                                className="text-slate-400 flex-shrink-0"
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null,
            )
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <KbdHint keys={["↑"]} />
              <KbdHint keys={["↓"]} />
              navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <KbdHint keys={["⏎"]} />
              open
            </span>
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cmd-enter {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .cmd-enter { animation: cmd-enter 180ms cubic-bezier(0.22, 1, 0.36, 1); }
        @media (prefers-reduced-motion: reduce) { .cmd-enter { animation: none; } }
      `}</style>
    </div>
  );
}

export function KbdHint({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border border-slate-200 bg-white text-[10px] font-mono text-slate-500 leading-none"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
