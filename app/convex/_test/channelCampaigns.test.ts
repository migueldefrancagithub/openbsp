import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { deriveCampaignRates, emptyCampaignStats, transitionStats } from "../lib/campaignStats";
import { renderCampaignText } from "../lib/channelCampaignEngine";
import { templateBodyVariableCount } from "../channelCampaigns";
import { encryptSecret } from "../lib/secrets";

const previousEnv = {
  key: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1,
  siteUrl: process.env.SITE_URL,
};
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "e".repeat(64);

// Fake timers keep convex-test's background scheduler idle so every engine
// step (materialize → continue → dispatch → settle → finalize) is driven
// explicitly and deterministically by the test.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (previousEnv.siteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousEnv.siteUrl;
});

afterAll(() => {
  if (previousEnv.key === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
  else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previousEnv.key;
});

const ALLOWED = "258840000099";
const NOT_ALLOWED = "258840000011";
const DND_KEY = "258840000022";
const LOST_KEY = "258840000033";

async function seed(t: ReturnType<typeof convexTest>) {
  const base = await t.run(async (ctx) => {
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
    return { userId, tenantId, memberId };
  });
  const pending = await t
    .withIdentity({ subject: base.userId })
    .mutation(api.iaSolutionHub.createPendingChannel, { displayName: "Piloto" });
  const token = await encryptSecret("hub-token");
  const hook = await encryptSecret("hub-secret");
  await t.mutation(internal.iaSolutionHub._configureConnection, {
    tenantId: base.tenantId,
    memberId: base.memberId,
    channelId: pending.channelId,
    externalChannelId: "hub-channel-camp",
    displayName: "Piloto",
    phoneNumber: "258840000001",
    wabaId: "waba-camp",
    outboundAllowlist: [ALLOWED, DND_KEY, LOST_KEY],
    accessTokenCiphertext: token.ciphertext,
    accessTokenKeyVersion: token.keyVersion,
    webhookSecretCiphertext: hook.ciphertext,
    webhookSecretKeyVersion: hook.keyVersion,
    encryptedAt: Date.now(),
    healthStatus: "GREEN",
  });
  const channelId = pending.channelId;
  const now = Date.now();
  const templateId = await t.run(async (ctx) =>
    await ctx.db.insert("channelTemplates", {
      tenantId: base.tenantId,
      channelId,
      name: "lembrete_consulta",
      languageCode: "pt_PT",
      category: "MARKETING",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Olá {{1}}, temos vagas esta semana: {{2}}" }],
      syncedAt: now,
      updatedAt: now,
    }),
  );
  const threads: Record<string, Id<"channelThreads">> = {};
  await t.run(async (ctx) => {
    const make = async (
      threadKey: string,
      extra: Partial<Doc<"channelThreads">>,
      displayName: string,
    ) => {
      const identityId = await ctx.db.insert("channelIdentities", {
        tenantId: base.tenantId,
        channelId,
        providerScopedId: threadKey,
        phone: threadKey,
        displayName,
        createdAt: now,
        updatedAt: now,
      });
      const threadId = await ctx.db.insert("channelThreads", {
        tenantId: base.tenantId,
        channelId,
        threadKey,
        identityId,
        lastEventAt: now - 60_000,
        lastEventKind: "message.text",
        unreadCount: 0,
        leadStatus: "interested",
        serviceWindowExpiresAt: now + 6 * 60 * 60 * 1000,
        createdAt: now - 60_000,
        updatedAt: now - 60_000,
        ...extra,
      });
      await ctx.db.insert("channelEvents", {
        tenantId: base.tenantId,
        channelId,
        eventKey: `in:${threadKey}`,
        eventKind: "message.text",
        direction: "incoming",
        threadKey,
        payload: { text: "Olá" },
        rawPayload: "{}",
        rawBodySha256: "sha",
        status: "processed",
        attempts: 1,
        receivedAt: now - 60_000,
      });
      threads[threadKey] = threadId;
    };
    await make(ALLOWED, {}, "Ana Maria");
    await make(NOT_ALLOWED, {}, "Bruno");
    await make(DND_KEY, { dnd: true }, "Carla");
    await make(LOST_KEY, { leadStatus: "lost" }, "Dino");
  });
  return { ...base, channelId, templateId, threads };
}

async function drain(t: ReturnType<typeof convexTest>, campaignId: Id<"campaigns">) {
  for (let i = 0; i < 20; i += 1) {
    const result = await t.mutation(internal.channelCampaigns._materializePage, { campaignId });
    if (result.done) return;
  }
  throw new Error("materialization did not finish");
}

describe("channel campaigns", () => {
  it("derives funnel rates that never exceed 100%", () => {
    let stats = emptyCampaignStats();
    stats = transitionStats(stats, null, "pending");
    stats = transitionStats(stats, "pending", "queued");
    stats = transitionStats(stats, "queued", "sent");
    stats = transitionStats(stats, null, "skipped");
    stats.replied = 3; // corrupted counter must still clamp
    const rates = deriveCampaignRates(stats);
    expect(rates.sent).toBe(1);
    expect(rates.replyRate).toBe(1);
    expect(rates.deliveryRate).toBe(0);
    expect(rates.skipped).toBe(1);
    expect(templateBodyVariableCount([{ type: "BODY", text: "Olá {{1}} e {{2}}" }])).toBe(2);
    expect(templateBodyVariableCount([{ type: "HEADER", text: "{{1}}" }])).toBe(0);
    expect(renderCampaignText("Olá {{nome}}, tudo bem?", "Ana")).toBe("Olá Ana, tudo bem?");
  });

  it("materializes an audience with pilot blocks persisted as skipped rows", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asOwner = t.withIdentity({ subject: s.userId });

    const preview = await asOwner.query(api.channelCampaigns.previewAudience, {
      channelId: s.channelId,
      audience: { leadStatuses: ["interested", "lost"] },
    });
    expect(preview).toMatchObject({ matched: 4, eligible: 1, pilotReady: false });
    expect(preview.blocked).toMatchObject({ RECIPIENT_NOT_ALLOWLISTED: 1, DND: 1, LOST: 1 });

    const campaignId = await asOwner.mutation(api.channelCampaigns.create, {
      channelId: s.channelId,
      name: "Vagas da semana",
      kind: "channel_template",
      channelTemplateId: s.templateId,
      variableBindings: [
        { index: 1, source: "first_name", value: "paciente" },
        { index: 2, source: "tracked_link", value: "https://clinica.example/agenda" },
      ],
      audience: { leadStatuses: ["interested", "lost"] },
      clientNonce: "n1",
    });
    // Idempotent create with the same nonce.
    expect(
      await asOwner.mutation(api.channelCampaigns.create, {
        channelId: s.channelId,
        name: "Vagas da semana",
        kind: "channel_template",
        channelTemplateId: s.templateId,
        variableBindings: [
          { index: 1, source: "first_name" },
          { index: 2, source: "tracked_link", value: "https://clinica.example/agenda" },
        ],
        audience: { leadStatuses: ["interested"] },
        clientNonce: "n1",
      }),
    ).toBe(campaignId);

    await drain(t, campaignId);
    // Running materialization twice inserts nothing new.
    await t.run(async (ctx) => {
      await ctx.db.patch(campaignId, { audienceStatus: "materializing", audienceCursor: undefined });
    });
    await drain(t, campaignId);

    const detail = await asOwner.query(api.channelCampaigns.get, { campaignId });
    expect(detail.campaign.audienceStatus).toBe("ready");
    expect(detail.audienceSummary).toMatchObject({ matched: 4, eligible: 1 });
    expect(detail.stats.total).toBe(4);
    expect(detail.stats.byStatus).toMatchObject({ pending: 1, skipped: 3 });
    const rows = await t.run(async (ctx) =>
      await ctx.db.query("campaignRecipients").collect(),
    );
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.threadKey === NOT_ALLOWED)).toMatchObject({
      status: "skipped",
      failureCode: "RECIPIENT_NOT_ALLOWLISTED",
    });

    // Launch is gated on consent attestation and on the pilot being ready.
    await expect(
      asOwner.mutation(api.channelCampaigns.launch, { campaignId, attestConsent: false }),
    ).rejects.toThrow(/CAMPAIGN_CONSENT_ATTESTATION_REQUIRED/);
    await expect(
      asOwner.mutation(api.channelCampaigns.launch, { campaignId, attestConsent: true }),
    ).rejects.toThrow(/HUB_PILOT_KILL_SWITCH_ACTIVE/);
  });

  it("sends through the guarded outbox, attributes replies and clicks, and completes", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asOwner = t.withIdentity({ subject: s.userId });
    await t.run(async (ctx) => {
      await ctx.db.patch(s.channelId, {
        status: "active",
        webhookStatus: "verified",
        sendMode: "allowlist",
        connectionState: "allowlist_only",
      });
    });
    process.env.SITE_URL = "https://app.example";
    const campaignId = await asOwner.mutation(api.channelCampaigns.create, {
      channelId: s.channelId,
      name: "Texto rápido",
      kind: "channel_text",
      messageText: "Olá {{nome}}, ainda quer marcar?",
      audience: { threadKeys: [ALLOWED, NOT_ALLOWED] },
    });
    await drain(t, campaignId);
    const launched = await asOwner.mutation(api.channelCampaigns.launch, { campaignId, attestConsent: true });
    expect(launched).toEqual({ status: "running", eligible: 1 });

    const batch = await t.mutation(internal.channelCampaigns._continue, { campaignId });
    expect(batch).toEqual({ queued: 1, pendingRemaining: false });
    const queued = await t.run(async (ctx) =>
      (await ctx.db.query("campaignRecipients").collect()).find((r) => r.status === "queued")!,
    );
    const target = await t.query(internal.outboundJobs.loadJob, {
      job: { kind: "campaign_recipient", recipientId: queued._id },
    });
    expect(target).toMatchObject({
      channelId: s.channelId,
      threadKey: ALLOWED,
      clientNonce: `campaign:${campaignId}:${queued._id}`,
      messageKind: "text",
      payload: { text: "Olá Ana, ainda quer marcar?" },
    });

    let sends = 0;
    const sentTo: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith("/messages/text")) {
        sends += 1;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        sentTo.push(JSON.stringify(body));
        return Response.json({ success: true, data: { messageId: "wamid.campaign.1" } });
      }
      return Response.json({ success: false, message: "unexpected route" });
    });
    await t.action(internal.iaSolutionHub.dispatchOutboundJob, {
      job: { kind: "campaign_recipient", recipientId: queued._id },
    });
    // Replaying the same job is a no-op (recipient no longer queued).
    await t.action(internal.iaSolutionHub.dispatchOutboundJob, {
      job: { kind: "campaign_recipient", recipientId: queued._id },
    });
    expect(sends).toBe(1);
    expect(sentTo[0]).toContain(ALLOWED);

    const afterSend = await t.run(async (ctx) => ({
      recipient: (await ctx.db.get(queued._id)) as Doc<"campaignRecipients">,
      outbox: await ctx.db.query("channelOutbox").collect(),
    }));
    expect(afterSend.recipient).toMatchObject({ status: "sent", providerMessageId: "wamid.campaign.1" });
    expect(afterSend.outbox).toHaveLength(1);
    expect(afterSend.outbox[0].businessKey).toBe(`hub:text:campaign:${campaignId}:${queued._id}`);

    // Inbound reply → replied (once), and the thread gets its origin campaign.
    const replyPayload = {
      contacts: [{ profile: { name: "Ana Maria" }, wa_id: ALLOWED }],
      messages: [
        {
          from: ALLOWED,
          id: "wamid.reply.1",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "Sim, quero" },
        },
      ],
    };
    await t.mutation(internal.iaSolutionHub.ingestWebhookEvents, {
      channelId: s.channelId,
      rawPayload: JSON.stringify(replyPayload),
      rawBodySha256: "sha-reply",
      events: normalizeWebhook(replyPayload, "sha-reply"),
    });
    const afterReply = await t.run(async (ctx) => ({
      recipient: (await ctx.db.get(queued._id)) as Doc<"campaignRecipients">,
      thread: (await ctx.db.get(s.threads[ALLOWED])) as Doc<"channelThreads">,
      campaign: (await ctx.db.get(campaignId)) as Doc<"campaigns">,
    }));
    expect(afterReply.recipient.status).toBe("replied");
    expect(afterReply.recipient.repliedAt).toBeDefined();
    expect(afterReply.thread.originCampaignId).toBe(campaignId);
    expect(afterReply.campaign.stats).toMatchObject({ replied: 1 });

    // Manual conversion from the inbox attributes to the same send.
    const converted = await asOwner.mutation(api.channelCampaigns.recordConversion, {
      threadId: s.threads[ALLOWED],
      label: "Marcação por telefone",
    });
    expect(converted).toBe(queued._id);
    expect(
      await asOwner.mutation(api.channelCampaigns.recordConversion, {
        threadId: s.threads[ALLOWED],
        label: "Outra vez",
      }),
    ).toBe(queued._id);

    const final = await t.mutation(internal.channelCampaigns._finalize, { campaignId });
    expect(final).toEqual({ completed: true, waiting: false });
    const detail = await asOwner.query(api.channelCampaigns.get, { campaignId });
    expect(detail.campaign.status).toBe("completed");
    expect(detail.campaign.rates).toMatchObject({ sent: 1, replied: 1, converted: 1, skipped: 1 });
    expect(detail.campaign.rates.replyRate).toBeLessThanOrEqual(1);
    expect(detail.stats.converted).toBe(1);
  });

  it("retries rate limits, fails definitively on pilot gates and auto-pauses on failure rate", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asOwner = t.withIdentity({ subject: s.userId });
    await t.run(async (ctx) => {
      await ctx.db.patch(s.channelId, {
        status: "active",
        webhookStatus: "verified",
        sendMode: "allowlist",
        connectionState: "allowlist_only",
      });
    });
    const campaignId = await asOwner.mutation(api.channelCampaigns.create, {
      channelId: s.channelId,
      name: "Retries",
      kind: "channel_text",
      messageText: "Olá",
      audience: { threadKeys: [ALLOWED] },
    });
    await drain(t, campaignId);
    await asOwner.mutation(api.channelCampaigns.launch, { campaignId, attestConsent: true });
    await t.mutation(internal.channelCampaigns._continue, { campaignId });
    const recipientId = await t.run(async (ctx) =>
      (await ctx.db.query("campaignRecipients").collect())[0]._id,
    );

    await t.mutation(internal.outboundJobs.settleJob, {
      job: { kind: "campaign_recipient", recipientId },
      status: "failed",
      failureReason: JSON.stringify({ code: "CHANNEL_RATE_LIMITED", retryAfterMs: 5000 }),
    });
    let recipient = await t.run(async (ctx) => (await ctx.db.get(recipientId)) as Doc<"campaignRecipients">);
    expect(recipient.status).toBe("pending");
    expect(recipient.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(recipient.dispatchAttempts).toBe(0);

    // Not due yet → batch queues nothing; finalize waits.
    expect(await t.mutation(internal.channelCampaigns._continue, { campaignId })).toEqual({ queued: 0, pendingRemaining: true });
    expect((await t.mutation(internal.channelCampaigns._finalize, { campaignId })).waiting).toBe(true);
    await t.run(async (ctx) => {
      await ctx.db.patch(recipientId, { nextAttemptAt: Date.now() - 1 });
    });
    expect(await t.mutation(internal.channelCampaigns._continue, { campaignId })).toEqual({ queued: 1, pendingRemaining: false });

    // A transient provider failure schedules a backoff retry.
    await t.mutation(internal.outboundJobs.settleJob, {
      job: { kind: "campaign_recipient", recipientId },
      status: "failed",
      failureReason: "fetch failed: ECONNRESET",
    });
    recipient = await t.run(async (ctx) => (await ctx.db.get(recipientId)) as Doc<"campaignRecipients">);
    expect(recipient.status).toBe("pending");
    expect(recipient.dispatchAttempts).toBe(1);
    await t.run(async (ctx) => {
      await ctx.db.patch(recipientId, { nextAttemptAt: Date.now() - 1 });
    });
    await t.mutation(internal.channelCampaigns._continue, { campaignId });

    // A definitive gate error fails the row with its code.
    await t.mutation(internal.outboundJobs.settleJob, {
      job: { kind: "campaign_recipient", recipientId },
      status: "failed",
      failureReason: JSON.stringify({ code: "SERVICE_WINDOW_EXPIRED" }),
    });
    recipient = await t.run(async (ctx) => (await ctx.db.get(recipientId)) as Doc<"campaignRecipients">);
    expect(recipient).toMatchObject({ status: "failed", failureCode: "SERVICE_WINDOW_EXPIRED" });
    const detail = await asOwner.query(api.channelCampaigns.get, { campaignId });
    expect(detail.stats.byStatus.failed).toBe(1);
    expect(detail.stats.rateLimited).toBe(1);

    // Failure-rate auto pause: 10 attempted with ≥20% failed.
    await t.run(async (ctx) => {
      const campaign = (await ctx.db.get(campaignId)) as Doc<"campaigns">;
      await ctx.db.patch(campaignId, {
        stats: {
          ...(campaign.stats as object),
          byStatus: { ...(campaign.stats as { byStatus: object }).byStatus, sent: 8, failed: 1 },
        },
      });
      const now = Date.now();
      await ctx.db.insert("campaignRecipients", {
        tenantId: s.tenantId,
        campaignId,
        contactId: recipient.contactId,
        channelId: s.channelId,
        threadId: s.threads[NOT_ALLOWED],
        threadKey: NOT_ALLOWED,
        identityKind: "phone",
        identityValue: NOT_ALLOWED,
        status: "queued",
        dispatchAttempts: 1,
        createdAt: now,
        updatedAt: now,
      });
    });
    const second = await t.run(async (ctx) =>
      (await ctx.db.query("campaignRecipients").collect()).find((r) => r.threadKey === NOT_ALLOWED)!,
    );
    await t.mutation(internal.outboundJobs.settleJob, {
      job: { kind: "campaign_recipient", recipientId: second._id },
      status: "failed",
      failureReason: JSON.stringify({ code: "RECIPIENT_NOT_ALLOWLISTED" }),
    });
    const paused = await asOwner.query(api.channelCampaigns.get, { campaignId });
    expect(paused.campaign.status).toBe("paused");
    expect(paused.campaign.pauseReason).toBe("failure_rate");
    const alerts = await asOwner.query(api.ops.listAlerts, {});
    expect(alerts.some((a) => a.kind === "campaign.auto_paused")).toBe(true);

    // Resume re-enters the loop; cancel skips what is left.
    await asOwner.mutation(api.channelCampaigns.resume, { campaignId });
    await asOwner.mutation(api.channelCampaigns.cancel, { campaignId });
    await t.mutation(internal.channelCampaigns._cancelPending, { campaignId });
    const cancelled = await asOwner.query(api.channelCampaigns.get, { campaignId });
    expect(cancelled.campaign.status).toBe("cancelled");
  });

  it("isolates campaigns per tenant and enforces capabilities", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asOwner = t.withIdentity({ subject: s.userId });
    const campaignId = await asOwner.mutation(api.channelCampaigns.create, {
      channelId: s.channelId,
      name: "Privada",
      kind: "channel_text",
      messageText: "Olá",
      audience: { threadKeys: [ALLOWED] },
    });
    const other = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Other" });
      const tenantId = await ctx.db.insert("tenants", {
        name: "Other",
        vertical: "clinic",
        plan: "starter",
        settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
      return { userId };
    });
    await expect(
      t.withIdentity({ subject: other.userId }).query(api.channelCampaigns.get, { campaignId }),
    ).rejects.toThrow(/CROSS_TENANT_ACCESS|NOT_FOUND/);
    const agent = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Agent" });
      await ctx.db.insert("members", { tenantId: s.tenantId, userId, role: "agent", status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: s.tenantId, updatedAt: Date.now() });
      return { userId };
    });
    await expect(
      t.withIdentity({ subject: agent.userId }).mutation(api.channelCampaigns.create, {
        channelId: s.channelId,
        name: "Sem permissão",
        kind: "channel_text",
        messageText: "Olá",
        audience: {},
      }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    const list = await asOwner.query(api.channelCampaigns.list, { paginationOpts: { cursor: null, numItems: 10 } });
    expect(list.page.map((row) => row._id)).toEqual([campaignId]);
  });
});
