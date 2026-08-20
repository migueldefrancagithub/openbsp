import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";

async function seedTenant(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${name} owner` });
    const tenantId = await ctx.db.insert("tenants", {
      name,
      vertical: "services",
      plan: "starter",
      settings: {
        defaultLocale: "pt-MZ",
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

async function seedConfiguredChannel(
  t: ReturnType<typeof convexTest>,
  owner: Awaited<ReturnType<typeof seedTenant>>,
  suffix: string,
) {
  const pending = await t
    .withIdentity({ subject: owner.userId })
    .mutation(api.iaSolutionHub.createPendingChannel, {
      displayName: `OpenBSP ${suffix}`,
    });
  await t.mutation(internal.iaSolutionHub._configureConnection, {
    tenantId: owner.tenantId,
    memberId: owner.memberId,
    channelId: pending.channelId,
    externalChannelId: `hub-channel-${suffix}`,
    displayName: `OpenBSP ${suffix}`,
    phoneNumber: `25884${suffix.padStart(7, "0")}`,
    wabaId: `waba-${suffix}`,
    outboundAllowlist: ["258840000099"],
    accessTokenCiphertext: `ciphertext-token-${suffix}`,
    accessTokenKeyVersion: 1,
    webhookSecretCiphertext: `ciphertext-hook-${suffix}`,
    webhookSecretKeyVersion: 1,
    encryptedAt: Date.now(),
    healthStatus: "GREEN",
  });
  return pending.channelId;
}

function textPayload(wamid: string, text = "Olá") {
  return {
    contacts: [{ profile: { name: "Test User" }, wa_id: "258840000099" }],
    messages: [
      {
        from: "258840000099",
        id: wamid,
        timestamp: "1787300000",
        type: "text",
        text: { body: text },
      },
    ],
  };
}

async function ingest(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"channels">,
  payload: unknown,
  sha: string,
) {
  return await t.mutation(internal.iaSolutionHub.ingestWebhookEvents, {
    channelId,
    rawPayload: JSON.stringify(payload),
    rawBodySha256: sha,
    events: normalizeWebhook(payload, sha),
  });
}

describe("isolated iaSolution Hub channel core", () => {
  it("reserves a pending channel without secrets, number, webhook or outbound", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP");
    const pending = await t
      .withIdentity({ subject: owner.userId })
      .mutation(api.iaSolutionHub.createPendingChannel, {
        displayName: "OpenBSP WhatsApp",
      });

    const state = await t.run(async (ctx) => ({
      channel: await ctx.db.get(pending.channelId),
      secrets: await ctx.db.query("channelSecrets").collect(),
    }));
    expect(state.channel).toMatchObject({
      provider: "iasolution_hub",
      status: "pending",
      connectionState: "pending_number",
      webhookStatus: "disabled",
      sendMode: "disabled",
      outboundAllowlist: [],
    });
    expect(state.channel?.phoneNumber).toBeUndefined();
    expect(state.secrets).toEqual([]);
  });

  it("scopes the same WAMID independently to each tenant and channel", async () => {
    const t = convexTest(schema);
    const ownerA = await seedTenant(t, "Tenant A");
    const ownerB = await seedTenant(t, "Tenant B");
    const channelA = await seedConfiguredChannel(t, ownerA, "1");
    const channelB = await seedConfiguredChannel(t, ownerB, "2");
    const payload = textPayload("wamid.same-provider-id");

    expect(await ingest(t, channelA, payload, "sha-a")).toEqual({
      accepted: 1,
      duplicates: 0,
      failed: 0,
    });
    expect(await ingest(t, channelB, payload, "sha-b")).toEqual({
      accepted: 1,
      duplicates: 0,
      failed: 0,
    });
    expect(await ingest(t, channelA, payload, "sha-a-retry")).toEqual({
      accepted: 0,
      duplicates: 1,
      failed: 0,
    });

    const rows = await t.run(async (ctx) => ({
      events: await ctx.db.query("channelEvents").collect(),
      threads: await ctx.db.query("channelThreads").collect(),
    }));
    expect(rows.events).toHaveLength(2);
    expect(rows.threads).toHaveLength(2);
    expect(new Set(rows.events.map((row) => row.tenantId))).toEqual(
      new Set([ownerA.tenantId, ownerB.tenantId]),
    );
  });

  it("requires verified webhook, allowlist mode, service window and exact provider", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP");
    const channelId = await seedConfiguredChannel(t, owner, "3");

    await expect(
      t.mutation(internal.iaSolutionHub._claimOutbox, {
        tenantId: owner.tenantId,
        memberId: owner.memberId,
        channelId,
        threadKey: "258840000099",
        businessKey: "hub:text:before-webhook",
        messageKind: "text",
        payload: { text: "blocked" },
      }),
    ).rejects.toThrow(/HUB_PILOT_KILL_SWITCH_ACTIVE/);

    await ingest(t, channelId, textPayload("wamid.window"), "sha-window");
    await t
      .withIdentity({ subject: owner.userId })
      .mutation(api.iaSolutionHub.setPilotMode, { channelId, enabled: true });

    const first = await t.mutation(internal.iaSolutionHub._claimOutbox, {
      tenantId: owner.tenantId,
      memberId: owner.memberId,
      channelId,
      threadKey: "258840000099",
      businessKey: "hub:text:nonce",
      messageKind: "text",
      payload: { text: "allowed" },
    });
    const replay = await t.mutation(internal.iaSolutionHub._claimOutbox, {
      tenantId: owner.tenantId,
      memberId: owner.memberId,
      channelId,
      threadKey: "258840000099",
      businessKey: "hub:text:nonce",
      messageKind: "text",
      payload: { text: "allowed" },
    });
    expect(first).toMatchObject({
      dispatch: true,
      recipient: "258840000099",
    });
    expect(replay).toMatchObject({
      outboxId: first.outboxId,
      dispatch: false,
    });

    const labChannel = await t.run(async (ctx) =>
      ctx.db.insert("channels", {
        tenantId: owner.tenantId,
        publicId: "lab_abcdefghijklmnopqrstuvwx",
        kind: "whatsapp",
        provider: "lab_bridge",
        externalAccountId: "alfapay-must-not-fallback",
        displayName: "Legacy read only",
        status: "active",
        sendMode: "allowlist",
        outboundAllowlist: ["258840000099"],
        createdBy: owner.memberId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      t.mutation(internal.iaSolutionHub._claimOutbox, {
        tenantId: owner.tenantId,
        memberId: owner.memberId,
        channelId: labChannel,
        threadKey: "258840000099",
        businessKey: "hub:text:no-fallback",
        messageKind: "text",
        payload: { text: "never sent" },
      }),
    ).rejects.toThrow(/HUB_CHANNEL_NOT_FOUND/);
  });

  it("fails nfm_reply closed when no same-channel Flow context exists", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP");
    const channelId = await seedConfiguredChannel(t, owner, "4");
    const payload = {
      contacts: [{ wa_id: "258840000099" }],
      messages: [
        {
          from: "258840000099",
          id: "wamid.flow.reply",
          type: "interactive",
          context: { id: "wamid.flow.original" },
          interactive: {
            type: "nfm_reply",
            nfm_reply: {
              response_json: JSON.stringify({
                flow_token: "flow-token-unknown",
                answer: "yes",
              }),
            },
          },
        },
      ],
    };

    expect(await ingest(t, channelId, payload, "sha-flow-missing")).toEqual({
      accepted: 1,
      duplicates: 0,
      failed: 1,
    });
    const state = await t.run(async (ctx) => ({
      event: await ctx.db.query("channelEvents").first(),
      threads: await ctx.db.query("channelThreads").collect(),
    }));
    expect(state.event).toMatchObject({
      eventKind: "message.nfm_reply",
      status: "failed",
      lastError: "flow_reply_context_not_found",
    });
    expect(state.threads).toEqual([]);
  });

  it("keeps Flow drafts channel-scoped and rejects AYAmed domain markers", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP");
    const channelId = await seedConfiguredChannel(t, owner, "5");
    const validFlow = {
      version: "7.3",
      screens: [
        {
          id: "LEAD",
          title: "Qualificação",
          terminal: true,
          layout: { type: "SingleColumnLayout", children: [] },
        },
      ],
    };
    const draftId = await t
      .withIdentity({ subject: owner.userId })
      .mutation(api.iaSolutionHub.saveFlowDraft, {
        channelId,
        name: "openbsp_lead_qualification",
        categories: ["LEAD_GENERATION"],
        flowJson: validFlow,
      });
    const drafts = await t
      .withIdentity({ subject: owner.userId })
      .query(api.iaSolutionHub.listFlowDrafts, { channelId });
    expect(drafts).toMatchObject([
      { _id: draftId, name: "openbsp_lead_qualification", status: "draft" },
    ]);

    await expect(
      t.withIdentity({ subject: owner.userId }).mutation(
        api.iaSolutionHub.saveFlowDraft,
        {
          channelId,
          name: "openbsp_forbidden_copy",
          categories: ["OTHER"],
          flowJson: {
            ...validFlow,
            screens: [{ ...validFlow.screens[0], title: "AYAmed paciente" }],
          },
        },
      ),
    ).rejects.toThrow(/FORBIDDEN_FLOW_DOMAIN_MARKER/);
  });

  it("persists the returned WAMID and advances delivery receipts monotonically", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP");
    const channelId = await seedConfiguredChannel(t, owner, "6");
    await ingest(t, channelId, textPayload("wamid.inbound.6"), "sha-in-6");
    await t
      .withIdentity({ subject: owner.userId })
      .mutation(api.iaSolutionHub.setPilotMode, { channelId, enabled: true });
    const claim = await t.mutation(internal.iaSolutionHub._claimOutbox, {
      tenantId: owner.tenantId,
      memberId: owner.memberId,
      channelId,
      threadKey: "258840000099",
      businessKey: "hub:text:receipt",
      messageKind: "text",
      payload: { text: "Resposta" },
      replyToProviderMessageId: "wamid.inbound.6",
    });
    await t.mutation(internal.iaSolutionHub._settleOutbox, {
      outboxId: claim.outboxId,
      status: "accepted",
      providerMessageId: "wamid.outbound.6",
    });
    const statusPayload = {
      statuses: [
        {
          id: "wamid.outbound.6",
          status: "delivered",
          recipient_id: "258840000099",
        },
      ],
    };
    await ingest(t, channelId, statusPayload, "sha-status-6");
    const row = await t.run(async (ctx) => ctx.db.get(claim.outboxId));
    expect(row).toMatchObject({
      providerMessageId: "wamid.outbound.6",
      status: "delivered",
      replyToProviderMessageId: "wamid.inbound.6",
    });

    await ingest(
      t,
      channelId,
      {
        statuses: [
          {
            id: "wamid.outbound.6",
            status: "sent",
            recipient_id: "258840000099",
          },
        ],
      },
      "sha-status-late-6",
    );
    const afterLate = await t.run(async (ctx) => ctx.db.get(claim.outboxId));
    expect(afterLate?.status).toBe("delivered");
  });

  it("sends only templates approved in the same channel catalog", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP");
    const channelId = await seedConfiguredChannel(t, owner, "7");
    await ingest(t, channelId, textPayload("wamid.inbound.7"), "sha-in-7");
    await t
      .withIdentity({ subject: owner.userId })
      .mutation(api.iaSolutionHub.setPilotMode, { channelId, enabled: true });

    await expect(
      t.mutation(internal.iaSolutionHub._claimOutbox, {
        tenantId: owner.tenantId,
        memberId: owner.memberId,
        channelId,
        threadKey: "258840000099",
        businessKey: "hub:template:not-synced",
        messageKind: "template",
        payload: { templateName: "openbsp_welcome", languageCode: "pt_MZ" },
      }),
    ).rejects.toThrow(/CHANNEL_TEMPLATE_NOT_FOUND/);

    await t.run(async (ctx) => {
      await ctx.db.insert("channelTemplates", {
        tenantId: owner.tenantId,
        channelId,
        name: "openbsp_welcome",
        languageCode: "pt_MZ",
        status: "APPROVED",
        syncedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const claim = await t.mutation(internal.iaSolutionHub._claimOutbox, {
      tenantId: owner.tenantId,
      memberId: owner.memberId,
      channelId,
      threadKey: "258840000099",
      businessKey: "hub:template:approved",
      messageKind: "template",
      payload: { templateName: "openbsp_welcome", languageCode: "pt_MZ" },
    });
    expect(claim.dispatch).toBe(true);
  });

  it("rate-limits outbound independently per channel", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP");
    const channelA = await seedConfiguredChannel(t, owner, "8");
    const channelB = await seedConfiguredChannel(t, owner, "9");
    for (let index = 0; index < 20; index += 1) {
      const result = await t.mutation(
        internal.iaSolutionHub._consumeRateLimit,
        {
          tenantId: owner.tenantId,
          channelId: channelA,
          scope: "outbound",
        },
      );
      expect(result.remaining).toBe(19 - index);
    }
    await expect(
      t.mutation(internal.iaSolutionHub._consumeRateLimit, {
        tenantId: owner.tenantId,
        channelId: channelA,
        scope: "outbound",
      }),
    ).rejects.toThrow(/CHANNEL_RATE_LIMITED/);

    const other = await t.mutation(
      internal.iaSolutionHub._consumeRateLimit,
      {
        tenantId: owner.tenantId,
        channelId: channelB,
        scope: "outbound",
      },
    );
    expect(other.remaining).toBe(19);
  });
});
