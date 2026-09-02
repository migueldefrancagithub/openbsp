import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeWebhook } from "../integrations/leoHub/webhook";

const TEST_PHONE = "258840000099";
const inboxApi = (api as any).inboxOperations;

async function seedTenant(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${name} Owner` });
    const tenantId = await ctx.db.insert("tenants", {
      name,
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: Date.now(),
    });
    return { userId, tenantId, memberId };
  });
}

async function seedChannel(
  t: ReturnType<typeof convexTest>,
  owner: { tenantId: Id<"tenants">; memberId: Id<"members"> },
  suffix: string,
) {
  return await t.mutation(internal.leoHubLab._upsertConnection, {
    tenantId: owner.tenantId,
    memberId: owner.memberId,
    publicId: `lab_${suffix.padEnd(24, "x")}`,
    externalChannelId: `hub-${suffix}`,
    displayName: `Clinic ${suffix}`,
    outboundAllowlist: [TEST_PHONE],
    accessTokenCiphertext: "ciphertext-token",
    accessTokenKeyVersion: 1,
    webhookSecretCiphertext: "ciphertext-webhook",
    webhookSecretKeyVersion: 1,
    encryptedAt: Date.now(),
    healthStatus: "GREEN",
  });
}

async function receiveMessage(
  t: ReturnType<typeof convexTest>,
  args: { channelId: Id<"channels">; phone: string; body: string },
) {
  const raw = JSON.stringify({
    contacts: [{ wa_id: args.phone, profile: { name: "Ana" } }],
    messages: [
      {
        id: `wamid.${args.phone}.${Date.now()}`,
        from: args.phone,
        type: "text",
        timestamp: "1788253200",
        text: { body: args.body },
      },
    ],
  });
  await t.mutation(internal.leoHubLab.ingestWebhookEvents, {
    channelId: args.channelId,
    rawPayload: raw,
    rawBodySha256: `sha-${args.phone}-${args.body}`,
    events: normalizeWebhook(JSON.parse(raw), `sha-${args.phone}-${args.body}`),
  });
}

describe("operational inbox", () => {
  it("keeps notes and reminders internal while updating the patient flow", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "Maputo Clinic");
    const { channelId } = await seedChannel(t, owner, "maputo");
    await receiveMessage(t, {
      channelId,
      phone: TEST_PHONE,
      body: "Quero marcar uma consulta",
    });
    const asOwner = t.withIdentity({ subject: owner.userId });
    const result = await asOwner.query(inboxApi.listThreads, {
      channelId,
      filter: "all",
      paginationOpts: { cursor: null, numItems: 50 },
    });
    expect(result.page).toHaveLength(1);
    const thread = result.page[0];

    const before = await t.run(async (ctx) => ({
      events: (await ctx.db.query("channelEvents").collect()).length,
      outbox: (await ctx.db.query("channelOutbox").collect()).length,
    }));

    await asOwner.mutation(inboxApi.updateThread, {
      threadId: thread._id,
      inboxStatus: "awaiting_team",
      starred: true,
      leadStatus: "wants_booking",
      nextStep: "Confirmar disponibilidade da agenda",
      nextStepDueAt: Date.now() + 60_000,
      automationMode: "human",
    });
    await asOwner.mutation(inboxApi.addInternalNote, {
      threadId: thread._id,
      body: "Validar o horario com a rececao.",
      mentionedMemberIds: [owner.memberId],
    });
    await asOwner.mutation(inboxApi.createReminder, {
      threadId: thread._id,
      note: "Retomar confirmacao",
      dueAt: Date.now() + 120_000,
    });

    const context = await asOwner.query(inboxApi.getPatientContext, {
      threadId: thread._id,
    });
    expect(context.notes).toHaveLength(1);
    expect(context.reminders).toHaveLength(1);
    expect(context.reminders[0].status).toBe("scheduled");

    const filtered = await asOwner.query(inboxApi.listThreads, {
      channelId,
      filter: "awaiting_team",
      paginationOpts: { cursor: null, numItems: 50 },
    });
    expect(filtered.page[0]).toMatchObject({
      starred: true,
      inboxStatus: "awaiting_team",
      leadStatus: "awaiting_human",
      automationMode: "human",
    });

    const after = await t.run(async (ctx) => ({
      events: (await ctx.db.query("channelEvents").collect()).length,
      outbox: (await ctx.db.query("channelOutbox").collect()).length,
    }));
    expect(after).toEqual(before);
  });

  it("rejects cross-tenant thread mutations", async () => {
    const t = convexTest(schema);
    const clinicA = await seedTenant(t, "Clinic A");
    const clinicB = await seedTenant(t, "Clinic B");
    const { channelId } = await seedChannel(t, clinicB, "clinic-b");
    await receiveMessage(t, {
      channelId,
      phone: TEST_PHONE,
      body: "Preciso de ajuda",
    });
    const foreignThreadId = await t.run(async (ctx) => {
      const [thread] = await ctx.db.query("channelThreads").collect();
      return thread._id;
    });

    await expect(
      t.withIdentity({ subject: clinicA.userId }).mutation(inboxApi.updateThread, {
        threadId: foreignThreadId,
        starred: true,
      }),
    ).rejects.toThrow();
  });
});

async function addMember(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  role: "admin" | "agent" | "marketing",
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${role} user` });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role,
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    return { userId, memberId };
  });
}

describe("inbox roles, intents and history", () => {
  it("enforces the capability matrix on thread updates", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "Clinic RBAC");
    const { channelId } = await seedChannel(t, owner, "rbac");
    const agent = await addMember(t, owner.tenantId, "agent");
    const marketing = await addMember(t, owner.tenantId, "marketing");
    await receiveMessage(t, { channelId, phone: TEST_PHONE, body: "Olá" });
    const threadId = await t.run(async (ctx) => {
      const [thread] = await ctx.db.query("channelThreads").collect();
      return thread._id;
    });
    const asAgent = t.withIdentity({ subject: agent.userId });
    const asMarketing = t.withIdentity({ subject: marketing.userId });

    await asAgent.mutation(inboxApi.updateThread, { threadId, responsibleMemberId: agent.memberId });
    await asAgent.mutation(inboxApi.updateThread, { threadId, leadStatus: "asked_price", intent: "price_request" });
    await expect(
      asAgent.mutation(inboxApi.updateThread, { threadId, responsibleMemberId: owner.memberId }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    await expect(
      asMarketing.mutation(inboxApi.updateThread, { threadId, starred: true }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    await expect(
      asMarketing.mutation(inboxApi.addInternalNote, { threadId, body: "x", mentionedMemberIds: [] }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);

    const thread = (await t.run(async (ctx) => await ctx.db.get(threadId)))!;
    expect(thread).toMatchObject({
      responsibleMemberId: agent.memberId,
      leadStatus: "asked_price",
      intent: "price_request",
      intentSource: "manual",
    });

    const mine = await asAgent.query(inboxApi.listThreads, {
      channelId,
      filter: "mine",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(mine.page.map((row: any) => row._id)).toEqual([threadId]);
    const notMine = await t.withIdentity({ subject: owner.userId }).query(inboxApi.listThreads, {
      channelId,
      filter: "mine",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(notMine.page).toHaveLength(0);
  });

  it("records before/after in the history and emits lead system events", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "Clinic History");
    const { channelId } = await seedChannel(t, owner, "history");
    await receiveMessage(t, { channelId, phone: TEST_PHONE, body: "Quero marcar" });
    const threadId = await t.run(async (ctx) => {
      const [thread] = await ctx.db.query("channelThreads").collect();
      return thread._id;
    });
    const asOwner = t.withIdentity({ subject: owner.userId });
    await asOwner.mutation(inboxApi.updateThread, {
      threadId,
      leadStatus: "booked",
      nextStepDueAt: Date.now() + 3_600_000,
    });
    await asOwner.mutation(inboxApi.updateThread, { threadId, clearNextStepDueAt: true });
    const history = await asOwner.query(inboxApi.listThreadHistory, { threadId });
    expect(history.length).toBeGreaterThanOrEqual(2);
    const first = history[history.length - 1];
    expect(first.action).toBe("inbox.thread.updated");
    expect(first.payload.changed.leadStatus).toEqual({ from: "wants_booking", to: "booked" });
    const thread = (await t.run(async (ctx) => await ctx.db.get(threadId)))!;
    expect(thread.nextStepDueAt).toBeUndefined();
    const systemEvents = await t.run(async (ctx) =>
      await ctx.db.query("threadSystemEvents").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect(),
    );
    expect(systemEvents.map((row) => row.kind)).toContain("lead.status_changed");
  });
});
