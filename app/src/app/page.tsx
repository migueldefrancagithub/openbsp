import Link from "next/link";
import { CoreFeatures } from "@/components/CoreFeatures";

export default function Home() {
  return (
    <div className="min-h-full bg-white text-slate-900 font-[var(--font-inter)]">
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur border-b border-slate-100">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block w-6 h-6 rounded-md bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2]" />
            openbsp
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#compliance" className="hover:text-slate-900 transition-colors">Compliance</a>
            <a href="#pricing" className="hover:text-slate-900 transition-colors">Pricing</a>
            <a href="#docs" className="hover:text-slate-900 transition-colors">Docs</a>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/login" className="text-slate-600 hover:text-slate-900 transition-colors">
              Login
            </Link>
            <Link
              href="/signup"
              className="px-4 py-2 rounded-full bg-slate-900 text-white hover:bg-slate-700 transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[520px] -z-10"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(245,195,68,0.18), transparent 60%), radial-gradient(ellipse 70% 50% at 50% 0%, rgba(181,103,194,0.12), transparent 70%)",
          }}
        />
        <div className="mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200 bg-white text-xs text-slate-600 mb-7">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Now compatible with WhatsApp Cloud API v21
          </div>
          <h1 className="text-5xl sm:text-6xl font-medium tracking-tight text-slate-900 leading-[1.05]">
            WhatsApp Business
            <br />
            <span
              style={{
                background:
                  "linear-gradient(90deg, #F5C344, #F28482, #B567C2)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "transparent",
              }}
            >
              that respects the rules
            </span>
          </h1>
          <p className="mx-auto max-w-2xl mt-6 text-lg text-slate-600 leading-relaxed">
            Inbox real-time, broadcasts segmentados, lembretes automáticos,
            opt-in auditável e RGPD em primeiro lugar. Construído sobre Convex
            para reactive subscriptions e idempotência por design.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              Start free
              <span aria-hidden>→</span>
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-slate-200 bg-white text-sm text-slate-700 hover:border-slate-300 transition-colors"
            >
              See features
            </a>
          </div>

          {/* Customer logos placeholder */}
          <div className="mt-20">
            <p className="text-xs uppercase tracking-widest text-slate-400 mb-6">
              Built for clinics, services, e-commerce, and developer-first teams
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-60">
              {["Convex", "Vercel", "Meta Cloud", "Next.js", "Resend"].map((name) => (
                <span key={name} className="text-slate-500 font-medium tracking-tight">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Core Features section (per spec) */}
      <div id="features">
        <CoreFeatures />
      </div>

      {/* Compliance band — Clerk-style trust signals */}
      <section id="compliance" className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid md:grid-cols-2 gap-12 items-start">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-500 mb-3">
                Compliance by default
              </div>
              <h2 className="text-3xl font-medium tracking-tight text-slate-900">
                Built so Meta and your DPO sleep at night
              </h2>
              <p className="mt-4 text-slate-600 leading-relaxed">
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
                  className="rounded-xl bg-white border border-slate-200 p-4"
                >
                  <div className="font-semibold text-slate-900">{title}</div>
                  <div className="text-slate-500 text-xs mt-1">{sub}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-100">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-slate-900">
            Ready to ship WhatsApp the right way?
          </h2>
          <p className="mt-4 text-slate-600">
            8 weeks from setup to first patient reminder. Solo dev, Convex
            backed, fully open under Unlicense upstream.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              Start free
            </Link>
            <a
              href="https://github.com/migueldefrancagithub/openbsp"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-slate-200 bg-white text-sm text-slate-700 hover:border-slate-300 transition-colors"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <span className="inline-block w-5 h-5 rounded-md bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2]" />
            <span>openbsp · 2026</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="#" className="hover:text-slate-900 transition-colors">Privacy</a>
            <a href="#" className="hover:text-slate-900 transition-colors">Terms</a>
            <a href="#" className="hover:text-slate-900 transition-colors">DPA</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
