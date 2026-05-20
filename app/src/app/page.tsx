import Link from "next/link";
import { CoreFeatures } from "@/components/CoreFeatures";
import { Hero } from "@/components/Hero";
import { LogoMarquee } from "@/components/LogoMarquee";
import { GlowFeatures } from "@/components/GlowFeatures";
import { Activity, ExternalLink, ShieldCheck } from "lucide-react";
import { BRAND_NAME, BrandLogo, BrandMark } from "@/components/Brand";
import "./landing-anims.css";

const footerColumns = [
  {
    title: "Product",
    links: [
      ["Coexistence", "#features"],
      ["Campaigns", "/app/campaigns"],
      ["Inbox", "/app/inbox"],
      ["Templates", "/app/templates"],
      ["Contacts", "/app/contacts"],
    ],
  },
  {
    title: "Solutions",
    links: [
      ["Clinics", "#compliance"],
      ["E-commerce", "#features"],
      ["SaaS", "#features"],
      ["Agencies", "#features"],
      ["CTWA leads", "#features"],
    ],
  },
  {
    title: "Developers",
    links: [
      ["Documentation", "https://developers.facebook.com/docs/whatsapp"],
      ["Meta Cloud API", "https://developers.facebook.com/docs/whatsapp/cloud-api"],
      ["Open source", "https://github.com/migueldefrancagithub/openbsp"],
      ["API status", "#status"],
    ],
  },
  {
    title: "Resources",
    links: [
      ["System map", "#system"],
      ["Security", "#compliance"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "#features"],
      ["Roadmap", "#system"],
      ["GitHub", "https://github.com/migueldefrancagithub/openbsp"],
      ["Legal", "/terms"],
    ],
  },
];

export default function Home() {
  return (
    <div className="min-h-full bg-[#f9fafb] text-slate-900">
      {/* Top global nav (compact, only visible above hero) */}
      <header className="absolute top-0 left-0 right-0 z-40 px-6 py-5">
        <div className="mx-auto max-w-[1400px] flex items-center justify-between">
          <Link
            href="/"
            className="text-[#0a1b33]"
          >
            <BrandLogo markClassName="h-6 w-6" />
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/login"
              className="px-4 py-2 text-slate-600 hover:text-[#0a1b33] transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="btn-primary px-4 py-2 rounded-full bg-[#0a152d] text-white text-[13px] font-medium"
            >
              Start building
            </Link>
          </div>
        </div>
      </header>

      {/* Hero with video background */}
      <div className="px-3 md:px-6 pt-20">
        <Hero />
      </div>

      {/* Marquee logo scroller */}
      <div className="px-3 md:px-6">
        <LogoMarquee />
      </div>

      {/* Core Features section (per original spec — intentionally static) */}
      <div id="features" className="mt-20">
        <CoreFeatures />
      </div>

      {/* Dark glowing feature cards — Clerk-style dramatic break */}
      <GlowFeatures />

      {/* Compliance band — back to light, hover lift */}
      <section
        id="compliance"
        className="border-t border-slate-200 bg-[#f9fafb]"
      >
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid md:grid-cols-2 gap-12 items-start">
            <div>
              <div
                className="text-xs uppercase tracking-[0.18em] mb-4"
                style={{
                  background:
                    "linear-gradient(90deg, #F5C344, #F28482, #B567C2)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  color: "transparent",
                }}
              >
                Compliance by default
              </div>
              <h2 className="font-[var(--font-outfit)] text-[32px] md:text-[40px] font-medium tracking-tight text-[#0a1b33] leading-[1.1]">
                Built so Meta and your DPO sleep at night
              </h2>
              <p className="mt-4 text-slate-600 leading-relaxed text-[15px]">
                Healthcare-mode allowlist, opt-in granular por finalidade,
                webhook idempotency state machine, append-only audit com hash
                chain. Não é uma caixa que ticas — é como cada mutation foi
                desenhada.
              </p>
            </div>
            <ul className="grid grid-cols-2 gap-4 text-sm">
              {[
                ["RGPD", "Export + erase + retention"],
                ["Meta policies", "Healthcare allowlist"],
                ["Idempotency", "At-least-once safe"],
                ["Multi-tenant", "Wrapper-enforced"],
                ["Audit", "Hash-chained, WORM export"],
                ["Quality", "Per-batch circuit breaker"],
              ].map(([title, sub]) => (
                <li
                  key={title}
                  className="compliance-card rounded-2xl bg-white border border-slate-200 p-5 cursor-default"
                >
                  <div className="font-semibold text-[#0a1b33]">{title}</div>
                  <div className="text-slate-500 text-xs mt-1">{sub}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="system" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
                <ShieldCheck size={13} />
                Official Cloud API, not browser automation
              </div>
              <h2 className="mt-5 font-[var(--font-outfit)] text-[34px] md:text-[46px] font-medium tracking-tight text-[#0a1b33] leading-[1.05]">
                The system from the live, built for coexistence.
              </h2>
              <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-slate-600">
                Keep the client&apos;s WhatsApp Business workflow, then add
                official campaigns, contact folders, CTWA attribution, Meta
                failure intelligence, and guarded AI handoff.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Campaign engine", "Lists, recipients, launch, status sync"],
                ["Failure intelligence", "Meta codes grouped by fix"],
                ["Coexistence", "Embedded Signup readiness path"],
                ["Guarded AI", "Ad leads first, human override always"],
              ].map(([title, sub]) => (
                <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="font-semibold text-[#0a1b33]">{title}</div>
                  <div className="mt-1 text-[12px] leading-relaxed text-slate-500">
                    {sub}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="openbsp-footer relative overflow-hidden bg-[#030303] text-white">
        <div className="mx-auto max-w-[1440px] px-6 md:px-10">
          <div className="grid gap-8 border-b border-white/12 py-16 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="font-[var(--font-outfit)] text-[34px] font-medium tracking-tight">
                Stay updated
              </h2>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-400">
                Product updates, Meta policy changes, coexistence notes, and
                campaign deliverability lessons.
              </p>
            </div>
            <form className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <label className="sr-only" htmlFor="footer-email">
                Email
              </label>
              <input
                id="footer-email"
                type="email"
                placeholder="Enter your email"
                className="h-12 min-w-0 flex-1 rounded-md border border-white/12 bg-white/[0.08] px-4 text-[14px] text-white outline-none placeholder:text-zinc-500 focus:border-white/35 sm:max-w-md"
              />
              <button
                type="button"
                className="h-12 rounded-md bg-white px-6 text-[14px] font-semibold text-black transition-colors hover:bg-zinc-200"
              >
                Subscribe
              </button>
            </form>
          </div>

          <div className="grid gap-10 border-b border-white/12 py-20 sm:grid-cols-2 lg:grid-cols-5">
            {footerColumns.map((column) => (
              <div key={column.title}>
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-100">
                  {column.title}
                </h3>
                <ul className="mt-6 space-y-4">
                  {column.links.map(([label, href]) => {
                    const external = href.startsWith("http");
                    const className =
                      "inline-flex items-center gap-1.5 text-[14px] text-zinc-400 transition-colors hover:text-white";
                    return (
                      <li key={`${column.title}-${label}`}>
                        {external ? (
                          <a href={href} className={className}>
                            {label}
                            <ExternalLink size={12} />
                          </a>
                        ) : (
                          <Link href={href} className={className}>
                            {label}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-6 py-9 text-[13px] text-zinc-400 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <BrandMark className="h-6 w-6" />
              <span>© 2026 {BRAND_NAME}. All rights reserved.</span>
            </div>
            <div id="status" className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-[12px] font-semibold text-white">
                <Activity size={13} />
                All systems operational
              </span>
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com/migueldefrancagithub/openbsp"
                  className="text-[13px] font-semibold text-zinc-400 transition-colors hover:text-white"
                  aria-label="GitHub"
                >
                  GH
                </a>
                <a
                  href="https://www.linkedin.com"
                  className="text-[13px] font-semibold text-zinc-400 transition-colors hover:text-white"
                  aria-label="LinkedIn"
                >
                  in
                </a>
                <span className="h-4 w-px bg-white/20" />
                <span>English</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
