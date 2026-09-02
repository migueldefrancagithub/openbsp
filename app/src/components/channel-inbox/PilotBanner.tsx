"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { Loader2, ShieldAlert, UserRoundPlus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useI18n } from "@/lib/i18n";

/**
 * Shown when the patient's number is outside the channel's pilot allowlist.
 * Admins get a deep link into Settings (the allowlist edit + explicit pilot
 * re-arm stay there, on purpose); agents can leave a traceable request.
 */
export function PilotBanner({
  threadId,
  recipient,
  role,
}: {
  threadId: Id<"channelThreads">;
  recipient: string;
  role?: string;
}) {
  const { t } = useI18n();
  const requestInclusion = useMutation(api.inboxOperations.requestAllowlistInclusion);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canEditAllowlist = role === "owner" || role === "admin";
  const digits = recipient.replace(/\D/g, "");

  async function handleRequest() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await requestInclusion({ threadId });
      setNotice(result.requested ? t("inbox.pilotRequested") : t("inbox.pilotAlreadyRequested"));
    } catch {
      setNotice(t("inbox.sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5" data-pilot-banner>
      <ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-amber-900">{t("inbox.pilotTitle")}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-amber-800">{t("inbox.pilotDetail")}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canEditAllowlist ? (
            <Link
              href={`/app/settings?tab=whatsapp&allowlistAdd=${encodeURIComponent(digits)}#hub`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0a152d] px-3 text-[11px] font-semibold text-white hover:bg-[#0a1b33]"
            >
              <UserRoundPlus size={13} />
              {t("inbox.pilotAddAdmin")}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void handleRequest()}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0a152d] px-3 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <UserRoundPlus size={13} />}
              {t("inbox.pilotRequest")}
            </button>
          )}
          {notice && <span className="text-[11px] text-amber-900">{notice}</span>}
        </div>
      </div>
    </div>
  );
}
