"use client";

import { motion } from "motion/react";
import { Inbox, Send, ShieldCheck, type LucideIcon } from "lucide-react";

type FeatureCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  gradient: string;
  delay: number;
};

function FeatureCard({
  title,
  description,
  icon: Icon,
  gradient,
  delay,
}: FeatureCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, ease: "easeOut", delay }}
      className="relative flex flex-col justify-start items-start w-full max-w-[260px] md:max-w-[300px] group mx-auto"
    >
      {/* Glow background */}
      <div
        className="absolute w-full h-[260px] md:h-[300px] opacity-60 rounded-[40px] pointer-events-none"
        style={{ background: gradient, filter: "blur(45px)" }}
        aria-hidden
      />

      {/* Foreground card with gradient border */}
      <div
        className="self-stretch h-[260px] md:h-[300px] rounded-[40px] z-10 overflow-hidden border-[8px] border-transparent"
        style={{
          background: `linear-gradient(#1A1A1C, #1A1A1C) padding-box, ${gradient} border-box`,
        }}
      >
        <div className="w-full h-full p-7 flex flex-col justify-between">
          <div className="text-white/90">
            <Icon size={32} strokeWidth={2.5} />
          </div>

          <div>
            <h3 className="text-white font-medium text-xl mb-3 tracking-tight">
              {title}
            </h3>
            <p className="text-gray-400 text-[14px] leading-[1.6] font-normal">
              {description}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function GlowFeatures() {
  return (
    <section className="bg-[#0A0A0B] flex flex-col items-center justify-center px-6 md:px-12 py-24 md:py-32 relative overflow-hidden">
      {/* Subtle grid backdrop, very low opacity */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 80%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="text-center mb-16 md:mb-20 relative z-10"
      >
        <div
          className="text-xs uppercase tracking-[0.18em] mb-4"
          style={{
            background: "linear-gradient(90deg, #FF3D77, #06B6D4, #4361EE)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "transparent",
          }}
        >
          What ships in the box
        </div>
        <h2 className="font-[var(--font-outfit)] text-white text-[36px] md:text-[44px] font-medium tracking-tight leading-[1.1]">
          Three pieces.
          <br className="md:hidden" /> Production-grade by default.
        </h2>
        <p className="text-gray-400 mt-5 max-w-2xl mx-auto text-[15px] leading-relaxed">
          Each card is a pillar that another platform sells separately. With
          OpenBSP, they ship together and were designed to compose.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-3 lg:gap-3 w-full max-w-[936px] relative z-10">
        <FeatureCard
          icon={Inbox}
          title="Realtime Inbox"
          description="Conversations stream in live via Convex reactive queries. No polling, no refresh, no missed messages — even at 50 agents."
          gradient="linear-gradient(137deg, #FF3D77 0%, #FFB1CE 45%, #FF9D3C 100%)"
          delay={0.1}
        />
        <FeatureCard
          icon={Send}
          title="Smart Broadcasts"
          description="Segment by tag, schedule via Convex scheduler, ship Meta-approved templates, auto-pause when quality dips. Idempotent end to end."
          gradient="linear-gradient(137deg, #FFFFFF 0%, #7DD3FC 45%, #06B6D4 100%)"
          delay={0.2}
        />
        <FeatureCard
          icon={ShieldCheck}
          title="Compliance Built-in"
          description="Healthcare allowlist, opt-in by purpose with proof, append-only audit hash chain. Pass DPO and Meta review on day one."
          gradient="linear-gradient(137deg, #4361EE 0%, #E0AEFF 45%, #F72585 100%)"
          delay={0.3}
        />
      </div>
    </section>
  );
}
