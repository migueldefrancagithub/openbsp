"use client";

import { useQuery } from "convex/react";
import { Smartphone, Shield, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";

export default function SettingsPage() {
  const tenant = useQuery(api.tenantsQueries.getActive);
  if (!tenant) return null;

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
            <div className="px-6 py-3.5 grid grid-cols-3 gap-4 text-sm">
              <dt className="text-slate-500">Name</dt>
              <dd className="col-span-2 text-[#0a1b33] font-medium">
                {tenant.name}
              </dd>
            </div>
            <div className="px-6 py-3.5 grid grid-cols-3 gap-4 text-sm">
              <dt className="text-slate-500">Vertical</dt>
              <dd className="col-span-2 text-[#0a1b33]">{tenant.vertical}</dd>
            </div>
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
            <div className="px-6 py-3.5 grid grid-cols-3 gap-4 text-sm">
              <dt className="text-slate-500">Tenant ID</dt>
              <dd className="col-span-2 text-slate-500 font-mono text-xs">
                {tenant.tenantId}
              </dd>
            </div>
            <div className="px-6 py-3.5 grid grid-cols-3 gap-4 text-sm">
              <dt className="text-slate-500">Your role</dt>
              <dd className="col-span-2 text-[#0a1b33] capitalize">
                {tenant.role}
              </dd>
            </div>
          </dl>
        </section>

        {/* WhatsApp connection */}
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-[#0a1b33] text-[15px]">
              WhatsApp Business Account
            </h2>
            <span className="inline-flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md text-xs font-medium">
              Not connected
            </span>
          </div>
          <div className="px-6 py-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Smartphone size={18} className="text-slate-400" />
              </div>
              <div className="flex-1">
                <p className="text-[14px] text-[#0a1b33] font-medium">
                  Paste your Meta system user token to validate
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  We call Graph API to validate scopes
                  (whatsapp_business_messaging,
                  whatsapp_business_management, business_management) and bind to
                  your WABA. Tokens are encrypted at rest with envelope
                  encryption.
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-4 inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Connect WhatsApp (coming next)
                </button>
              </div>
            </div>
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
