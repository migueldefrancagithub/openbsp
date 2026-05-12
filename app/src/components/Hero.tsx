"use client";

import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";

const HERO_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260505_101331_74f9b798-3f00-4e86-8a01-377aa16ffeaa.mp4";

export function Hero() {
  return (
    <div className="relative w-full max-w-[1400px] mx-auto rounded-[48px] bg-white border border-slate-200/50 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.03)] overflow-hidden h-[600px] flex flex-col">
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

      {/* Hero content (text + CTA) */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-20 flex-1 px-8 md:px-16 pt-12 md:pt-16 flex flex-col items-start"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200/70 bg-white/80 backdrop-blur text-[11px] text-slate-600 mb-7">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          v21 Cloud API · Healthcare-mode ready
        </div>

        <h1
          className="font-[var(--font-outfit)] text-[42px] md:text-[56px] font-medium leading-[1.05] tracking-tight max-w-3xl"
          style={{ color: "#0a1b33" }}
        >
          Foundation of the
          <br />
          new WhatsApp era
        </h1>

        <p className="font-[var(--font-inter)] text-[14px] md:text-[15px] text-[#64748b] max-w-xl mt-5 leading-relaxed">
          Designing the messaging layer, powering reactive broadcasts and laying
          the foundation for compliance-first WhatsApp ops — for clinics,
          services and developer-first teams alike.
        </p>

        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 18 }}
          className="mt-8 bg-[#0a152d] text-white text-[13px] font-medium px-6 py-3 rounded-full shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)]"
        >
          Contact Us
        </motion.button>
      </motion.div>

      {/* Floating glass navbar */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30">
        <motion.nav
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center bg-white/90 backdrop-blur-2xl px-1.5 py-1.5 rounded-full shadow-[0_12px_40px_rgba(0,0,0,0.08)] border border-slate-200/40 gap-1"
        >
          <div className="w-9 h-9 bg-white border border-slate-100 shadow-sm rounded-full flex items-center justify-center text-[13px]">
            <span style={{
              background: "linear-gradient(90deg, #F5C344, #F28482, #B567C2)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "transparent",
            }}>✦</span>
          </div>
          <button
            type="button"
            className="px-4 py-2 text-[12px] font-semibold text-slate-500 hover:text-[#0a1b33] transition-colors"
          >
            Products
          </button>
          <button
            type="button"
            className="px-4 py-2 text-[12px] font-semibold text-slate-500 hover:text-[#0a1b33] transition-colors"
          >
            Docs
          </button>
          <button
            type="button"
            className="ml-1 inline-flex items-center gap-1 bg-white px-5 py-2 rounded-full text-[12px] font-semibold text-[#0a1b33] border border-slate-200/60 shadow-sm hover:border-slate-300 transition-all"
          >
            Get in touch
            <ChevronRight size={14} strokeWidth={2.5} />
          </button>
        </motion.nav>
      </div>
    </div>
  );
}
