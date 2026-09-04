import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

describe("operation dashboard", () => {
  it("counts leads from the index, not from the 200-thread sample", async () => {
    const t = convexTest(schema);
    const s = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Owner" });
      const tenantId = await ctx.db.insert("tenants", {
        name: "Clinic",
        vertical: "clinic",
        plan: "starter",
        settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
        createdAt: Date.now(),
      });
      const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
      const channelId = await ctx.db.insert("channels", {
        tenantId,
        publicId: "hub_dashxxxxxxxxxxxxxxxxxxxxx".slice(0, 28),
        kind: "whatsapp",
        provider: "iasolution_hub",
        operationalTerritory: "openbsp",
        externalAccountId: "c-dash",
        displayName: "c",
        status: "active",
        sendMode: "allowlist",
        outboundAllowlist: [],
        connectionState: "allowlist_only",
        webhookStatus: "verified",
        createdBy: memberId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const now = Date.now();
      for (let i = 0; i < 300; i += 1) {
        const threadKey = `2588400${String(i).padStart(5, "0")}`;
        await ctx.db.insert("channelThreads", {
          tenantId,
          channelId,
          threadKey,
          lastEventAt: now - i * 1000,
          lastEventKind: "message.text",
          serviceWindowExpiresAt: i === 0 ? now + 60_000 : undefined,
          unreadCount: 0,
          leadStatus: i % 3 === 0 ? "new" : i % 3 === 1 ? "interested" : "booked",
          createdAt: now - i * 1000,
          updatedAt: now - i * 1000,
        });
        await ctx.db.insert("channelEvents", {
          tenantId,
          channelId,
          eventKey: `in-${i}`,
          eventKind: "message.text",
          direction: "incoming",
          threadKey,
          payload: { text: "Olá" },
          rawPayload: "{}",
          rawBodySha256: "s",
          status: "processed",
          attempts: 1,
          receivedAt: now - i * 1000,
        });
      }
      return { userId, now };
    });
    const dashboard = await t.withIdentity({ subject: s.userId }).query(api.operation.dashboard, { now: s.now });
    expect(dashboard.leads.total).toBe(300);
    expect(dashboard.leads.capped).toBe(false);
    expect(dashboard.leads.statusCounts.find((row) => row.status === "new")?.count).toBe(100);
    expect(dashboard.leads.statusCounts.find((row) => row.status === "booked")?.count).toBe(100);
    expect(dashboard.attention.open24h).toBe(1);

    const afterExpiry = await t
      .withIdentity({ subject: s.userId })
      .query(api.operation.dashboard, { now: s.now + 120_000 });
    expect(afterExpiry.attention.open24h).toBe(0);
  });
});
