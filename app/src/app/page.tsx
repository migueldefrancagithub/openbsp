import Link from "next/link";
import { CoreFeatures } from "@/components/CoreFeatures";
import { Hero } from "@/components/Hero";
import { LogoMarquee } from "@/components/LogoMarquee";
import { GlowFeatures } from "@/components/GlowFeatures";
import "./landing-anims.css";

export default function Home() {
  return (
    <div className="min-h-full bg-[#f9fafb] text-slate-900">
      {/* Top global nav (compact, only visible above hero) */}
      <header className="absolute top-0 left-0 right-0 z-40 px-6 py-5">
        <div className="mx-auto max-w-[1400px] flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 font-[var(--font-outfit)] font-semibold tracking-tight text-[#0a1b33]"
          >
            <span className="inline-block w-6 h-6 rounded-md bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2]" />
            openbsp
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

      {/* CTA */}
      <section className="border-t border-slate-200 bg-white relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-10">
          <div
            className="orb orb-b"
            style={{
              top: "10%",
              left: "30%",
              width: "320px",
              height: "320px",
              background:
                "radial-gradient(circle, #F9ED96 0%, transparent 70%)",
              opacity: 0.4,
            }}
          />
          <div
            className="orb orb-c"
            style={{
              top: "20%",
              right: "25%",
              width: "280px",
              height: "280px",
              background:
                "radial-gradient(circle, #B567C2 0%, transparent 70%)",
              opacity: 0.3,
            }}
          />
        </div>
        <div className="mx-auto max-w-3xl px-6 py-28 text-center relative">
          <h2 className="font-[var(--font-outfit)] text-[36px] md:text-[44px] font-medium tracking-tight text-[#0a1b33] leading-[1.1]">
            Ready to ship WhatsApp the right way?
          </h2>
          <p className="mt-5 text-slate-600 text-[15px]">
            8 weeks from setup to first patient reminder. Solo dev, Convex
            backed, fully open under Unlicense upstream.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/signup"
              className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#0a152d] text-white text-[13px] font-medium"
            >
              Start free
              <span aria-hidden>→</span>
            </Link>
            <a
              href="https://github.com/migueldefrancagithub/openbsp"
              className="btn-secondary inline-flex items-center gap-2 px-6 py-3 rounded-full border border-slate-200 bg-white text-[13px] text-slate-700 hover:border-slate-300"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <span className="inline-block w-5 h-5 rounded-md bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2]" />
            <span>openbsp · 2026</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="#" className="hover:text-[#0a1b33] transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-[#0a1b33] transition-colors">
              Terms
            </a>
            <a href="#" className="hover:text-[#0a1b33] transition-colors">
              DPA
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
