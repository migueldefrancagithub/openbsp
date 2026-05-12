"use client";

import { useQuery } from "convex/react";
import { ArrowRight, MessageSquare, Send, Shield, Activity } from "lucide-react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";

export default function AppOverview() {
  const tenant = useQuery(api.tenantsQueries.getActive);

  if (!tenant) return null;

  return (
    <div className="px-8 py-10 max-w-6xl">
      <div className="mb-10">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-2">
          Overview
        </div>
        <h1 className="font-[var(--font-outfit)] text-[28px] font-medium tracking-tight text-[#0a1b33]">
          Welcome back to {tenant.name}
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Your workspace is live. Connect a WhatsApp number to start the work.
        </p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        {[
          { label: "Conversations", value: "0", icon: MessageSquare },
          { label: "Messages today", value: "0", icon: Send },
          { label: "Quality rating", value: "—", icon: Shield },
          { label: "Active agents", value: "1", icon: Activity },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="bg-white rounded-xl border border-slate-200 px-4 py-3.5"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                {label}
              </span>
              <Icon size={14} className="text-slate-300" />
            </div>
            <div className="font-[var(--font-outfit)] text-2xl font-medium text-[#0a1b33]">
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Getting started */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="font-semibold text-[#0a1b33] text-[15px]">
              Get to first message
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {tenant.healthcareMode
                ? "Healthcare mode is active. DPA + DPIA required before connecting WhatsApp."
                : "5 quick steps to send your first WhatsApp message."}
            </div>
          </div>
          <span className="text-xs text-slate-400">0 of 5 done</span>
        </div>

        <ul>
          {[
            {
              n: 1,
              title: "Connect WhatsApp Business Account",
              note: "Sandbox or production. We validate scopes via Graph API.",
              href: "/app/settings",
            },
            {
              n: 2,
              title: "Submit appointment_reminder template",
              note: "Pre-built utility template for clinic reminders 24h before.",
              href: "/app/templates",
            },
            {
              n: 3,
              title: "Import contacts with consent proof",
              note: "CSV with one consent row per contact for marketing.",
              href: "/app/contacts",
            },
            {
              n: 4,
              title: "Invite your team",
              note: "Add agents and a marketing role.",
              href: "/app/settings",
            },
            {
              n: 5,
              title: "Send first reminder",
              note: "End-to-end test in Inbox.",
              href: "/app/inbox",
            },
          ].map((step) => (
            <li
              key={step.n}
              className="border-b border-slate-100 last:border-b-0"
            >
              <Link
                href={step.href}
                className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors group"
              >
                <span className="w-6 h-6 rounded-full border border-slate-200 flex items-center justify-center text-[11px] text-slate-500 font-medium flex-shrink-0">
                  {step.n}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-[#0a1b33]">
                    {step.title}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {step.note}
                  </div>
                </div>
                <ArrowRight
                  size={16}
                  className="text-slate-300 group-hover:text-[#0a1b33] group-hover:translate-x-0.5 transition-all"
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
