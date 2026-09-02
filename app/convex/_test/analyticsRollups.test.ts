import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { classifyOutbox } from "../analyticsRollups";
import { localDateOf, localTimeToTimestamp } from "../lib/clinicTime";

const TZ = "Africa/Maputo";

// Fake timers keep the scheduler's phase continuations from running in the
// background after the test drove them explicitly.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Clinic",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: TZ, retentionDays: 730 },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const channelId = await ctx.db.insert("channels", {
      tenantId,
      publicId: "hub_rollupxxxxxxxxxxxxxxxxxxx".slice(0, 28),
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: "c-rollup",
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
    return { userId, tenantId, memberId, channelId };
  });
}

describe("analytics rollups", () => {
  it("classifies outbox rows by origin", () => {
    expect(classifyOutbox({ businessKey: "hub:text:campaign:c:r", status: "accepted" })).toBe("outboundCampaign");
    expect(classifyOutbox({ businessKey: "hub:template:followup:t:a1", status: "accepted" })).toBe("outboundFollowUp");
    expect(classifyOutbox({ businessKey: "hub:text:automation:run:node:x", status: "accepted" })).toBe("outboundBot");
    expect(classifyOutbox({ businessKey: "hub:text:abc123", status: "accepted" })).toBe("outboundHuman");
    expect(classifyOutbox({ businessKey: "hub:text:abc123", status: "failed" })).toBe("outboundFailed");
    expect(classifyOutbox({ businessKey: "hub:text:abc123", status: "unknown" })).toBeNull();
  });

  it("aggregates a local day idempotently and serves it through readRange", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const day = localDateOf(Date.now(), TZ);
    const at = localTimeToTimestamp(day, "10:00", TZ);
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i += 1) {
        await ctx.db.insert("channelEvents", {
          tenantId: s.tenantId,
          channelId: s.channelId,
          eventKey: `in-${i}`,
          eventKind: "message.text",
          direction: "incoming",
          threadKey: `25884000000${i}`,
          payload: { text: "x" },
          rawPayload: "{}",
          rawBodySha256: "s",
          status: "processed",
          attempts: 1,
          receivedAt: at + i,
        });
        await ctx.db.insert("channelThreads", {
          tenantId: s.tenantId,
          channelId: s.channelId,
          threadKey: `25884000000${i}`,
          lastEventAt: at + 60_000,
          lastEventKind: "message.text",
          lastInboundAt: at,
          firstRespondedAt: i === 0 ? at + 5 * 60_000 : undefined,
          unreadCount: 0,
          createdAt: at,
          updatedAt: at,
        });
      }
      const outbox = [
        ["hub:text:campaign:c:r1", "accepted"],
        ["hub:text:followup:t:a1", "accepted"],
        ["hub:text:automation:r:n:e", "accepted"],
        ["hub:text:manual1", "accepted"],
        ["hub:text:manual2", "failed"],
      ] as const;
      for (const [businessKey, status] of outbox) {
        await ctx.db.insert("channelOutbox", {
          tenantId: s.tenantId,
          channelId: s.channelId,
          businessKey,
          recipient: "258840000001",
          threadKey: "258840000001",
          messageKind: "text",
          payload: { text: "x" },
          status,
          dispatchAttempts: 1,
          createdBy: s.memberId,
          createdAt: at,
          updatedAt: at,
        });
      }
      const serviceId = await ctx.db.insert("clinicServices", {
        tenantId: s.tenantId,
        name: "Consulta",
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        availability: [],
        status: "active",
        createdBy: s.memberId,
        createdAt: at,
        updatedAt: at,
      });
      for (const status of ["scheduled", "confirmed", "completed", "no_show"] as const) {
        await ctx.db.insert("clinicAppointments", {
          tenantId: s.tenantId,
          serviceId,
          startAt: at,
          endAt: at + 30 * 60_000,
          status,
          createdBy: s.memberId,
          createdAt: at,
          updatedAt: at,
        });
      }
    });

    // Drive the four phases explicitly (the scheduler does this in prod).
    let partial: unknown = undefined;
    for (const phase of ["events", "outbox", "threads", "appointments"] as const) {
      const result = await t.mutation(internal.analyticsRollups.rollupDay, { tenantId: s.tenantId, day, phase, partial });
      if (result.isDone) break;
      // The scheduler carries the counters between phases; mirror that here.
      partial = await accumulate(t, s.tenantId, day, phase);
    }
    const rows = await t.run(async (ctx) => (await ctx.db.query("analyticsDailyRollups").collect()) as Doc<"analyticsDailyRollups">[]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      day,
      inboundMessages: 3,
      newThreads: 3,
      outboundCampaign: 1,
      outboundFollowUp: 1,
      outboundBot: 1,
      outboundHuman: 1,
      outboundFailed: 1,
      booked: 4,
      confirmed: 1,
      attended: 1,
      noShow: 1,
      firstResponseCount: 1,
      approximate: false,
    });

    // Re-running replaces, never duplicates.
    partial = undefined;
    for (const phase of ["events", "outbox", "threads", "appointments"] as const) {
      const result = await t.mutation(internal.analyticsRollups.rollupDay, { tenantId: s.tenantId, day, phase, partial });
      if (result.isDone) break;
      partial = await accumulate(t, s.tenantId, day, phase);
    }
    const again = await t.run(async (ctx) => await ctx.db.query("analyticsDailyRollups").collect());
    expect(again).toHaveLength(1);
    expect(again[0].inboundMessages).toBe(3);

    const range = await t.withIdentity({ subject: s.userId }).query(api.analyticsRollups.readRange, { from: day, to: day });
    expect(range.rows).toHaveLength(1);
    expect(range.rows[0].firstResponseAvgMs).toBe(5 * 60_000);
    expect(range.missingDays).toEqual([]);
  });
});

/**
 * Helper: recompute the counters the scheduler would carry after `phase`.
 * Mirrors rollupDay's per-phase logic on the test database.
 */
async function accumulate(t: ReturnType<typeof convexTest>, tenantId: Id<"tenants">, day: string, upTo: "events" | "outbox" | "threads" | "appointments") {
  const start = localTimeToTimestamp(day, "00:00", TZ);
  const end = start + 24 * 60 * 60_000;
  return await t.run(async (ctx) => {
    const counters: Record<string, number | boolean> = {};
    const phases = ["events", "outbox", "threads", "appointments"];
    for (const phase of phases.slice(0, phases.indexOf(upTo) + 1)) {
      if (phase === "events") {
        const rows = await ctx.db.query("channelEvents").collect();
        counters.inboundMessages = rows.filter((r) => r.tenantId === tenantId && r.receivedAt >= start && r.receivedAt < end && r.direction === "incoming" && r.eventKind.startsWith("message.")).length;
      } else if (phase === "outbox") {
        const rows = await ctx.db.query("channelOutbox").collect();
        for (const row of rows) {
          if (row.tenantId !== tenantId || row.createdAt < start || row.createdAt >= end) continue;
          const bucket = classifyOutbox(row);
          if (bucket) counters[bucket] = ((counters[bucket] as number) ?? 0) + 1;
        }
      } else if (phase === "threads") {
        const rows = await ctx.db.query("channelThreads").collect();
        counters.newThreads = rows.filter((r) => r.tenantId === tenantId && r.createdAt >= start && r.createdAt < end).length;
        const responded = rows.filter((r) => r.tenantId === tenantId && r.firstRespondedAt && r.firstRespondedAt >= start && r.firstRespondedAt < end && r.lastInboundAt);
        counters.firstResponseCount = responded.length;
        counters.firstResponseTotalMs = responded.reduce((acc, r) => acc + (r.firstRespondedAt! - Math.min(r.lastInboundAt!, r.firstRespondedAt!)), 0);
      } else {
        const rows = await ctx.db.query("clinicAppointments").collect();
        const inDay = rows.filter((r) => r.tenantId === tenantId && r.startAt >= start && r.startAt < end);
        counters.booked = inDay.length;
        counters.confirmed = inDay.filter((r) => r.status === "confirmed").length;
        counters.attended = inDay.filter((r) => r.status === "completed").length;
        counters.noShow = inDay.filter((r) => r.status === "no_show").length;
        counters.cancelled = inDay.filter((r) => r.status === "cancelled").length;
      }
    }
    return counters;
  });
}
