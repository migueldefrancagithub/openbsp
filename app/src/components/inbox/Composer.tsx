"use client";

import { useState, FormEvent, useRef } from "react";
import { useMutation } from "convex/react";
import { Send, Lock, Loader2, AlertCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";

type ComposerProps = {
  conversationId: Id<"conversations">;
  serviceWindowExpiresAt?: number;
};

export function Composer({ conversationId, serviceWindowExpiresAt }: ComposerProps) {
  const sendText = useMutation(api.messages.sendText);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nonceRef = useRef<string>(crypto.randomUUID());

  const within24h =
    serviceWindowExpiresAt && serviceWindowExpiresAt > Date.now();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    setBusy(true);
    try {
      await sendText({
        conversationId,
        text: trimmed,
        clientNonce: nonceRef.current,
      });
      setText("");
      // Fresh nonce for the next send.
      nonceRef.current = crypto.randomUUID();
    } catch (err: unknown) {
      const data =
        err && typeof err === "object" && "data" in err
          ? (err as { data: unknown }).data
          : null;
      let msg = "Failed to send";
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (d.code === "SERVICE_WINDOW_EXPIRED")
          msg = "24h service window expired — use a template instead.";
        else if (d.code === "CONSENT_REQUIRED")
          msg = "No transactional consent for this contact yet.";
        else if (typeof d.message === "string") msg = d.message;
        else if (typeof d.code === "string") msg = String(d.code);
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

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
      {error && (
        <div className="flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg mb-3">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e as unknown as FormEvent);
            }
          }}
          disabled={!within24h || busy}
          placeholder={within24h ? "Type a message…" : "Service window closed"}
          className={cn(
            "flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] text-[#0a1b33] placeholder:text-slate-400",
            "focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all",
            "disabled:bg-slate-50 disabled:cursor-not-allowed",
          )}
        />
        <button
          type="submit"
          disabled={!within24h || busy || !text.trim()}
          className="bg-[#0a152d] text-white p-2.5 rounded-xl shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} strokeWidth={2.5} />
          )}
        </button>
      </form>
    </div>
  );
}
