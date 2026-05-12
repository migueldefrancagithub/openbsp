"use client";

import { ReactNode, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  Inbox,
  Users,
  Send,
  FileText,
  Settings,
  ChevronDown,
  LogOut,
  LayoutDashboard,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/app/inbox", label: "Inbox", icon: Inbox, badge: 0 },
  { href: "/app/contacts", label: "Contacts", icon: Users },
  { href: "/app/campaigns", label: "Campaigns", icon: Send },
  { href: "/app/templates", label: "Templates", icon: FileText },
];

const FOOTER_NAV = [{ href: "/app/settings", label: "Settings", icon: Settings }];

export default function AppLayout({ children }: { children: ReactNode }) {
  const tenant = useQuery(api.tenantsQueries.getActiveOptional);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const pathname = usePathname();

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

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="min-h-screen bg-[#f9fafb] flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col sticky top-0 h-screen">
        {/* Workspace switcher */}
        <div className="p-3 border-b border-slate-200">
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-100 transition-colors group"
          >
            <span className="inline-flex w-7 h-7 rounded-md bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2] items-center justify-center text-white text-[11px] font-semibold flex-shrink-0">
              {tenant.name.charAt(0).toUpperCase()}
            </span>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[13px] font-semibold text-[#0a1b33] truncate">
                {tenant.name}
              </div>
              <div className="text-[10px] text-slate-400 truncate uppercase tracking-wider">
                {tenant.vertical} · {tenant.role}
              </div>
            </div>
            <ChevronDown
              size={14}
              className="text-slate-400 group-hover:text-slate-600 transition-colors"
            />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, item.exact);
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
        <div className="p-2 border-t border-slate-200 space-y-0.5">
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
    </div>
  );
}
