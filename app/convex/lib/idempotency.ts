import type { MutationCtx } from "../_generated/server";

/**
 * Stable event key derivation for Meta webhook events.
 * NEVER includes timestamps — Meta retries have different timestamps for the
 * same event. Same key for same event ensures dedup across retries.
 */
export function deriveEventKey(parts: {
  kind:
    | "msg"
    | "status"
    | "account"
    | "user_id_update"
    | "user_pref"
    | "biz_username";
  phoneNumberId?: string;
  wabaId?: string;
  wamid?: string;
  statusValue?: string;
  changeField?: string;
  changeValueHash?: string;
  // user_id_update + user_pref + biz_username extras
  previous?: string;
  current?: string;
  waId?: string;
  bsuid?: string;
  category?: string;
  value?: string;
  username?: string;
  status?: string;
  ts?: number;
}): string {
  if (parts.kind === "msg") {
    if (!parts.phoneNumberId || !parts.wamid) {
      throw new Error("msg eventKey requires phoneNumberId + wamid");
    }
    return `msg:${parts.phoneNumberId}:${parts.wamid}`;
  }
  if (parts.kind === "status") {
    if (!parts.phoneNumberId || !parts.wamid || !parts.statusValue) {
      throw new Error(
        "status eventKey requires phoneNumberId + wamid + statusValue",
      );
    }
    return `status:${parts.phoneNumberId}:${parts.wamid}:${parts.statusValue}`;
  }
  if (parts.kind === "account") {
    if (!parts.wabaId || !parts.changeField || !parts.changeValueHash) {
      throw new Error(
        "account eventKey requires wabaId + changeField + changeValueHash",
      );
    }
    return `account:${parts.wabaId}:${parts.changeField}:${parts.changeValueHash}`;
  }
  if (parts.kind === "user_id_update") {
    if (!parts.phoneNumberId || !parts.previous || !parts.current) {
      throw new Error(
        "user_id_update eventKey requires phoneNumberId + previous + current",
      );
    }
    return `uidupd:${parts.phoneNumberId}:${parts.previous}:${parts.current}`;
  }
  if (parts.kind === "user_pref") {
    if (!parts.phoneNumberId || !parts.category || !parts.value) {
      throw new Error(
        "user_pref eventKey requires phoneNumberId + category + value",
      );
    }
    // Include identity + ts so we don't dedup repeated opt-outs across time.
    const who = parts.bsuid || parts.waId || "";
    return `pref:${parts.phoneNumberId}:${who}:${parts.category}:${parts.value}:${parts.ts ?? 0}`;
  }
  if (parts.kind === "biz_username") {
    if (!parts.wabaId || !parts.username || !parts.status) {
      throw new Error(
        "biz_username eventKey requires wabaId + username + status",
      );
    }
    return `bizuser:${parts.wabaId}:${parts.username}:${parts.status}:${parts.ts ?? 0}`;
  }
  throw new Error("unknown eventKey kind");
}

/**
 * Compute SHA-256 hex of a string. Used for prevHash chains and content
 * fingerprinting.
 */
export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Insert webhookEvents row only if eventKey not already present.
 * Returns true if inserted (new event), false if duplicate.
 * Caller should then schedule processWebhookEvent only when true.
 */
export async function tryRegisterWebhookEvent(
  ctx: MutationCtx,
  args: {
    eventKey: string;
    rawPayload: string;
    rawBodySha256: string;
    metaTimestamp?: number;
  },
): Promise<{ inserted: boolean; eventId?: string }> {
  const existing = await ctx.db
    .query("webhookEvents")
    .withIndex("by_key", (q) => q.eq("eventKey", args.eventKey))
    .unique();
  if (existing) return { inserted: false };

  const eventId = await ctx.db.insert("webhookEvents", {
    eventKey: args.eventKey,
    rawPayload: args.rawPayload,
    rawBodySha256: args.rawBodySha256,
    metaTimestamp: args.metaTimestamp,
    status: "pending",
    attempts: 0,
    receivedAt: Date.now(),
  });
  return { inserted: true, eventId };
}
