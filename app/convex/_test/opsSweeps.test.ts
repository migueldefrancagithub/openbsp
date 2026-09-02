import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

async function seed(t: ReturnType<typeof convexTest>, retentionDays = 30) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Sweeps",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const channelId = await ctx.db.insert("channels", {
      tenantId,
      publicId: "hub_sweepsxxxxxxxxxxxxxxxxxx".slice(0, 28),
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: "c-sweeps",
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
    const threadId = await ctx.db.insert("channelThreads", {
      tenantId,
      channelId,
      threadKey: "258840000020",
      lastEventAt: Date.now(),
      lastEventKind: "message.text",
      unreadCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { userId, tenantId, memberId, channelId, threadId };
  });
}

describe("operational sweeps", () => {
  it("marks overdue reminders due without touching future ones", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const dueAt of [now - 60_000, now - 1, now + 60_000]) {
        await ctx.db.insert("threadReminders", {
          tenantId: s.tenantId,
          threadId: s.threadId,
          note: "x",
          dueAt,
          status: "scheduled",
          assignedMemberId: s.memberId,
          createdBy: s.memberId,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const result = await t.mutation(internal.inboxOperations.sweepOverdueReminders, {});
    expect(result.marked).toBe(2);
    const rows = await t.run(async (ctx) => await ctx.db.query("threadReminders").collect());
    expect(rows.filter((row) => row.status === "due")).toHaveLength(2);
    expect(await t.mutation(internal.inboxOperations.sweepOverdueReminders, {})).toEqual({ marked: 0 });
  });

  it("reports retention candidates as one alert per day, never deleting", async () => {
    const t = convexTest(schema);
    const s = await seed(t, 30);
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert("channelEvents", {
        tenantId: s.tenantId,
        channelId: s.channelId,
        eventKey: "old",
        eventKind: "message.text",
        direction: "incoming",
        threadKey: "258840000020",
        payload: {},
        rawPayload: "{}",
        rawBodySha256: "sha",
        status: "processed",
        attempts: 1,
        receivedAt: old,
      });
    });
    const first = await t.mutation(internal.retention.runDaily, {});
    expect(first).toMatchObject({ flagged: 1, isDone: true });
    const second = await t.mutation(internal.retention.runDaily, {});
    expect(second.flagged).toBe(1);
    const alerts = await t.withIdentity({ subject: s.userId }).query(api.ops.listAlerts, {});
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "retention.candidates", severity: "info" });
    expect(await t.run(async (ctx) => (await ctx.db.query("channelEvents").collect()).length)).toBe(1);

    await t.withIdentity({ subject: s.userId }).mutation(api.ops.acknowledgeAlert, { alertId: alerts[0]._id });
    expect(await t.withIdentity({ subject: s.userId }).query(api.ops.listAlerts, {})).toHaveLength(0);
    expect(await t.withIdentity({ subject: s.userId }).query(api.ops.listAlerts, { status: "acknowledged" })).toHaveLength(1);
  });

  it("raises alerts for unknown outbox rows and human-case SLA breaches", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i += 1) {
        await ctx.db.insert("channelOutbox", {
          tenantId: s.tenantId,
          channelId: s.channelId,
          businessKey: `hub:text:unknown-${i}`,
          recipient: "258840000020",
          threadKey: "258840000020",
          messageKind: "text",
          payload: { text: "x" },
          status: "unknown",
          dispatchAttempts: 1,
          unknownSince: now - 60_000,
          createdBy: s.memberId,
          createdAt: now - 120_000,
          updatedAt: now - 60_000,
        });
      }
      await ctx.db.insert("humanCases", {
        tenantId: s.tenantId,
        threadId: s.threadId,
        reason: "Pedido de orçamento complexo",
        urgency: "urgent",
        question: "?",
        status: "open",
        slaDueAt: now - 10 * 60_000,
        createdBy: s.memberId,
        createdAt: now - 60 * 60_000,
        updatedAt: now - 60 * 60_000,
      } as never);
    });
    expect(await t.mutation(internal.ops.sweepUnknownOutbox, {})).toEqual({ rows: 5, tenants: 1 });
    expect(await t.mutation(internal.ops.sweepUnknownOutbox, {})).toEqual({ rows: 5, tenants: 1 });
    const sla = await t.mutation(internal.ops.sweepSlaBreaches, {});
    expect(sla).toMatchObject({ breached: 1, isDone: true });
    await t.mutation(internal.ops.sweepSlaBreaches, {});
    const alerts = await t.withIdentity({ subject: s.userId }).query(api.ops.listAlerts, {});
    expect(alerts.map((a) => a.kind).sort()).toEqual(["outbox.unknown", "sla.human_case"]);
    expect(alerts.find((a) => a.kind === "outbox.unknown")?.severity).toBe("critical");
    expect(alerts.find((a) => a.kind === "sla.human_case")?.href).toContain("/app/channel-inbox/258840000020");
    const summary = await t.withIdentity({ subject: s.userId }).query(api.ops.summary, {});
    expect(summary).toEqual({ open: 2, critical: 2, warn: 0 });
  });
});
