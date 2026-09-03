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

  it("watches the work a person owes: pending suggestions, expired snoozes, stuck sends", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      const agentId = await ctx.db.insert("aiAgents", {
        tenantId: s.tenantId,
        name: "Recepção",
        objective: "reception",
        channelId: s.channelId,
        status: "active",
        mode: "copilot",
        config: {
          instructions: "Atende com clareza.",
          tone: "friendly",
          knowledgeItemIds: [],
          tools: [],
          handoff: { keywords: [], onLowConfidence: true, onClinicalQuestion: true, message: "Passo à equipa." },
          fallbackMessage: "Vou confirmar com a equipa.",
          maxRepliesPerThread: 10,
        },
        currentVersion: 1,
        createdBy: s.memberId,
        createdAt: now,
        updatedAt: now,
      } as never);
      const versionId = await ctx.db.insert("aiAgentVersions", {
        tenantId: s.tenantId,
        agentId,
        version: 1,
        config: {
          instructions: "Atende com clareza.",
          tone: "friendly",
          knowledgeItemIds: [],
          tools: [],
          handoff: { keywords: [], onLowConfidence: true, onClinicalQuestion: true, message: "Passo à equipa." },
          fallbackMessage: "Vou confirmar com a equipa.",
          maxRepliesPerThread: 10,
        },
        knowledgeSnapshot: [],
        checksum: "test",
        publishedBy: s.memberId,
        publishedAt: now,
      } as never);
      const runId = await ctx.db.insert("aiRuns", {
        tenantId: s.tenantId,
        agentId,
        versionId,
        channelId: s.channelId,
        threadId: s.threadId,
        threadKey: "258840000020",
        status: "active",
        turnsCount: 1,
        costUsdMicros: 0,
        createdAt: now,
        updatedAt: now,
      } as never);
      // Old enough to be overdue, plus one fresh suggestion that must not count.
      await ctx.db.insert("aiTurns", {
        tenantId: s.tenantId,
        runId,
        threadId: s.threadId,
        businessKey: "event:stale",
        status: "awaiting_approval",
        suggestedText: "Bom dia!",
        providerAttempts: [],
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
        toolCallCount: 0,
        createdAt: now - 3 * 60 * 60_000,
        updatedAt: now - 3 * 60 * 60_000,
      } as never);
      await ctx.db.insert("aiTurns", {
        tenantId: s.tenantId,
        runId,
        threadId: s.threadId,
        businessKey: "event:fresh",
        status: "awaiting_approval",
        suggestedText: "Boa tarde!",
        providerAttempts: [],
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
        toolCallCount: 0,
        createdAt: now - 60_000,
        updatedAt: now - 60_000,
      } as never);
      // A snooze whose time is up, and one still running.
      await ctx.db.patch(s.threadId, { snoozedUntil: now - 60_000 });
      await ctx.db.insert("channelThreads", {
        tenantId: s.tenantId,
        channelId: s.channelId,
        threadKey: "258840000021",
        lastEventAt: now,
        lastEventKind: "message.text",
        unreadCount: 0,
        snoozedUntil: now + 60 * 60_000,
        createdAt: now,
        updatedAt: now,
      });
      // A reply the provider never took, and a recent one that is just in flight.
      await ctx.db.insert("channelOutbox", {
        tenantId: s.tenantId,
        channelId: s.channelId,
        businessKey: "hub:text:stuck",
        recipient: "258840000020",
        threadKey: "258840000020",
        messageKind: "text",
        payload: { text: "x" },
        status: "queued",
        dispatchAttempts: 0,
        createdBy: s.memberId,
        createdAt: now - 30 * 60_000,
        updatedAt: now - 30 * 60_000,
      });
      await ctx.db.insert("channelOutbox", {
        tenantId: s.tenantId,
        channelId: s.channelId,
        businessKey: "hub:text:inflight",
        recipient: "258840000020",
        threadKey: "258840000020",
        messageKind: "text",
        payload: { text: "y" },
        status: "queued",
        dispatchAttempts: 0,
        createdBy: s.memberId,
        createdAt: now - 60_000,
        updatedAt: now - 60_000,
      });
    });

    const first = await t.mutation(internal.ops.sweepPendingWork, {});
    expect(first).toMatchObject({ suggestions: 1, snoozes: 1, stuck: 1, isDone: true });
    // Running twice must not duplicate: the business key is the day.
    await t.mutation(internal.ops.sweepPendingWork, {});
    const alerts = await t.withIdentity({ subject: s.userId }).query(api.ops.listAlerts, {});
    const kinds = alerts.map((row) => row.kind).sort();
    expect(kinds).toEqual(["ai.suggestion_stale", "outbox.stuck", "snooze.expired"]);
    expect(alerts.find((row) => row.kind === "outbox.stuck")?.severity).toBe("critical");
    expect(alerts.filter((row) => row.kind === "snooze.expired")).toHaveLength(1);
  });
});
