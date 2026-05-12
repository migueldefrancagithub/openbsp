"use client";

import { Send, Lock } from "lucide-react";
import { cn } from "@/lib/cn";

type ComposerProps = {
  serviceWindowExpiresAt?: number;
};

export function Composer({ serviceWindowExpiresAt }: ComposerProps) {
  const within24h =
    serviceWindowExpiresAt && serviceWindowExpiresAt > Date.now();

  return (
    <div className="border-t border-slate-200 bg-white p-4">
      {!within24h && (
        <div className="flex items-center gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg mb-3">
          <Lock size={12} strokeWidth={2.5} />
          <span>
            24h service window expired — only template messages can be sent
            until the contact replies.
          </span>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          disabled
          placeholder="Composer ships in Chunk D — outbound text + template picker"
          rows={2}
          className={cn(
            "flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] text-[#0a1b33] placeholder:text-slate-400",
            "focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all",
            "disabled:bg-slate-50 disabled:cursor-not-allowed",
          )}
        />
        <button
          type="button"
          disabled
          className="bg-[#0a152d] text-white p-2.5 rounded-xl shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Send size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
