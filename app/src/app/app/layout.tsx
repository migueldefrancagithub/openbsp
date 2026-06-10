"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  Building2,
  Check,
  Inbox,
  Users,
  Send,
  FileText,
  Settings,
  ChevronDown,
  BarChart3,
  LogOut,
  LayoutDashboard,
  MousePointerClick,
  Zap,
  LifeBuoy,
  Workflow,
  Network,
  Plus,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { CommandPalette, KbdHint } from "@/components/CommandPalette";
import { BRAND_NAME, BrandMark } from "@/components/Brand";

const NAV = [
  { href: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/app/inbox", label: "Inbox", icon: Inbox, badge: 0 },
  { href: "/app/contacts", label: "Contacts", icon: Users },
  { href: "/app/leads", label: "Ad leads", icon: MousePointerClick },
  { href: "/app/campaigns", label: "Campaigns", icon: Send },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/app/channels", label: "Channels", icon: Network },
  { href: "/app/templates", label: "Templates", icon: FileText },
  { href: "/app/chatbots", label: "Flow builder", icon: Workflow },
  { href: "/app/quick-replies", label: "Quick replies", icon: Zap },
  { href: "/app/support", label: "Support", icon: LifeBuoy },
];

const FOOTER_NAV = [{ href: "/app/settings", label: "Settings", icon: Settings }];

export default function AppLayout({ children }: { children: ReactNode }) {
  const tenant = useQuery(api.tenantsQueries.getActiveOptional);
  const tenants = useQuery(api.tenantsQueries.listMine, {});
  const switchActive = useMutation(api.tenants.switchActive);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const pathname = usePathname();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [switchingTenant, setSwitchingTenant] = useState<string | null>(null);

  useEffect(() => {
    if (tenant === null) router.replace("/onboarding");
  }, [tenant, router]);

  if (tenant === undefined || tenant === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading workspace…</div>
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    router.push("/");
  }

  async function handleSwitchTenant(tenantId: string, active: boolean) {
    if (active) {
      setWorkspaceOpen(false);
      return;
    }
    setSwitchingTenant(tenantId);
    try {
      await switchActive({ tenantId: tenantId as never });
      setWorkspaceOpen(false);
      router.refresh();
    } finally {
      setSwitchingTenant(null);
    }
  }

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="min-h-screen bg-[#f9fafb] flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white flex flex-col lg:sticky top-0 lg:h-screen z-30">
        {/* Workspace switcher */}
        <div className="relative p-3 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setWorkspaceOpen((open) => !open)}
            aria-expanded={workspaceOpen}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-100 transition-colors group"
          >
            <BrandMark className="h-7 w-7" />
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[13px] font-semibold text-[#0a1b33] truncate">
                {BRAND_NAME}
              </div>
              <div className="text-[10px] text-slate-400 truncate uppercase tracking-wider">
                {tenant.name} · {tenant.role}
              </div>
            </div>
            <ChevronDown
              size={14}
              className={`text-slate-400 transition-all group-hover:text-slate-600 ${
                workspaceOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {workspaceOpen && (
            <div className="absolute left-3 right-3 top-[64px] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_70px_-38px_rgba(15,23,42,0.55)]">
              <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Companies
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {tenants === undefined ? (
                  <div className="px-3 py-3 text-[12px] text-slate-400">
                    Loading…
                  </div>
                ) : tenants.length === 0 ? (
                  <div className="px-3 py-3 text-[12px] text-slate-500">
                    No companies yet.
                  </div>
                ) : (
                  tenants.map((workspace) => (
                    <button
                      key={workspace.tenantId}
                      type="button"
                      onClick={() =>
                        handleSwitchTenant(workspace.tenantId, workspace.active)
                      }
                      disabled={switchingTenant !== null}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-50 disabled:opacity-60"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        <Building2 size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[#0a1b33]">
                          {workspace.name}
                        </span>
                        <span className="block truncate text-[10px] uppercase tracking-wider text-slate-400">
                          {workspace.vertical} · {workspace.role}
                        </span>
                      </span>
                      {workspace.active ? (
                        <Check size={15} className="text-emerald-600" />
                      ) : switchingTenant === workspace.tenantId ? (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-[#0a152d]" />
                      ) : null}
                    </button>
                  ))
                )}
              </div>
              <Link
                href="/onboarding"
                onClick={() => setWorkspaceOpen(false)}
                className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-[12px] font-semibold text-[#0f766e] hover:bg-slate-50"
              >
                <Plus size={14} />
                New company
              </Link>
            </div>
          )}
        </div>

        {/* Search hint */}
        <div className="hidden sm:block px-3 py-2 border-b border-slate-200">
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true }),
              );
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
          >
            <span className="text-[11px] text-slate-400 flex-1">
              Quick switch…
            </span>
            <KbdHint keys={["⌘", "K"]} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex gap-1 overflow-x-auto p-2 lg:block lg:flex-1 lg:space-y-0.5 lg:overflow-y-auto lg:overflow-x-visible">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all",
                  active
                    ? "bg-[#0a152d] text-white font-medium"
                    : "text-slate-600 hover:bg-slate-100 hover:text-[#0a1b33]",
                )}
              >
                <Icon size={16} strokeWidth={active ? 2.5 : 2} />
                <span className="flex-1">{item.label}</span>
                {typeof item.badge === "number" && item.badge > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-semibold">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer nav */}
        <div className="hidden lg:block p-2 border-t border-slate-200 space-y-0.5">
          {FOOTER_NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all",
                  active
                    ? "bg-[#0a152d] text-white font-medium"
                    : "text-slate-600 hover:bg-slate-100 hover:text-[#0a1b33]",
                )}
              >
                <Icon size={16} strokeWidth={active ? 2.5 : 2} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-slate-500 hover:bg-slate-100 hover:text-[#0a1b33] transition-all"
          >
            <LogOut size={16} strokeWidth={2} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">{children}</main>

      <CommandPalette />
    </div>
  );
}
