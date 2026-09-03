import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { routeApiV1, type ApiCaller } from "../httpApiV1";

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const mk = async (name: string) => {
      const tenantId = await ctx.db.insert("tenants", { name, vertical: "clinic", plan: "starter", settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 }, createdAt: Date.now() });
      const userId = await ctx.db.insert("users", { name });
      const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
      const now = Date.now();
      const channelId = await ctx.db.insert("channels", { tenantId, publicId: `hub_${name}xxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 28), kind: "whatsapp", provider: "iasolution_hub", operationalTerritory: "openbsp", externalAccountId: `c-${name}`, displayName: name, status: "active", sendMode: "allowlist", outboundAllowlist: [], connectionState: "allowlist_only", webhookStatus: "verified", createdBy: memberId, createdAt: now, updatedAt: now });
      const threadId = await ctx.db.insert("channelThreads", { tenantId, channelId, threadKey: `25884000${name.length}001`, lastEventAt: now, lastEventKind: "message.text", unreadCount: 0, leadStatus: "interested", createdAt: now, updatedAt: now });
      const serviceId = await ctx.db.insert("clinicServices", { tenantId, name: "Consulta", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, availability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "00:00", end: "23:59" })), status: "active", createdBy: memberId, createdAt: now, updatedAt: now });
      const apiKeyId = await ctx.db.insert("apiKeys", { tenantId, name: "n8n", keyHash: `hash-${name}`, keyPreview: "obsp…1234", role: "agent", createdBy: memberId, createdAt: now });
      return { tenantId, memberId, channelId, threadId, serviceId, apiKeyId };
    };
    return { a: await mk("alpha"), b: await mk("beta") };
  });
}

function deps(t: ReturnType<typeof convexTest>, caller: ApiCaller | null) {
  return {
    authenticate: async () => caller,
    runQuery: (ref: unknown, args: unknown) => (t.query as unknown as (r: unknown, a: unknown) => Promise<never>)(ref, args),
    runMutation: (ref: unknown, args: unknown) => (t.mutation as unknown as (r: unknown, a: unknown) => Promise<never>)(ref, args),
  };
}

describe("REST v1 router", () => {
  it("rejects missing keys, lists and reads threads, tags, books idempotently and isolates tenants", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const caller: ApiCaller = { apiKeyId: s.a.apiKeyId, tenantId: s.a.tenantId, role: "agent" };

    const unauthorized = await routeApiV1(new Request("https://x.convex.site/api/v1/threads"), deps(t, null));
    expect(unauthorized.status).toBe(401);

    const list = await routeApiV1(new Request("https://x.convex.site/api/v1/threads?limit=10"), deps(t, caller));
    const listBody = await list.json();
    expect(list.status).toBe(200);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]).toMatchObject({ lead_status: "interested", thread_key: "258840005001" });

    const one = await routeApiV1(new Request("https://x.convex.site/api/v1/threads/258840005001"), deps(t, caller));
    expect((await one.json()).data.thread_key).toBe("258840005001");
    const otherTenantThread = await routeApiV1(new Request("https://x.convex.site/api/v1/threads/258840004001"), deps(t, caller));
    expect(otherTenantThread.status).toBe(404);

    const tagged = await routeApiV1(new Request("https://x.convex.site/api/v1/threads/258840005001/tags", { method: "POST", body: JSON.stringify({ tag: "VIP" }), headers: { "content-type": "application/json" } }), deps(t, caller));
    expect((await tagged.json()).data.tags).toEqual(["vip"]);
    const viewer = await routeApiV1(new Request("https://x.convex.site/api/v1/threads/258840005001/tags", { method: "POST", body: JSON.stringify({ tag: "x" }) }), deps(t, { ...caller, role: "marketing" }));
    expect(viewer.status).toBe(403);

    const startAt = Date.now() + 2 * 24 * 60 * 60_000;
    const book = (body: unknown) => routeApiV1(new Request("https://x.convex.site/api/v1/appointments", { method: "POST", body: JSON.stringify(body) }), deps(t, caller));
    const created = await book({ serviceId: s.a.serviceId, startAt, threadKey: "258840005001", patientName: "Ana", businessKey: "ext-42" });
    expect(created.status).toBe(201);
    const replay = await book({ serviceId: s.a.serviceId, startAt, threadKey: "258840005001", patientName: "Ana", businessKey: "ext-42" });
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.created).toBe(false);
    const conflict = await book({ serviceId: s.a.serviceId, startAt, patientName: "Outro", businessKey: "ext-43" });
    expect(conflict.status).toBe(409);
    const crossTenant = await book({ serviceId: s.b.serviceId, startAt, businessKey: "ext-44" });
    expect(crossTenant.status).toBe(404);

    const day = new Date(startAt).toISOString().slice(0, 10);
    const agenda = await routeApiV1(new Request(`https://x.convex.site/api/v1/appointments?from=${day}&to=${day}`), deps(t, caller));
    expect((await agenda.json()).data).toHaveLength(1);
    const badRange = await routeApiV1(new Request("https://x.convex.site/api/v1/appointments?from=2026-01-01&to=2026-12-31"), deps(t, caller));
    expect(badRange.status).toBe(400);

    const campaignId = await t.run(async (ctx) => await ctx.db.insert("campaigns", { tenantId: s.a.tenantId, name: "C", kind: "channel_text", status: "completed", stats: { total: 2, byStatus: { pending: 0, queued: 0, dispatching: 0, sent: 2, delivered: 0, read: 0, replied: 0, clicked: 0, failed: 0, skipped: 0 }, unknown: 0, replied: 1, clicked: 0, converted: 0, attempts: 2, rateLimited: 0 }, createdAt: Date.now(), updatedAt: Date.now() }));
    const stats = await routeApiV1(new Request(`https://x.convex.site/api/v1/campaigns/${campaignId}/stats`), deps(t, caller));
    expect((await stats.json()).data.rates.replyRate).toBe(0.5);
    const foreignStats = await routeApiV1(new Request(`https://x.convex.site/api/v1/campaigns/${campaignId}/stats`), deps(t, { apiKeyId: s.b.apiKeyId, tenantId: s.b.tenantId, role: "agent" }));
    expect(foreignStats.status).toBe(404);
    expect((await routeApiV1(new Request("https://x.convex.site/api/v1/nope"), deps(t, caller))).status).toBe(404);
    void internal;
    void (s.a.threadId as Id<"channelThreads">);
  });
});
