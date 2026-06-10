import Link from "next/link";
import { BRAND_NAME } from "@/components/Brand";

export default function TermsPage() {
  return (
    <main className="min-h-full bg-[#f9fafb] text-[#0a1b33]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link
          href="/"
          className="inline-flex min-h-10 items-center text-sm text-slate-500 hover:text-[#0a1b33]"
        >
          Back to {BRAND_NAME}
        </Link>
        <h1 className="mt-8 font-[var(--font-outfit)] text-4xl font-medium tracking-tight">
          Terms of Use
        </h1>
        <section className="mt-8 space-y-5 text-sm leading-6 text-slate-600">
          <p>
            {BRAND_NAME} is a WhatsApp Business Platform workspace for official API
            messaging, inbox workflows, templates, contact management, campaign
            reporting, and audit trails.
          </p>
          <p>
            Tenants are responsible for using approved message templates,
            respecting opt-in requirements, handling opt-outs, and complying
            with Meta policies. {BRAND_NAME} may block or pause outbound messaging
            when quality, consent, or delivery signals indicate risk.
          </p>
          <p>
            Do not use {BRAND_NAME} for prohibited content, spam, misleading
            campaigns, or attempts to bypass WhatsApp user protections. Real
            deployments should replace this draft with reviewed legal terms
            before onboarding customers.
          </p>
        </section>
      </div>
    </main>
  );
}
