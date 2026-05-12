import { Check, CheckCheck, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/relativeTime";

type MessageBubbleProps = {
  direction: "incoming" | "outgoing" | string;
  type: string;
  content: unknown;
  status: string;
  createdAt: number;
};

export function MessageBubble({
  direction,
  type,
  content,
  status,
  createdAt,
}: MessageBubbleProps) {
  const isOut = direction === "outgoing";
  const text = extractText(type, content);

  return (
    <div className={cn("flex w-full", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-3.5 py-2 shadow-sm",
          isOut
            ? "bg-[#0a152d] text-white rounded-br-md"
            : "bg-white border border-slate-200 text-[#0a1b33] rounded-bl-md",
        )}
      >
        {text ? (
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
            {text}
          </p>
        ) : (
          <p
            className={cn(
              "text-[12px] italic",
              isOut ? "text-white/60" : "text-slate-400",
            )}
          >
            [{type}]
          </p>
        )}
        <div
          className={cn(
            "flex items-center gap-1 justify-end mt-1 text-[10px]",
            isOut ? "text-white/50" : "text-slate-400",
          )}
        >
          <span>{formatTime(createdAt)}</span>
          {isOut && <StatusIcon status={status} />}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "queued":
    case "dispatching":
      return <Clock size={11} />;
    case "sent":
      return <Check size={12} />;
    case "delivered":
      return <CheckCheck size={12} />;
    case "read":
      return <CheckCheck size={12} className="text-emerald-300" />;
    case "failed":
      return <AlertCircle size={12} className="text-red-300" />;
    case "unknown":
      return <AlertCircle size={12} className="text-amber-300" />;
    default:
      return null;
  }
}

function extractText(type: string, content: unknown): string {
  const c = content as Record<string, unknown> | null;
  if (!c) return "";
  if (type === "text") {
    const t = c.text as { body?: string } | undefined;
    return t?.body ?? "";
  }
  if (type === "image" || type === "video" || type === "document" || type === "audio") {
    const media = c[type] as { caption?: string; filename?: string } | undefined;
    return media?.caption ?? media?.filename ?? "";
  }
  if (type === "interactive") {
    const i = c.interactive as { body?: { text?: string } } | undefined;
    return i?.body?.text ?? "";
  }
  if (type === "reaction") {
    const r = c.reaction as { emoji?: string } | undefined;
    return r?.emoji ?? "";
  }
  return "";
}
