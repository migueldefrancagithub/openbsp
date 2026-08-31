import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import { encryptSecret } from "../lib/secrets";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
        timestamp: String(Math.floor(Date.now() / 1000)),
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
      operationalTerritory: "openbsp",
      status: "pending",
      connectionState: "pending_number",
      webhookStatus: "disabled",
      sendMode: "disabled",
      outboundAllowlist: [],
    });
    expect(state.channel?.phoneNumber).toBeUndefined();
    expect(state.secrets).toEqual([]);
  });

  it("hard-denies protected reserved identifiers before health or secret work", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP territory guard");
    const pending = await t
      .withIdentity({ subject: owner.userId })
      .mutation(api.iaSolutionHub.createPendingChannel, {
        displayName: "Future OpenBSP channel",
      });
    const previous = {
      channel: process.env.OPENBSP_PROTECTED_HUB_CHANNEL_IDS,
      phone: process.env.OPENBSP_PROTECTED_PHONE_NUMBERS,
      waba: process.env.OPENBSP_PROTECTED_WABA_IDS,
    };
    process.env.OPENBSP_PROTECTED_HUB_CHANNEL_IDS = "reserved-channel";
    process.env.OPENBSP_PROTECTED_PHONE_NUMBERS = "258840000086";
    process.env.OPENBSP_PROTECTED_WABA_IDS = "reserved-waba";
    try {
      await expect(
        t.withIdentity({ subject: owner.userId }).action(
          api.iaSolutionHub.configureChannel,
          {
            channelId: pending.channelId,
            externalChannelId: "reserved-channel",
            displayName: "Reserved operation",
            phoneNumber: "258840000086",
            wabaId: "reserved-waba",
            channelToken: "token-long-enough-for-validation",
            webhookSecret: "webhook-secret-long-enough-for-validation",
            outboundAllowlist: ["258840000099"],
          },
        ),
      ).rejects.toThrow(/PROTECTED_CHANNEL_HARD_DENY/);
    } finally {
      if (previous.channel === undefined) {
        delete process.env.OPENBSP_PROTECTED_HUB_CHANNEL_IDS;
      } else {
        process.env.OPENBSP_PROTECTED_HUB_CHANNEL_IDS = previous.channel;
      }
      if (previous.phone === undefined) {
        delete process.env.OPENBSP_PROTECTED_PHONE_NUMBERS;
      } else {
        process.env.OPENBSP_PROTECTED_PHONE_NUMBERS = previous.phone;
      }
      if (previous.waba === undefined) {
        delete process.env.OPENBSP_PROTECTED_WABA_IDS;
      } else {
        process.env.OPENBSP_PROTECTED_WABA_IDS = previous.waba;
      }
    }
  });

  it("configures from the nested Hub phone info shape", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP nested Hub");
    const pending = await t
      .withIdentity({ subject: owner.userId })
      .mutation(api.iaSolutionHub.createPendingChannel, {
        displayName: "OpenBSP WhatsApp",
      });
    const previous = {
      allowedChannel: process.env.OPENBSP_ALLOWED_HUB_CHANNEL_IDS,
      allowedPhone: process.env.OPENBSP_ALLOWED_PHONE_NUMBERS,
      allowedWaba: process.env.OPENBSP_ALLOWED_WABA_IDS,
      encryptionKey: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1,
    };
    process.env.OPENBSP_ALLOWED_HUB_CHANNEL_IDS = "hub-nested-channel";
    process.env.OPENBSP_ALLOWED_PHONE_NUMBERS = "258840000098";
    process.env.OPENBSP_ALLOWED_WABA_IDS = "waba-nested";
    process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "c".repeat(64);
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.endsWith("/phone/info")) {
          return Response.json({
            success: true,
            data: {
              phone_number: {
                display_phone_number: "+258 84 000 0098",
                verified_name: "OpenBSP Lab",
                quality_rating: "GREEN",
                health_status: {
                  can_send_message: "AVAILABLE",
                  entities: [
                    { entity_type: "PHONE_NUMBER", id: "phone-nested" },
                    { entity_type: "WABA", id: "waba-nested" },
                  ],
                },
              },
            },
          });
        }
        if (url.endsWith("/phone/health")) {
          return Response.json({
            success: true,
            data: {
              health_status: {
                can_send_message: "AVAILABLE",
                entities: [
                  { entity_type: "PHONE_NUMBER", id: "phone-nested" },
                  { entity_type: "WABA", id: "waba-nested" },
                ],
              },
            },
          });
        }
        return Response.json({ success: false, message: "unexpected route" });
      },
    );

    try {
      const configured = await t.withIdentity({ subject: owner.userId }).action(
        api.iaSolutionHub.configureChannel,
        {
          channelId: pending.channelId,
          externalChannelId: "hub-nested-channel",
          displayName: "OpenBSP WhatsApp",
          phoneNumber: "258840000098",
          wabaId: "waba-nested",
          channelToken: "token-long-enough-for-validation",
          webhookSecret: "webhook-secret-long-enough-for-validation",
          outboundAllowlist: ["258840000099"],
        },
      );
      expect(configured).toMatchObject({
        channelId: pending.channelId,
        sendMode: "disabled",
        connectionState: "ready",
      });
      const channel = await t.run(async (ctx) =>
        ctx.db.get(pending.channelId),
      );
      expect(channel).toMatchObject({
        externalAccountId: "hub-nested-channel",
        phoneNumber: "258840000098",
        wabaId: "waba-nested",
        status: "active",
        webhookStatus: "pending",
        lastHealthStatus: "AVAILABLE",
      });
    } finally {
      if (previous.allowedChannel === undefined) {
        delete process.env.OPENBSP_ALLOWED_HUB_CHANNEL_IDS;
      } else {
        process.env.OPENBSP_ALLOWED_HUB_CHANNEL_IDS = previous.allowedChannel;
      }
      if (previous.allowedPhone === undefined) {
        delete process.env.OPENBSP_ALLOWED_PHONE_NUMBERS;
      } else {
        process.env.OPENBSP_ALLOWED_PHONE_NUMBERS = previous.allowedPhone;
      }
      if (previous.allowedWaba === undefined) {
        delete process.env.OPENBSP_ALLOWED_WABA_IDS;
      } else {
        process.env.OPENBSP_ALLOWED_WABA_IDS = previous.allowedWaba;
      }
      if (previous.encryptionKey === undefined) {
        delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
      } else {
        process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous.encryptionKey;
      }
    }
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

    const reservedChannel = await t.run(async (ctx) =>
      ctx.db.insert("channels", {
        tenantId: owner.tenantId,
        publicId: "hub_reservedxxxxxxxxxxxxxxxx",
        kind: "whatsapp",
        provider: "iasolution_hub",
        operationalTerritory: "cindy",
        externalAccountId: "reserved-operation-only",
        displayName: "Reserved operation",
        status: "active",
        sendMode: "allowlist",
        outboundAllowlist: ["258840000099"],
        connectionState: "allowlist_only",
        webhookStatus: "verified",
        createdBy: owner.memberId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      t.mutation(internal.iaSolutionHub._claimOutbox, {
        tenantId: owner.tenantId,
        memberId: owner.memberId,
        channelId: reservedChannel,
        threadKey: "258840000099",
        businessKey: "hub:text:reserved-hard-deny",
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

  it("keeps Flow drafts channel-scoped and rejects reserved domain markers", async () => {
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
            screens: [{ ...validFlow.screens[0], title: "reserved paciente" }],
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

  it("sends a micro campaign through the isolated Hub gates only", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP micro campaign");
    const previous = {
      encryptionKey: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1,
      hubBaseUrl: process.env.WHATSAPP_HUB_BASE_URL,
    };
    process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "d".repeat(64);
    process.env.WHATSAPP_HUB_BASE_URL = "https://hub.example";
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(input.toString()).toBe("https://hub.example/api/v1/messages/text");
        requests.push(JSON.parse(String(init?.body ?? "{}")));
        return Response.json({
          success: true,
          data: { message_id: `wamid.micro.${requests.length}` },
        });
      },
    );

    try {
      const token = await encryptSecret("hub-token");
      const hook = await encryptSecret("hub-secret");
      const now = Date.now();
      const channelId = await t.run(async (ctx) => {
        const channelId = await ctx.db.insert("channels", {
          tenantId: owner.tenantId,
          publicId: "hub_microcampaignxxxxxxxx",
          kind: "whatsapp",
          provider: "iasolution_hub",
          operationalTerritory: "openbsp",
          externalAccountId: "hub-micro-campaign",
          displayName: "OpenBSP Micro",
          status: "active",
          sendMode: "allowlist",
          outboundAllowlist: ["258840000099"],
          connectionState: "allowlist_only",
          webhookStatus: "verified",
          createdBy: owner.memberId,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("channelSecrets", {
          tenantId: owner.tenantId,
          channelId,
          accessTokenCiphertext: token.ciphertext,
          accessTokenKeyVersion: token.keyVersion,
          webhookSecretCiphertext: hook.ciphertext,
          webhookSecretKeyVersion: hook.keyVersion,
          encryptedAt: now,
        });
        for (const phone of ["258840000099", "258840000100"]) {
          const identityId = await ctx.db.insert("channelIdentities", {
            tenantId: owner.tenantId,
            channelId,
            providerScopedId: phone,
            phone,
            displayName: `Lead ${phone.slice(-3)}`,
            createdAt: now,
            updatedAt: now,
          });
          await ctx.db.insert("channelThreads", {
            tenantId: owner.tenantId,
            channelId,
            threadKey: phone,
            identityId,
            lastEventAt: now,
            lastEventKind: "message.text",
            lastInboundAt: now,
            lastPreview: "Olá",
            unreadCount: 0,
            serviceWindowExpiresAt: now + 60_000,
            createdAt: now,
            updatedAt: now,
          });
        }
        return channelId;
      });

      const result = await t
        .withIdentity({ subject: owner.userId })
        .action(api.iaSolutionHub.sendMicroCampaignText, {
          channelId,
          threadKeys: ["258840000099", "258840000100"],
          text: "Micro sale OpenBSP",
          clientNonce: "test-nonce",
          campaignName: "Micro lab",
        });

      expect(result.accepted).toBe(1);
      expect(result.failed).toBe(1);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        to: "258840000099",
        text: "Micro sale OpenBSP",
      });
      const rows = await t.run(async (ctx) => ({
        outbox: await ctx.db.query("channelOutbox").collect(),
        threads: await ctx.db.query("channelThreads").collect(),
      }));
      expect(rows.outbox).toHaveLength(1);
      expect(rows.outbox[0]).toMatchObject({
        status: "accepted",
        providerMessageId: "wamid.micro.1",
      });
      expect(rows.threads.some((thread) => thread.automationMode === "human")).toBe(
        false,
      );
    } finally {
      if (previous.encryptionKey === undefined) {
        delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
      } else {
        process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous.encryptionKey;
      }
      if (previous.hubBaseUrl === undefined) {
        delete process.env.WHATSAPP_HUB_BASE_URL;
      } else {
        process.env.WHATSAPP_HUB_BASE_URL = previous.hubBaseUrl;
      }
    }
  });

  it("answers a micro campaign reply once through the guarded outbox", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP micro campaign reply");
    const previous = {
      encryptionKey: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1,
      hubBaseUrl: process.env.WHATSAPP_HUB_BASE_URL,
    };
    process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "e".repeat(64);
    process.env.WHATSAPP_HUB_BASE_URL = "https://hub.example";
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(input.toString()).toBe("https://hub.example/api/v1/messages/text");
        requests.push(JSON.parse(String(init?.body ?? "{}")));
        return Response.json({
          success: true,
          data: { message_id: `wamid.micro.reply.${requests.length}` },
        });
      },
    );

    try {
      const token = await encryptSecret("hub-token");
      const hook = await encryptSecret("hub-secret");
      const now = Date.now();
      const eventId = await t.run(async (ctx) => {
        const channelId = await ctx.db.insert("channels", {
          tenantId: owner.tenantId,
          publicId: "hub_microreplyxxxxxxxxxxx",
          kind: "whatsapp",
          provider: "iasolution_hub",
          operationalTerritory: "openbsp",
          externalAccountId: "hub-micro-reply",
          displayName: "OpenBSP Micro Reply",
          status: "active",
          sendMode: "allowlist",
          outboundAllowlist: ["258840000099"],
          connectionState: "allowlist_only",
          webhookStatus: "verified",
          createdBy: owner.memberId,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("channelSecrets", {
          tenantId: owner.tenantId,
          channelId,
          accessTokenCiphertext: token.ciphertext,
          accessTokenKeyVersion: token.keyVersion,
          webhookSecretCiphertext: hook.ciphertext,
          webhookSecretKeyVersion: hook.keyVersion,
          encryptedAt: now,
        });
        const identityId = await ctx.db.insert("channelIdentities", {
          tenantId: owner.tenantId,
          channelId,
          providerScopedId: "258840000099",
          phone: "258840000099",
          displayName: "Lead 099",
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("channelThreads", {
          tenantId: owner.tenantId,
          channelId,
          threadKey: "258840000099",
          identityId,
          lastEventAt: now,
          lastEventKind: "message.text",
          lastInboundAt: now,
          lastPreview: "Olá",
          unreadCount: 0,
          serviceWindowExpiresAt: now + 60_000,
          automationMode: "human",
          automationChangedAt: now,
          automationChangeReason: "human_operator_reply",
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("channelOutbox", {
          tenantId: owner.tenantId,
          channelId,
          businessKey: "hub:text:micro-campaign",
          recipient: "258840000099",
          threadKey: "258840000099",
          messageKind: "text",
          payload: {
            text: "✨ Micro Sale OpenBSP\n\nResponde:\n1 — Quero ver demo",
            previewUrl: false,
            campaignName: "Micro Sale WhatsApp",
          },
          status: "delivered",
          providerMessageId: "wamid.micro.campaign",
          dispatchAttempts: 1,
          createdBy: owner.memberId,
          createdAt: now,
          updatedAt: now,
        });
        const payload = textPayload("wamid.micro.reply.inbound", "micro demo");
        const event = normalizeWebhook(payload, "sha-micro-reply")[0];
        if (!event.threadKey) throw new Error("Missing thread key");
        return await ctx.db.insert("channelEvents", {
          tenantId: owner.tenantId,
          channelId,
          eventKey: event.eventKey,
          providerEventId: event.providerEventId,
          eventKind: event.eventKind,
          direction: event.direction,
          actorProviderScopedId: event.actorProviderScopedId,
          actorDisplayName: event.actorDisplayName,
          actorPhone: event.actorPhone,
          threadKey: event.threadKey,
          replyToProviderMessageId: event.replyToProviderMessageId,
          flowToken: event.flowToken,
          payload: event.payload,
          rawPayload: JSON.stringify(payload),
          rawBodySha256: "sha-micro-reply",
          providerTimestamp: event.providerTimestamp,
          status: "processed",
          attempts: 1,
          receivedAt: now + 1_000,
          processedAt: now + 1_000,
        });
      });

      await t.action(internal.iaSolutionHub.dispatchMicroCampaignReply, {
        eventId,
        intent: "demo",
      });
      await t.action(internal.iaSolutionHub.dispatchMicroCampaignReply, {
        eventId,
        intent: "demo",
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        to: "258840000099",
      });
      expect(JSON.stringify(requests[0])).toContain("demo");
      const rows = await t.run(async (ctx) => ({
        outbox: await ctx.db.query("channelOutbox").collect(),
        thread: await ctx.db.query("channelThreads").first(),
      }));
      const reply = rows.outbox.find((row) =>
        row.businessKey.startsWith("hub:text:micro-reply:"),
      );
      expect(reply).toMatchObject({
        status: "accepted",
        providerMessageId: "wamid.micro.reply.1",
        payload: {
          campaignIntent: "demo",
          campaignName: "Micro Sale WhatsApp",
        },
      });
      expect(rows.thread?.automationMode).toBe("human");
    } finally {
      if (previous.encryptionKey === undefined) {
        delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
      } else {
        process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous.encryptionKey;
      }
      if (previous.hubBaseUrl === undefined) {
        delete process.env.WHATSAPP_HUB_BASE_URL;
      } else {
        process.env.WHATSAPP_HUB_BASE_URL = previous.hubBaseUrl;
      }
    }
  });
});
