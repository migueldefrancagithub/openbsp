"use client";

import { useQuery } from "convex/react";
import { Smartphone, Shield, ShieldAlert, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { ConnectWabaForm } from "@/components/settings/ConnectWabaForm";
import { api } from "../../../../convex/_generated/api";

export default function SettingsPage() {
  const tenant = useQuery(api.tenantsQueries.getActive);
  const wabaAccounts = useQuery(api.whatsappAccounts.listForTenant);
  if (!tenant) return null;

  const hasConnection = (wabaAccounts?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Workspace, WhatsApp connection, members, and compliance documents."
      />

      <div className="px-8 py-8 max-w-4xl space-y-6">
        {/* Workspace card */}
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-[#0a1b33] text-[15px]">
              Workspace
            </h2>
          </div>
          <dl className="divide-y divide-slate-100">
            <Row label="Name" value={tenant.name} />
            <Row label="Vertical" value={tenant.vertical} />
            <div className="px-6 py-3.5 grid grid-cols-3 gap-4 text-sm">
              <dt className="text-slate-500">Healthcare mode</dt>
              <dd className="col-span-2">
                {tenant.healthcareMode ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-xs font-medium">
                    <Shield size={12} /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md text-xs font-medium">
                    Off
                  </span>
                )}
              </dd>
            </div>
            <Row label="Tenant ID" value={tenant.tenantId} mono />
            <Row label="Your role" value={tenant.role} />
          </dl>
        </section>

        {/* WhatsApp connection */}
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-[#0a1b33] text-[15px]">
              WhatsApp Business Account
            </h2>
            {hasConnection ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-xs font-medium">
                <CheckCircle2 size={12} /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md text-xs font-medium">
                Not connected
              </span>
            )}
          </div>

          <div className="px-6 py-6">
            {hasConnection ? (
              <div className="space-y-4">
                {wabaAccounts!.map((acc) => (
                  <div
                    key={acc._id}
                    className="border border-slate-200 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                          <Smartphone size={16} className="text-emerald-600" />
                        </div>
                        <div>
                          <div className="font-medium text-[#0a1b33] text-sm">
                            WABA {acc.wabaId}
                          </div>
                          <div className="text-xs text-slate-500">
                            Status: {acc.status} · Token: {acc.tokenStatus}
                            {acc.qualityRating && ` · Quality: ${acc.qualityRating}`}
                          </div>
                        </div>
                      </div>
                    </div>
                    {acc.phoneNumbers.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {acc.phoneNumbers.map((p) => (
                          <li
                            key={p._id}
                            className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-xs"
                          >
                            <div>
                              <span className="font-medium text-[#0a1b33]">
                                {p.displayName}
                              </span>
                              <span className="text-slate-500 ml-2">{p.e164}</span>
                            </div>
                            <span className="text-slate-400 font-mono text-[10px]">
                              {p.phoneNumberId}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                <p className="text-xs text-slate-500">
                  Connect another number using the form below.
                </p>
                <div className="border-t border-slate-100 pt-6">
                  <ConnectWabaForm />
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Smartphone size={18} className="text-slate-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[14px] text-[#0a1b33] font-medium">
                      Connect a WABA system user token
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                      We call Graph API to validate scopes (
                      <code>whatsapp_business_messaging</code>,{" "}
                      <code>whatsapp_business_management</code>,{" "}
                      <code>business_management</code>) and bind the token
                      to your WABA. Tokens are encrypted at rest with AES-256
                      envelope encryption.
                    </p>
                  </div>
                </div>
                <ConnectWabaForm />
              </div>
            )}
          </div>
        </section>

        {/* Compliance */}
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-[#0a1b33] text-[15px]">
              Compliance documents
            </h2>
          </div>
          <ul className="divide-y divide-slate-100">
            <li className="px-6 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldAlert size={16} className="text-slate-400" />
                <div>
                  <div className="text-[14px] text-[#0a1b33] font-medium">
                    DPA (Data Processing Agreement)
                  </div>
                  <div className="text-xs text-slate-500">
                    Required to connect WhatsApp
                    {tenant.healthcareMode ? " (healthcare)" : ""}
                  </div>
                </div>
              </div>
              <span className="text-xs text-slate-400">Not signed</span>
            </li>
            <li className="px-6 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldAlert size={16} className="text-slate-400" />
                <div>
                  <div className="text-[14px] text-[#0a1b33] font-medium">
                    DPIA (Data Protection Impact Assessment)
                  </div>
                  <div className="text-xs text-slate-500">
                    {tenant.healthcareMode
                      ? "Required for healthcare workspaces"
                      : "Optional"}
                  </div>
                </div>
              </div>
              <span className="text-xs text-slate-400">Not completed</span>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="px-6 py-3.5 grid grid-cols-3 gap-4 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={
          mono
            ? "col-span-2 text-slate-500 font-mono text-xs"
            : "col-span-2 text-[#0a1b33] font-medium capitalize"
        }
      >
        {value}
      </dd>
    </div>
  );
}
