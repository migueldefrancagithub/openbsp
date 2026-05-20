import Link from "next/link";
import { BRAND_NAME } from "@/components/Brand";

export default function PrivacyPage() {
  return (
    <main className="min-h-full bg-[#f9fafb] text-[#0a1b33]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/" className="text-sm text-slate-500 hover:text-[#0a1b33]">
          Back to {BRAND_NAME}
        </Link>
        <h1 className="mt-8 font-[var(--font-outfit)] text-4xl font-medium tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          {BRAND_NAME} processes WhatsApp Business messages, contact records,
          template metadata, campaign delivery events, and audit logs only to
          provide the messaging workspace selected by each tenant.
        </p>
        <section className="mt-10 space-y-5 text-sm leading-6 text-slate-600">
          <p>
            Each tenant remains responsible for collecting and proving lawful
            consent before sending marketing messages. {BRAND_NAME} stores consent
            state and consent events so outbound gates can enforce Meta policy
            and privacy requirements.
          </p>
          <p>
            Access tokens and API keys must be treated as secrets. Production
            deployments should store them encrypted, restrict access by role,
            and rotate them when a team member or integration no longer needs
            access.
          </p>
          <p>
            This project is still under active development. Before using it
            with real customers, review local privacy laws, Meta WhatsApp
            Business Platform terms, retention periods, and data processing
            agreements with counsel.
          </p>
        </section>
      </div>
    </main>
  );
}
