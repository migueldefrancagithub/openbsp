"use client";

import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";

const HERO_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260505_101331_74f9b798-3f00-4e86-8a01-377aa16ffeaa.mp4";

// Official WhatsApp logo (green speech bubble + phone). Inlined to avoid
// external CDN dependency; gradient + filter live in the SVG itself.
function WhatsAppLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="wa-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#61FD7D" />
          <stop offset="100%" stopColor="#1BD741" />
        </linearGradient>
      </defs>
      <path
        fill="url(#wa-grad)"
        d="M16 0C7.163 0 0 7.163 0 16c0 2.838.74 5.5 2.043 7.81L0 32l8.43-2.21A15.93 15.93 0 0 0 16 32c8.837 0 16-7.163 16-16S24.837 0 16 0z"
      />
      <path
        fill="#fff"
        d="M11.95 8.94c-.27-.6-.55-.61-.81-.62l-.69-.01c-.24 0-.62.09-.95.45-.32.36-1.24 1.21-1.24 2.95 0 1.74 1.27 3.42 1.45 3.66.18.24 2.45 3.92 6.05 5.34 2.99 1.18 3.6.94 4.25.88.65-.06 2.1-.86 2.4-1.69.3-.83.3-1.55.21-1.69-.09-.15-.33-.24-.69-.42-.36-.18-2.1-1.04-2.43-1.16-.32-.12-.56-.18-.8.18s-.92 1.16-1.13 1.4c-.21.24-.42.27-.78.09-.36-.18-1.5-.55-2.86-1.76-1.06-.94-1.77-2.11-1.98-2.47-.21-.36-.02-.55.16-.73.16-.16.36-.42.54-.63.18-.21.24-.36.36-.6.12-.24.06-.45-.03-.63-.09-.18-.79-1.94-1.1-2.65z"
      />
    </svg>
  );
}

export function Hero() {
  return (
    <div className="relative w-full max-w-[1400px] mx-auto rounded-[48px] bg-surface border border-slate-200/50 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.03)] overflow-hidden h-[600px] flex flex-col">
      {/* Video background layer */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden select-none">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover scale-105 transition-transform duration-1000"
        >
          <source src={HERO_VIDEO_URL} type="video/mp4" />
        </video>
      </div>
      <div className="absolute inset-0 z-10 bg-gradient-to-r from-white via-white/92 to-white/55 sm:from-white/80 sm:via-white/45 sm:to-transparent pointer-events-none" />

      {/* Hero content (text + CTA) */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-20 flex-1 px-8 md:px-16 pt-12 md:pt-16 flex flex-col items-start"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200/70 bg-white/80 backdrop-blur text-[11px] text-body mb-7">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Built on Meta Cloud API v21
        </div>

        <h1
          className="font-[var(--font-outfit)] text-[38px] sm:text-[42px] md:text-[56px] font-medium leading-[1.05] tracking-tight max-w-3xl"
          style={{ color: "#0a1b33" }}
        >
          The WhatsApp inbox
          <br />
          your DPO will sign off.
        </h1>

        <p className="font-[var(--font-inter)] text-[14px] md:text-[15px] text-[#64748b] max-w-xl mt-5 leading-relaxed">
          Real-time conversations, segmented broadcasts and 24h-window-aware
          replies — with healthcare-grade content guardrails, per-purpose
          consent, and append-only audit by default. Connect your own WABA
          in minutes.
        </p>

        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 18 }}
          className="mt-8 inline-flex items-center gap-2 bg-nav-active text-white text-[13px] font-medium pl-3 pr-6 py-3 rounded-full shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)]"
        >
          <span className="w-7 h-7 rounded-full bg-surface flex items-center justify-center">
            <WhatsAppLogo size={18} />
          </span>
          Talk to us on WhatsApp
        </motion.button>
      </motion.div>

      {/* Floating glass navbar — WhatsApp icon native in the leftmost key */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 hidden sm:block">
        <motion.nav
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center bg-white/90 backdrop-blur-2xl px-1.5 py-1.5 rounded-full shadow-[0_12px_40px_rgba(0,0,0,0.08)] border border-slate-200/40 gap-1"
        >
          {/* WhatsApp brand button — native, with live green dot */}
          <button
            type="button"
            className="relative w-9 h-9 bg-surface border border-line-soft shadow-sm rounded-full flex items-center justify-center hover:scale-105 transition-transform"
            aria-label="WhatsApp"
          >
            <WhatsAppLogo size={22} />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white animate-pulse" />
          </button>
          <button
            type="button"
            className="px-4 py-2 text-[12px] font-semibold text-muted hover:text-ink transition-colors"
          >
            Products
          </button>
          <button
            type="button"
            className="px-4 py-2 text-[12px] font-semibold text-muted hover:text-ink transition-colors"
          >
            Docs
          </button>
          <button
            type="button"
            className="ml-1 inline-flex items-center gap-1.5 bg-[#25D366] hover:bg-[#1FB456] px-4 py-2 rounded-full text-[12px] font-semibold text-white shadow-[0_4px_14px_-2px_rgba(37,211,102,0.45)] transition-all"
          >
            <WhatsAppLogo size={14} />
            Get in touch
            <ChevronRight size={12} strokeWidth={2.5} />
          </button>
        </motion.nav>
      </div>
    </div>
  );
}
