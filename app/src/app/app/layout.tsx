"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  ScrollText,
  CalendarDays,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  FileText,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MousePointerClick,
  Network,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PresenceHeartbeat } from "@/components/app/PresenceHeartbeat";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { CommandPalette, KbdHint } from "@/components/CommandPalette";
import { BRAND_NAME, BrandMark } from "@/components/Brand";
import {
  I18nProvider,
  LanguageSwitcher,
  useI18n,
  type TranslationKey,
} from "@/lib/i18n";
import type { Id } from "../../../convex/_generated/dataModel";
import { roleLabel, verticalLabel } from "@/lib/operationalLabels";

type NavItem = {
  href: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  exact?: boolean;
  badge?: number;
};

type ActiveWorkspace = {
  tenantId: Id<"tenants">;
  memberId?: Id<"members">;
  name: string;
  vertical: string;
  role: string;
  locale?: "pt" | "en";
};

type WorkspaceMembership = ActiveWorkspace & {
  plan: string;
  active: boolean;
};

const PRIMARY_NAV: NavItem[] = [
  { href: "/app/channel-inbox", labelKey: "nav.inbox", icon: Inbox },
  { href: "/app/leads", labelKey: "nav.leads", icon: MousePointerClick },
  { href: "/app/agenda", labelKey: "nav.agenda", icon: CalendarDays },
  { href: "/app/campaigns", labelKey: "nav.campaigns", icon: Send },
  { href: "/app/chatbots", labelKey: "nav.agents", icon: Workflow },
  { href: "/app", labelKey: "nav.operation", icon: LayoutDashboard, exact: true },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/app/admin", labelKey: "nav.adminHome", icon: SlidersHorizontal, exact: true },
  { href: "/app/admin/members", labelKey: "nav.members", icon: Users },
  { href: "/app/admin/logs", labelKey: "nav.logs", icon: ScrollText },
  { href: "/app/contacts", labelKey: "nav.contacts", icon: Users },
  { href: "/app/analytics", labelKey: "nav.analytics", icon: BarChart3 },
  { href: "/app/channels", labelKey: "nav.channels", icon: Network },
  { href: "/app/templates", labelKey: "nav.templates", icon: FileText },
  { href: "/app/quick-replies", labelKey: "nav.quickReplies", icon: Zap },
  { href: "/app/support", labelKey: "nav.support", icon: LifeBuoy },
  { href: "/app/settings", labelKey: "nav.settings", icon: Settings },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const tenant = useQuery(api.tenantsQueries.getActiveOptional);
  const tenants = useQuery(api.tenantsQueries.listMine, {});
  const setLocale = useMutation(api.members.setLocale);
  const router = useRouter();

  useEffect(() => {
    if (tenant === null) router.replace("/onboarding");
  }, [tenant, router]);

  if (tenant === undefined || tenant === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f9fafb]">
        <div className="text-sm text-slate-400">A carregar espaço de trabalho...</div>
      </div>
    );
  }

  return (
    <I18nProvider
      storageScope={tenant.tenantId}
      initialLocale={tenant.locale ?? null}
      onLocaleChange={(locale) => void setLocale({ locale }).catch(() => undefined)}
    >
      <PresenceHeartbeat />
      <AppShell tenant={tenant} tenants={tenants}>{children}</AppShell>
    </I18nProvider>
  );
}

function AppShell({
  children,
  tenant,
  tenants,
}: {
  children: ReactNode;
  tenant: ActiveWorkspace;
  tenants: WorkspaceMembership[] | undefined;
}) {
  const switchActive = useMutation(api.tenants.switchActive);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const pathname = usePathname();
  const { locale, t } = useI18n();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [switchingTenant, setSwitchingTenant] = useState<string | null>(null);
  const isFlowBuilderRoute = pathname.startsWith("/app/chatbots");
  const isInboxRoute = pathname.startsWith("/app/channel-inbox");

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
    <div
      className={cn(
        "min-h-screen flex flex-col lg:h-dvh lg:min-h-0 lg:flex-row lg:overflow-hidden",
        isFlowBuilderRoute ? "bg-[#eef6ef]" : "bg-[#f9fafb]",
      )}
    >
      <aside
        className={cn(
          "w-full shrink-0 border-b border-slate-200 bg-white flex-col lg:sticky top-0 lg:h-dvh lg:border-b-0 lg:border-r",
          "flex lg:w-[72px] z-30",
        )}
      >
        <div className="relative border-b border-slate-200 p-3 lg:px-2">
          <button
            type="button"
            onClick={() => setWorkspaceOpen((open) => !open)}
            aria-expanded={workspaceOpen}
            className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-100 lg:justify-center lg:px-0"
            title={tenant.name}
          >
            <BrandMark className="h-8 w-8" />
            <div className="min-w-0 flex-1 text-left lg:hidden">
              <div className="text-[13px] font-semibold text-[#0a1b33] truncate">
                {BRAND_NAME}
              </div>
              <div className="text-[10px] text-slate-400 truncate uppercase tracking-wider">
                {tenant.name} · {roleLabel(tenant.role, locale)}
              </div>
            </div>
            <ChevronDown
              size={14}
              className={cn(
                "text-slate-400 transition-all group-hover:text-slate-600",
                workspaceOpen && "rotate-180",
                "lg:hidden",
              )}
            />
          </button>

          <LanguageSwitcher className="mt-2 w-full justify-center lg:hidden" />
          <LanguageSwitcher compact className="mx-auto mt-2 hidden lg:flex" />

          {workspaceOpen && (
            <div className="absolute left-3 right-3 top-[104px] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_70px_-38px_rgba(15,23,42,0.55)] lg:left-[62px] lg:right-auto lg:top-2 lg:w-72">
              <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {t("shell.companies")}
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {tenants === undefined ? (
                  <div className="px-3 py-3 text-[12px] text-slate-400">
                    {t("shell.loading")}
                  </div>
                ) : tenants.length === 0 ? (
                  <div className="px-3 py-3 text-[12px] text-slate-500">
                    {t("shell.noCompanies")}
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
                          {verticalLabel(workspace.vertical, locale)} · {roleLabel(workspace.role, locale)}
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
                {t("shell.newCompany")}
              </Link>
            </div>
          )}
        </div>

        <div className="hidden border-b border-slate-200 px-3 py-2 sm:block lg:px-2">
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true }),
              );
            }}
            className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left transition-colors hover:bg-slate-100 lg:h-10 lg:justify-center lg:px-0"
            title={t("shell.quickSwitch")}
          >
            <Search size={15} className="hidden text-slate-500 lg:block" />
            <span className="flex-1 text-[11px] text-slate-400 lg:hidden">
              {t("shell.quickSwitch")}
            </span>
            <span className="lg:hidden"><KbdHint keys={["⌘", "K"]} /></span>
          </button>
        </div>

        <nav className="grid grid-cols-5 gap-1 p-2 lg:flex lg:flex-1 lg:flex-col lg:items-center lg:space-y-0.5">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href, item.exact)} />
          ))}

          <div className="relative hidden pt-2 lg:block">
            <button
              type="button"
              onClick={() => setAdminOpen((open) => !open)}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0a1b33]"
              aria-expanded={adminOpen}
              title={t("nav.admin")}
            >
              <SlidersHorizontal size={18} />
            </button>
            {adminOpen && (
              <div className="absolute left-[54px] top-2 z-50 w-56 space-y-0.5 rounded-lg border border-slate-200 bg-white p-2 shadow-[0_22px_60px_-34px_rgba(15,23,42,0.55)]">
                <div className="px-3 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {t("nav.admin")}
                </div>
                {ADMIN_NAV.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isActive(item.href, item.exact)}
                    nested
                  />
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="hidden space-y-0.5 border-t border-slate-200 p-2 lg:block">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex h-11 w-full items-center justify-center rounded-lg text-[13px] text-slate-500 transition-all hover:bg-slate-100 hover:text-[#0a1b33]"
            title={t("nav.signOut")}
          >
            <LogOut size={16} strokeWidth={2} />
          </button>
        </div>
      </aside>

      <main className={cn("min-h-0 min-w-0 flex-1", isInboxRoute ? "lg:overflow-hidden" : "lg:overflow-y-auto")}>{children}</main>

      <CommandPalette />
    </div>
  );
}

function NavLink({
  item,
  active,
  nested = false,
}: {
  item: NavItem;
  active: boolean;
  nested?: boolean;
}) {
  const { t } = useI18n();
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={t(item.labelKey)}
      className={cn(
        "flex min-w-0 items-center rounded-lg transition-all",
        nested
          ? "gap-2.5 px-3 py-2 text-[13px] lg:h-9 lg:w-full lg:justify-start"
          : "flex-col justify-center gap-1 px-1 py-2 text-[10px] sm:text-[11px] lg:h-11 lg:w-11 lg:flex-row lg:px-0",
        active
          ? "bg-[#0a152d] text-white font-medium"
          : "text-slate-600 hover:bg-slate-100 hover:text-[#0a1b33]",
      )}
    >
      <Icon size={nested ? 15 : 17} strokeWidth={active ? 2.5 : 2} />
      <span className={cn("min-w-0", nested ? "flex-1" : "w-full truncate text-center lg:sr-only")}>{t(item.labelKey)}</span>
      {typeof item.badge === "number" && item.badge > 0 && (
        <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-semibold">
          {item.badge}
        </span>
      )}
    </Link>
  );
}
