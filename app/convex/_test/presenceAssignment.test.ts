import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import { pickRoundRobin, presenceStatus } from "../lib/assignment";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function seed(t: ReturnType<typeof convexTest>) {
  const base = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Clinic",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const make = async (name: string, role: "owner" | "agent") => {
      const userId = await ctx.db.insert("users", { name });
      const memberId = await ctx.db.insert("members", { tenantId, userId, role, status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
      return { userId, memberId };
    };
    return { tenantId, owner: await make("Owner", "owner"), ana: await make("Ana", "agent"), bea: await make("Bea", "agent") };
  });
  const asOwner = t.withIdentity({ subject: base.owner.userId });
  const pending = await asOwner.mutation(api.iaSolutionHub.createPendingChannel, { displayName: "Piloto" });
  const teamId = await asOwner.mutation(api.teams.create, {
    name: "Recepção",
    members: [
      { memberId: base.ana.memberId, teamRole: "lead" },
      { memberId: base.bea.memberId, teamRole: "member" },
    ],
  });
  return { ...base, asOwner, channelId: pending.channelId, teamId };
}

async function inbound(t: ReturnType<typeof convexTest>, channelId: Id<"channels">, from: string, text: string, id: string) {
  const payload = {
    contacts: [{ profile: { name: `P ${from.slice(-2)}` }, wa_id: from }],
    messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
  };
  await t.mutation(internal.iaSolutionHub.ingestWebhookEvents, {
    channelId,
    rawPayload: JSON.stringify(payload),
    rawBodySha256: `sha-${id}`,
    events: normalizeWebhook(payload, `sha-${id}`),
  });
}

describe("presence and assignment", () => {
  it("derives presence from heartbeats and picks round-robin", () => {
    const now = Date.now();
    expect(presenceStatus(null, now)).toBe("offline");
    expect(presenceStatus({ lastSeenAt: now - 30_000 }, now)).toBe("online");
    expect(presenceStatus({ lastSeenAt: now - 5 * 60_000 }, now)).toBe("away");
    expect(presenceStatus({ lastSeenAt: now - 30_000, manualStatus: "away" }, now)).toBe("away");
    expect(presenceStatus({ lastSeenAt: now - 20 * 60_000 }, now)).toBe("offline");
    const a = { _id: "a" } as unknown as Doc<"members">;
    const b = { _id: "b" } as unknown as Doc<"members">;
    expect(pickRoundRobin([a, b], undefined)?._id).toBe("a");
    expect(pickRoundRobin([a, b], a._id)?._id).toBe("b");
    expect(pickRoundRobin([a, b], b._id)?._id).toBe("a");
    expect(pickRoundRobin([], undefined)).toBeNull();
  });

  it("assigns new inbound threads by rule, honours onlyOnline and least_open, and tracks first-response SLA", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asAna = t.withIdentity({ subject: s.ana.userId });
    const asBea = t.withIdentity({ subject: s.bea.userId });

    await s.asOwner.mutation(api.assignmentRules.save, { name: "Recepção rotativa", teamId: s.teamId, strategy: "round_robin", onlyOnline: true });
    // Nobody online → unassigned.
    await inbound(t, s.channelId, "258840000001", "Olá", "w1");
    let threads = await t.run(async (ctx) => await ctx.db.query("channelThreads").collect());
    expect(threads[0].responsibleMemberId).toBeUndefined();
    expect(threads[0].firstResponseDueAt).toBeGreaterThan(Date.now());

    // Ana online → gets the next two in round-robin with Bea once Bea is online.
    await asAna.mutation(api.presence.heartbeat, {});
    await inbound(t, s.channelId, "258840000002", "Olá", "w2");
    await asBea.mutation(api.presence.heartbeat, {});
    await inbound(t, s.channelId, "258840000003", "Olá", "w3");
    await inbound(t, s.channelId, "258840000004", "Olá", "w4");
    threads = await t.run(async (ctx) => await ctx.db.query("channelThreads").collect());
    const byKey = new Map(threads.map((row) => [row.threadKey, row]));
    expect(byKey.get("258840000002")?.responsibleMemberId).toBe(s.ana.memberId);
    expect(byKey.get("258840000003")?.responsibleMemberId).toBe(s.bea.memberId);
    expect(byKey.get("258840000004")?.responsibleMemberId).toBe(s.ana.memberId);
    expect(byKey.get("258840000004")?.assignedBy).toBe("rule");
    expect(byKey.get("258840000004")?.assignedTeamId).toBe(s.teamId);
    const events = await t.run(async (ctx) => (await ctx.db.query("threadSystemEvents").collect()).filter((e) => e.kind === "inbox.assigned"));
    expect(events).toHaveLength(3);

    const team = await s.asOwner.query(api.presence.listTeam, {});
    expect(team.find((m) => m.memberId === s.ana.memberId)).toMatchObject({ status: "online", openThreads: 2 });
    expect(team.find((m) => m.memberId === s.owner.memberId)?.status).toBe("offline");
    await expect(t.withIdentity({ subject: s.ana.userId }).query(api.presence.listTeam, {})).resolves.toBeDefined();

    // least_open rule prefers Bea (1 open) over Ana (2 open).
    const rules = await s.asOwner.query(api.assignmentRules.list, {});
    await s.asOwner.mutation(api.assignmentRules.save, { ruleId: rules[0]._id, name: rules[0].name, teamId: s.teamId, strategy: "least_open", onlyOnline: false });
    await inbound(t, s.channelId, "258840000005", "Olá", "w5");
    threads = await t.run(async (ctx) => await ctx.db.query("channelThreads").collect());
    expect(threads.find((row) => row.threadKey === "258840000005")?.responsibleMemberId).toBe(s.bea.memberId);

    // First-response SLA clears on the clinic's first outbound message.
    const thread = threads.find((row) => row.threadKey === "258840000005")!;
    await t.run(async (ctx) => {
      await ctx.db.patch(thread._id, { firstResponseDueAt: Date.now() - 60_000 });
    });
    const list = await s.asOwner.query(api.inboxOperations.listThreads, { channelId: s.channelId, filter: "all", now: Date.now(), paginationOpts: { cursor: null, numItems: 20 } } as never);
    expect(list.page.find((row: { threadKey: string }) => row.threadKey === "258840000005")).toMatchObject({ slaBreached: true });
    const sweep = await t.mutation(internal.ops.sweepSlaBreaches, {});
    expect(sweep.breached).toBeGreaterThanOrEqual(1);
    const alerts = await s.asOwner.query(api.ops.listAlerts, {});
    expect(alerts.some((a) => a.kind === "sla.first_response")).toBe(true);

    const channel = await t.run(async (ctx) => (await ctx.db.get(s.channelId)) as Doc<"channels">);
    const { projectThreadFromEvent } = await import("../lib/channels/projection");
    await t.run(async (ctx) => {
      await projectThreadFromEvent(ctx as never, {
        channel,
        event: { eventKey: "out-1", eventKind: "message.text", direction: "outgoing", threadKey: "258840000005", providerEventId: "wamid.out.1", providerTimestamp: Date.now(), payload: { text: "Olá!" } } as never,
        now: Date.now(),
      });
    });
    const after = await t.run(async (ctx) => (await ctx.db.get(thread._id)) as Doc<"channelThreads">);
    expect(after.firstResponseDueAt).toBeUndefined();
    expect(after.firstRespondedAt).toBeDefined();
  });

  it("enforces capabilities on rules and presence", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await expect(
      t.withIdentity({ subject: s.ana.userId }).mutation(api.assignmentRules.save, { name: "x", teamId: s.teamId, strategy: "round_robin", onlyOnline: false }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    const marketing = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Mkt" });
      await ctx.db.insert("members", { tenantId: s.tenantId, userId, role: "marketing", status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: s.tenantId, updatedAt: Date.now() });
      return userId;
    });
    await expect(t.withIdentity({ subject: marketing }).query(api.presence.listTeam, {})).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
  });
});
