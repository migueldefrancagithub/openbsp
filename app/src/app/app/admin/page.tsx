"use client";

import Link from "next/link";
import { useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { ArrowRight, BellRing, FileText, Loader2, Network, ScrollText, Settings, ShieldCheck, Users } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { PageHeader } from "@/components/app/EmptyState";
import { OpsAlertsPanel } from "@/components/operation/OpsAlertsPanel";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

export default function AdminHomePage() {
  const { locale, tr } = useI18n();
  const convex = useConvex();
  const me = useQuery(api.tenantsQueries.getActiveOptional);
  const summary = useQuery(api.ops.summary, {});
  const [verify, setVerify] = useState<{ ok: boolean; checked: number } | { error: string } | "busy" | null>(null);

  const cards = [
    { href: "/app/admin/members", icon: Users, title: tr("Membros e equipas", "Members and teams"), desc: tr("Papéis, equipas, atribuição automática e presença.", "Roles, teams, automatic assignment and presence.") },
    { href: "/app/admin/logs", icon: ScrollText, title: tr("Registos", "Logs"), desc: tr("Eventos do canal, envios, auditoria e follow-ups.", "Channel events, sends, audit trail and follow-ups.") },
    { href: "/app/settings", icon: Settings, title: tr("Definições", "Settings"), desc: tr("Clínica, canais, automação e espaço de trabalho.", "Clinic, channels, automation and workspace.") },
    { href: "/app/channels", icon: Network, title: tr("Canais", "Channels"), desc: tr("Estado do canal WhatsApp e allowlist do piloto.", "WhatsApp channel state and pilot allowlist.") },
    { href: "/app/templates", icon: FileText, title: tr("Templates", "Templates"), desc: tr("Modelos aprovados sincronizados do Hub.", "Approved templates synced from the Hub.") },
  ];

  async function verifyChain() {
    setVerify("busy");
    try {
      const result = await convex.query(api.audit.verifyChain, {});
      setVerify({ ok: result.ok, checked: result.checked });
    } catch (err) {
      setVerify({ error: convexErrorMessage(err, locale) });
    }
  }

  const canAudit = me?.role === "owner" || me?.role === "admin";

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader eyebrow={tr("Administração", "Administration")} title="Admin" description={tr("Área da clínica para equipa, registos e configuração.", "The clinic's area for team, logs and configuration.")} />
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6 xl:px-8">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.href} href={card.href} className="group rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-[#0a1b33]"><Icon size={16} /></span>
                <div className="mt-3 flex items-center gap-1 text-[14px] font-semibold text-[#0a1b33]">{card.title} <ArrowRight size={13} className="text-slate-300 transition-transform group-hover:translate-x-0.5" /></div>
                <p className="mt-0.5 text-[12px] text-slate-500">{card.desc}</p>
              </Link>
            );
          })}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-[#0a1b33]"><BellRing size={16} /></span>
            <div className="mt-3 text-[14px] font-semibold text-[#0a1b33]">{tr("Alertas abertos", "Open alerts")}</div>
            <p className="mt-0.5 text-[12px] text-slate-500">{summary ? tr(`${summary.open} abertos · ${summary.critical} críticos`, `${summary.open} open · ${summary.critical} critical`) : "…"}</p>
          </div>
          {canAudit && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-[#0a1b33]"><ShieldCheck size={16} /></span>
              <div className="mt-3 text-[14px] font-semibold text-[#0a1b33]">{tr("Integridade da auditoria", "Audit integrity")}</div>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {verify === null ? tr("Verifica a cadeia de hashes das últimas 200 entradas.", "Verifies the hash chain of the last 200 entries.") : verify === "busy" ? tr("A verificar…", "Verifying…") : "error" in verify ? verify.error : verify.ok ? tr(`Cadeia íntegra (${verify.checked} entradas).`, `Chain intact (${verify.checked} entries).`) : tr("Cadeia quebrada — contacte o suporte.", "Chain broken — contact support.")}
              </p>
              <button type="button" onClick={() => void verifyChain()} disabled={verify === "busy"} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-[12px] font-semibold text-[#0a1b33] disabled:opacity-50">
                {verify === "busy" && <Loader2 size={12} className="animate-spin" />} {tr("Verificar", "Verify")}
              </button>
            </div>
          )}
        </div>
        <OpsAlertsPanel />
      </div>
    </div>
  );
}
