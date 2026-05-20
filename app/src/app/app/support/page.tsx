"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  FileQuestion,
  LifeBuoy,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { BRAND_NAME } from "@/components/Brand";

const CLIENT_CHECKLIST = [
  "Business Manager ID and admin access are available.",
  "Legal name, public website, privacy policy, and terms are aligned.",
  "Billing card is active and allowed for Meta charges.",
  "The client understands WhatsApp Business App coexistence before onboarding.",
  "A support contact is ready for Business verification or restriction appeals.",
];

const GUIDES = [
  {
    icon: CheckCircle2,
    title: "Connection guide",
    body: "Use the readiness checklist before touching tokens: Business Manager, verification, billing, app scopes, webhook, and number ownership.",
    bullets: [
      "Confirm the number is not already attached to another provider.",
      "Prefer Embedded Signup when available; manual token setup is fallback only.",
      "After connection, send a small utility test before any campaign.",
    ],
  },
  {
    icon: FileQuestion,
    title: "What to ask the client",
    body: "Collect operational facts before launch so support does not start after the first Meta error.",
    bullets: [
      "What messages will be sent and to which opted-in audience?",
      "Which team still uses the WhatsApp Business App daily?",
      "Who approves templates, billing changes, and quality incidents?",
    ],
  },
  {
    icon: CreditCard,
    title: "Billing/card troubleshooting",
    body: "Billing failures are not retry-safe. Fix account payment health before resuming campaigns.",
    bullets: [
      "Check Business Manager payment method and account spending limits.",
      "Confirm there are no unpaid invoices or disabled ad account dependencies.",
      "Relaunch only after Meta accepts a small test send.",
    ],
  },
  {
    icon: ShieldAlert,
    title: "Blocked/restricted number",
    body: "Policy and restriction failures should pause sending immediately and move to evidence gathering.",
    bullets: [
      "Export failed contacts and failure categories from the campaign card.",
      "Collect template names, message examples, WABA ID, phone number ID, and timestamps.",
      "Prepare a fallback number only after consent and coexistence impact are reviewed.",
    ],
  },
  {
    icon: AlertTriangle,
    title: "Quality and pacing incident",
    body: `When quality or pacing errors appear, ${BRAND_NAME} opens a circuit breaker and pauses linked campaigns.`,
    bullets: [
      "Stop marketing sends until the breaker expires and quality is stable.",
      "Reduce frequency, narrow segments, and avoid repeated generic offers.",
      "Restart with a smaller cohort and watch failure drilldown.",
    ],
  },
  {
    icon: AlertTriangle,
    title: "Coexistence limitations",
    body: "Coexistence keeps the Business App and Cloud API together, but operators still need clear expectations.",
    bullets: [
      "Choose coexistence during onboarding; migrating first can remove Business App access.",
      "Some Business App actions such as edit/revoke may not behave like normal synced API events.",
      "Treat historical media and old app history as best-effort; verify critical records after onboarding.",
    ],
  },
  {
    icon: CreditCard,
    title: "Pricing and FEP window",
    body: "Click-to-WhatsApp ads are strongest when the team replies fast enough to open and use the free-entry period.",
    bullets: [
      "Prioritize CTWA leads before the first 24 hours pass.",
      "Track the 72-hour free-entry expiry and move hot leads to human follow-up.",
      "Do not confuse free-entry messaging with permission to spam; consent and quality still matter.",
    ],
  },
];

export default function SupportPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Support center"
        description="Coexistence launch notes, client intake, billing recovery, restriction handling, and quality incident playbooks."
      />

      <div className="max-w-7xl space-y-6 px-8 py-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0a152d] text-white">
              <LifeBuoy size={18} />
            </div>
            <div>
              <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                Before onboarding a client
              </h2>
              <p className="text-sm text-slate-500">
                This is the minimum evidence pack before campaigns or AI handoff.
              </p>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {CLIENT_CHECKLIST.map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[13px] text-slate-600"
              >
                <CheckCircle2
                  size={15}
                  className="mt-0.5 shrink-0 text-emerald-600"
                />
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {GUIDES.map((guide) => (
            <GuideCard key={guide.title} {...guide} />
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
            Fast links
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <SupportLink href="/app/settings">Connection settings</SupportLink>
            <SupportLink href="/app/campaigns">Campaign failures</SupportLink>
            <SupportLink href="/app/leads">CTWA leads</SupportLink>
            <SupportLink href="/privacy">Privacy policy</SupportLink>
            <SupportLink href="/terms">Terms</SupportLink>
          </div>
        </section>
      </div>
    </>
  );
}

function GuideCard({
  icon: Icon,
  title,
  body,
  bullets,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  bullets: string[];
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#0a1b33]">
          <Icon size={17} />
        </div>
        <div>
          <h3 className="font-[var(--font-outfit)] text-[16px] font-medium text-[#0a1b33]">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">{body}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2 text-[13px] text-slate-600">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
            {bullet}
          </li>
        ))}
      </ul>
    </article>
  );
}

function SupportLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-[#0a1b33] transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}
