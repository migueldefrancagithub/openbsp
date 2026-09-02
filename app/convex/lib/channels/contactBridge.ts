import type { Doc, Id } from "../../_generated/dataModel";

function normalizedE164(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  return /^[1-9]\d{7,17}$/.test(digits) ? `+${digits}` : undefined;
}

/**
 * The durable person record behind a channel-neutral thread. Consent (and
 * later erasure/export) lives on `contacts`; a Hub thread only carries an
 * identity. Find the contact by phone or BSUID, else create one — this is
 * identity data, not a legacy conversation, so ADR-002 is respected.
 */
export async function findOrCreateContactForThread(
  ctx: { db: any; tenantId: Id<"tenants"> },
  thread: Pick<Doc<"channelThreads">, "threadKey">,
  identity: Pick<Doc<"channelIdentities">, "phone" | "providerScopedId" | "displayName"> | null,
): Promise<Doc<"contacts">> {
  const e164 = normalizedE164(identity?.phone ?? thread.threadKey);
  if (e164) {
    const byPhone = (await ctx.db
      .query("contacts")
      .withIndex("by_tenant_phone", (q: any) => q.eq("tenantId", ctx.tenantId).eq("e164", e164))
      .unique()) as Doc<"contacts"> | null;
    if (byPhone) return byPhone;
  }
  const scopedId = identity?.providerScopedId ?? thread.threadKey;
  const bsuid = scopedId && !normalizedE164(scopedId) ? scopedId : undefined;
  if (bsuid) {
    const byBsuid = (await ctx.db
      .query("contacts")
      .withIndex("by_tenant_bsuid", (q: any) => q.eq("tenantId", ctx.tenantId).eq("bsuid", bsuid))
      .unique()) as Doc<"contacts"> | null;
    if (byBsuid) return byBsuid;
  }
  const contactId = await ctx.db.insert("contacts", {
    tenantId: ctx.tenantId,
    e164,
    bsuid,
    name: identity?.displayName,
    tags: [],
    createdAt: Date.now(),
  });
  return (await ctx.db.get(contactId)) as Doc<"contacts">;
}
