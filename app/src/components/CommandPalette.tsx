"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  FileText,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Moon,
  MousePointerClick,
  Search,
  ShieldAlert,
  Sparkles,
  Send,
  Settings,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { friendlyId } from "@/lib/friendlyId";
import { useI18n, type TranslationKey } from "@/lib/i18n";

type Item = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: LucideIcon;
  group: "Actions" | "Navigate" | "Conversations" | "Settings";
  /** Runs instead of navigating — used by the action group. */
  run?: () => void | Promise<void>;
};

type StaticItem = Omit<Item, "label"> & {
  labelKey: TranslationKey;
};

const NAV_ITEMS: StaticItem[] = [
  {
    id: "nav-inbox",
    labelKey: "nav.inbox",
    href: "/app/channel-inbox",
    icon: Inbox,
    group: "Navigate",
  },
  {
    id: "nav-leads",
    labelKey: "nav.leads",
    href: "/app/leads",
    icon: MousePointerClick,
    group: "Navigate",
  },
  {
    id: "nav-campaigns",
    labelKey: "nav.campaigns",
    href: "/app/campaigns",
    icon: Send,
    group: "Navigate",
  },
  {
    id: "nav-agents",
    labelKey: "nav.agents",
    href: "/app/chatbots",
    icon: Workflow,
    group: "Navigate",
  },
  {
    id: "nav-operation",
    labelKey: "nav.operation",
    href: "/app",
    icon: LayoutDashboard,
    group: "Navigate",
  },
  {
    id: "nav-contacts",
    labelKey: "nav.contacts",
    href: "/app/contacts",
    icon: Users,
    group: "Navigate",
  },
  {
    id: "nav-analytics",
    labelKey: "nav.analytics",
    href: "/app/analytics",
    icon: BarChart3,
    group: "Navigate",
  },
  {
    id: "nav-templates",
    labelKey: "nav.templates",
    href: "/app/templates",
    icon: FileText,
    group: "Navigate",
  },
  {
    id: "nav-quick-replies",
    labelKey: "nav.quickReplies",
    href: "/app/quick-replies",
    icon: Zap,
    group: "Navigate",
  },
  {
    id: "nav-support",
    labelKey: "nav.support",
    href: "/app/support",
    icon: LifeBuoy,
    group: "Navigate",
  },
];

const SETTINGS_ITEMS: StaticItem[] = [
  {
    id: "set-workspace",
    labelKey: "shell.workspaceSettings",
    href: "/app/settings",
    icon: Settings,
    group: "Settings",
  },
  {
    id: "set-waba",
    labelKey: "shell.connectWhatsapp",
    href: "/app/settings",
    icon: Settings,
    group: "Settings",
  },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const router = useRouter();
  const { t } = useI18n();
  const conversations = useQuery(
    api.conversations.listOpen,
    open ? { limit: 30 } : "skip",
  );

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
    const navItems = NAV_ITEMS.map((item) => ({
      ...item,
      label: t(item.labelKey),
    }));
    const settingsItems = SETTINGS_ITEMS.map((item) => ({
      ...item,
      label: t(item.labelKey),
    }));
    const convItems: Item[] = (conversations ?? []).map((c) => ({
      id: c._id,
      label: c.contactName ?? c.contactE164,
      hint: friendlyId("CONV", c._id) + " · " + c.contactE164,
      href: "/app/channel-inbox",
      icon: MessageSquare,
      group: "Conversations" as const,
    }));
    const actionItems: Item[] = [
      {
        id: "action-suggestions",
        label: t("palette.openSuggestions"),
        hint: t("palette.openSuggestionsHint"),
        href: "/app/channel-inbox?filter=ai_suggestions",
        icon: Sparkles,
        group: "Actions" as const,
      },
      {
        id: "action-risk",
        label: t("palette.openRisk"),
        hint: t("palette.openRiskHint"),
        href: "/app/channel-inbox?filter=at_risk",
        icon: ShieldAlert,
        group: "Actions" as const,
      },
      {
        id: "action-queue",
        label: t("palette.openQueue"),
        hint: t("palette.openQueueHint"),
        href: "/app/channel-inbox?filter=waiting",
        icon: Users,
        group: "Actions" as const,
      },
      {
        id: "action-alerts",
        label: t("palette.openAlerts"),
        hint: t("palette.openAlertsHint"),
        href: "/app?tab=alerts",
        icon: Bell,
        group: "Actions" as const,
      },
      {
        id: "action-agents",
        label: t("palette.openAgents"),
        hint: t("palette.openAgentsHint"),
        href: "/app/agents",
        icon: Bot,
        group: "Actions" as const,
      },
      {
        id: "action-theme",
        label: t("palette.toggleTheme"),
        hint: t("palette.toggleThemeHint"),
        href: "#",
        icon: Moon,
        group: "Actions" as const,
        run: () => {
          const root = document.documentElement;
          const isDark =
            root.getAttribute("data-theme") === "dark" ||
            (!root.hasAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
          const next = isDark ? "light" : "dark";
          root.setAttribute("data-theme", next);
          try {
            localStorage.setItem("openbsp-theme", next);
          } catch {
            /* storage blocked: the choice still applies to this session */
          }
        },
      },
    ];
    return [...actionItems, ...navItems, ...convItems, ...settingsItems];
  }, [conversations, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.hint && i.hint.toLowerCase().includes(q)),
    );
  }, [items, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, conversations]);

  function navigate(item: Item) {
    setOpen(false);
    setQuery("");
    if (item.run) {
      void item.run();
      return;
    }
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

  const grouped: Record<string, Item[]> = {};
  filtered.forEach((it) => {
    grouped[it.group] = grouped[it.group] ?? [];
    grouped[it.group].push(it);
  });
  const groupOrder: Item["group"][] = ["Actions", "Navigate", "Conversations", "Settings"];

  const groupLabel: Record<Item["group"], string> = {
    Actions: t("shell.groupActions"),
    Navigate: t("shell.groupNavigate"),
    Conversations: t("shell.groupConversations"),
    Settings: t("shell.groupSettings"),
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[14vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("shell.quickSwitch")}
      onClick={() => setOpen(false)}
    >
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm"
        aria-hidden
      />
      <div
        className="cmd-enter relative w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-[0_24px_60px_-12px_rgba(15,23,42,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
          <Search size={16} className="text-faint" strokeWidth={2} />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("shell.searchPlaceholder")}
            className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
          <KbdHint keys={["esc"]} />
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-faint">
              {t("shell.noMatches")}
            </div>
          ) : (
            groupOrder.map((g) =>
              grouped[g] ? (
                <div key={g} className="px-2 pb-1">
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                    {groupLabel[g]}
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
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-100",
                              isActive
                                ? "bg-surface-3 text-ink"
                                : "text-ink hover:bg-surface-2",
                            )}
                          >
                            <Icon
                              size={14}
                              strokeWidth={1.5}
                              className="text-faint"
                            />
                            <span className="flex-1 truncate text-[13px] font-medium">
                              {item.label}
                            </span>
                            {item.hint && (
                              <span className="max-w-[180px] truncate font-mono text-[10px] text-faint">
                                {item.hint}
                              </span>
                            )}
                            {isActive && (
                              <ArrowRight
                                size={12}
                                className="flex-shrink-0 text-faint"
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

        <div className="flex items-center justify-between border-t border-line-soft bg-slate-50/50 px-4 py-2.5">
          <div className="flex items-center gap-3 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1">
              <KbdHint keys={["↑"]} />
              <KbdHint keys={["↓"]} />
              {t("shell.navigate")}
            </span>
            <span className="inline-flex items-center gap-1">
              <KbdHint keys={["⏎"]} />
              {t("shell.open")}
            </span>
          </div>
          <div className="font-mono text-[10px] text-faint">
            {filtered.length}{" "}
            {filtered.length === 1 ? t("shell.results") : t("shell.resultsPlural")}
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
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-surface px-1 font-mono text-[10px] leading-none text-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
