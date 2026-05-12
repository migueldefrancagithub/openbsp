"use client";

type Logo = {
  name: string;
  src: string;
  gradient: string;
};

// SVGs from svgl.app — all confirmed CDN paths
const LOGOS: Logo[] = [
  {
    name: "Convex",
    src: "https://svgl.app/library/convex.svg",
    gradient: "linear-gradient(135deg, #F3B01C 0%, #EE342F 100%)",
  },
  {
    name: "Next.js",
    src: "https://svgl.app/library/nextjs_icon_dark.svg",
    gradient: "linear-gradient(135deg, #000000 0%, #444444 100%)",
  },
  {
    name: "Vercel",
    src: "https://svgl.app/library/vercel.svg",
    gradient: "linear-gradient(135deg, #000000 0%, #555555 100%)",
  },
  {
    name: "Meta",
    src: "https://svgl.app/library/meta.svg",
    gradient: "linear-gradient(135deg, #0467DF 0%, #45B0FF 100%)",
  },
  {
    name: "OpenAI",
    src: "https://svgl.app/library/openai.svg",
    gradient: "linear-gradient(135deg, #10A37F 0%, #74E0BE 100%)",
  },
  {
    name: "Anthropic",
    src: "https://svgl.app/library/anthropic.svg",
    gradient: "linear-gradient(135deg, #D97757 0%, #FFB390 100%)",
  },
  {
    name: "Stripe",
    src: "https://svgl.app/library/stripe.svg",
    gradient: "linear-gradient(135deg, #635BFF 0%, #A29BFF 100%)",
  },
  {
    name: "Resend",
    src: "https://svgl.app/library/resend_dark.svg",
    gradient: "linear-gradient(135deg, #000000 0%, #6B7280 100%)",
  },
];

export function LogoMarquee() {
  return (
    <div className="w-full max-w-[1400px] mx-auto mt-10">
      <div
        className="overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)",
        }}
      >
        <div className="flex gap-4 marquee-track-x">
          {[...LOGOS, ...LOGOS].map((logo, i) => (
            <div
              key={`${logo.name}-${i}`}
              className="group relative h-24 w-40 shrink-0 flex items-center justify-center rounded-full bg-white border border-slate-200/60 shadow-sm hover:border-slate-300 transition-all overflow-hidden"
            >
              <div
                className="absolute inset-0 scale-150 opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100"
                style={{ background: logo.gradient }}
                aria-hidden
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logo.src}
                alt={logo.name}
                className="relative h-9 w-auto max-w-[60%] object-contain transition-all duration-300 group-hover:brightness-0 group-hover:invert"
              />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes marquee-x {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .marquee-track-x {
          width: max-content;
          animation: marquee-x 40s linear infinite;
        }
        .marquee-track-x:hover {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track-x { animation: none; }
        }
      `}</style>
    </div>
  );
}
