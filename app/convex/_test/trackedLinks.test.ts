import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { emptyCampaignStats } from "../lib/campaignStats";
import { isPreviewUserAgent } from "../trackedLinks";

describe("tracked links", () => {
  it("ignores link previews and counts a patient click once per recipient", async () => {
    const t = convexTest(schema);
    const seeded = await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        name: "Clinic",
        vertical: "clinic",
        plan: "starter",
        settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
        createdAt: Date.now(),
      });
      const now = Date.now();
      const stats = emptyCampaignStats();
      stats.total = 1;
      stats.byStatus.sent = 1;
      const campaignId = await ctx.db.insert("campaigns", {
        tenantId,
        name: "Links",
        kind: "channel_template",
        status: "running",
        stats,
        createdAt: now,
        updatedAt: now,
      });
      const contactId = await ctx.db.insert("contacts", {
        tenantId,
        e164: "+258840000099",
        tags: [],
        createdAt: now,
      });
      const recipientId = await ctx.db.insert("campaignRecipients", {
        tenantId,
        campaignId,
        contactId,
        identityKind: "phone",
        identityValue: "258840000099",
        threadKey: "258840000099",
        status: "sent",
        sentAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("trackedLinks", {
        tenantId,
        campaignId,
        campaignRecipientId: recipientId,
        token: "abcdefghijklmnopqrstuv",
        targetUrl: "https://clinica.example/agenda",
        clickCount: 0,
        createdAt: now,
      });
      return { campaignId, recipientId };
    });
    expect(isPreviewUserAgent("WhatsApp/2.23.20.0")).toBe(true);
    expect(isPreviewUserAgent("Mozilla/5.0 (iPhone)")).toBe(false);

    expect(await t.query(api.trackedLinks.resolve, { token: "nope" })).toBeNull();
    expect(await t.query(api.trackedLinks.resolve, { token: "abcdefghijklmnopqrstuv" })).toEqual({
      targetUrl: "https://clinica.example/agenda",
    });
    expect(
      await t.mutation(api.trackedLinks.recordClick, { token: "abcdefghijklmnopqrstuv", userAgent: "WhatsApp/2.23" }),
    ).toEqual({ counted: false });
    expect(
      await t.mutation(api.trackedLinks.recordClick, { token: "abcdefghijklmnopqrstuv", userAgent: "Mozilla/5.0 (iPhone)" }),
    ).toEqual({ counted: true });
    expect(
      await t.mutation(api.trackedLinks.recordClick, { token: "abcdefghijklmnopqrstuv", userAgent: "Mozilla/5.0 (iPhone)" }),
    ).toEqual({ counted: true });

    const state = await t.run(async (ctx) => ({
      link: (await ctx.db.query("trackedLinks").collect())[0],
      recipient: (await ctx.db.get(seeded.recipientId)) as Doc<"campaignRecipients">,
      campaign: (await ctx.db.get(seeded.campaignId)) as Doc<"campaigns">,
      events: await ctx.db.query("campaignEvents").collect(),
    }));
    expect(state.link.clickCount).toBe(2);
    expect(state.recipient.status).toBe("clicked");
    expect(state.campaign.stats).toMatchObject({ clicked: 1, byStatus: { sent: 0, clicked: 1 } });
    expect(state.events.filter((e) => e.type === "campaign.recipient.clicked")).toHaveLength(1);
  });
});
