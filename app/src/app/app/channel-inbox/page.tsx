import { Radio } from "lucide-react";

export default function ChannelInboxIndexPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 bg-[#f4f6f9]">
      <div className="relative mb-5">
        <div
          className="absolute inset-0 rounded-2xl opacity-40"
          style={{
            background:
              "linear-gradient(137deg, #FF3D77 0%, #06B6D4 50%, #4361EE 100%)",
            filter: "blur(28px)",
          }}
        />
        <div className="relative w-14 h-14 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-sm">
          <Radio size={22} className="text-[#0a1b33]" strokeWidth={2} />
        </div>
      </div>
      <h2 className="font-[var(--font-outfit)] text-[20px] font-medium tracking-tight text-[#0a1b33]">
        Pick a thread
      </h2>
      <p className="text-slate-500 text-sm mt-2 max-w-sm leading-relaxed">
        Channel-neutral inbox. Threads here come from normalized channel events,
        separate from the WhatsApp inbox.
      </p>
    </div>
  );
}
