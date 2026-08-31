import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { encryptSecret } from "../lib/secrets";

const PUBLIC_ID = "hub_abcdefghijklmnopqrstuvwx";
const WEBHOOK_SECRET = "openbsp-isolated-webhook-secret";
const ROUTE = `/provider-webhook/iasolution-hub/${PUBLIC_ID}`;

beforeAll(() => {
  process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "b".repeat(64);
});

async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return `sha256=${Array.from(
    new Uint8Array(signature),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function seed(t: ReturnType<typeof convexTest>) {
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "OpenBSP owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "OpenBSP",
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
    const now = Date.now();
    const channelId = await ctx.db.insert("channels", {
      tenantId,
      publicId: PUBLIC_ID,
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: `pending:${PUBLIC_ID}`,
      displayName: "OpenBSP WhatsApp",
      status: "pending",
      sendMode: "disabled",
      outboundAllowlist: [],
      connectionState: "pending_number",
      webhookStatus: "disabled",
      createdBy: memberId,
      createdAt: now,
      updatedAt: now,
    });
    return { tenantId, memberId, channelId };
  });
  const token = await encryptSecret("isolated-channel-token-value");
  const hook = await encryptSecret(WEBHOOK_SECRET);
  await t.mutation(internal.iaSolutionHub._configureConnection, {
    tenantId: ids.tenantId,
    memberId: ids.memberId,
    channelId: ids.channelId,
    externalChannelId: "new-openbsp-channel",
    displayName: "OpenBSP WhatsApp",
    phoneNumber: "258840000001",
    wabaId: "waba-openbsp",
    outboundAllowlist: ["258840000099"],
    accessTokenCiphertext: token.ciphertext,
    accessTokenKeyVersion: token.keyVersion,
    webhookSecretCiphertext: hook.ciphertext,
    webhookSecretKeyVersion: hook.keyVersion,
    encryptedAt: Date.now(),
    healthStatus: "GREEN",
  });
  return ids;
}

function messageBody() {
  return JSON.stringify({
    metadata: {
      display_phone_number: "+258 84 000 0001",
      phone_number_id: "hub-phone-number",
    },
    contacts: [{ profile: { name: "Test User" }, wa_id: "258840000099" }],
    messages: [
      {
        from: "258840000099",
        id: "wamid.isolated.1",
        timestamp: "1787300000",
        type: "text",
        text: { body: "Teste isolado" },
      },
    ],
  });
}

describe("iaSolution Hub webhook route", () => {
  it("authenticates raw-body HMAC, resolves the exact channel and deduplicates", async () => {
    const t = convexTest(schema);
    const { channelId } = await seed(t);
    const body = messageBody();
    const signature = await signBody(WEBHOOK_SECRET, body);

    const first = await t.fetch(ROUTE, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });
    const replay = await t.fetch(ROUTE, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ accepted: 1, duplicates: 0, failed: 0 });
    expect(await replay.json()).toEqual({ accepted: 0, duplicates: 1, failed: 0 });
    const state = await t.run(async (ctx) => ({
      channel: await ctx.db.get(channelId),
      events: await ctx.db.query("channelEvents").collect(),
      threads: await ctx.db.query("channelThreads").collect(),
    }));
    expect(state.channel).toMatchObject({
      webhookStatus: "verified",
      connectionState: "allowlist_only",
      sendMode: "disabled",
    });
    expect(state.events).toHaveLength(1);
    expect(state.threads).toHaveLength(1);
  });

  it("rejects tampering and unknown channels without writing data", async () => {
    const t = convexTest(schema);
    await seed(t);
    const body = messageBody();
    const signature = await signBody(WEBHOOK_SECRET, body);

    const tampered = await t.fetch(ROUTE, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: body.replace("Teste isolado", "Tampered"),
    });
    const unknown = await t.fetch(
      "/provider-webhook/iasolution-hub/hub_zzzzzzzzzzzzzzzzzzzzzzzz",
      {
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body,
      },
    );

    expect(tampered.status).toBe(401);
    expect(unknown.status).toBe(404);
    const events = await t.run(async (ctx) =>
      ctx.db.query("channelEvents").collect(),
    );
    expect(events).toEqual([]);
  });

  it("allows unsigned Hub registration probes without writing data", async () => {
    const t = convexTest(schema);
    const { channelId } = await seed(t);
    const probe = await t.fetch(ROUTE, {
      method: "POST",
      body: messageBody(),
    });

    expect(probe.status).toBe(200);
    expect(await probe.json()).toEqual({
      accepted: 0,
      duplicates: 0,
      failed: 0,
      probe: true,
    });
    const state = await t.run(async (ctx) => ({
      channel: await ctx.db.get(channelId),
      events: await ctx.db.query("channelEvents").collect(),
    }));
    expect(state.channel?.webhookStatus).toBe("pending");
    expect(state.events).toEqual([]);
  });

  it("accepts unsigned direct Hub deliveries with matching channel metadata", async () => {
    const t = convexTest(schema);
    const { channelId } = await seed(t);

    const delivery = await t.fetch(ROUTE, {
      method: "POST",
      headers: {
        "user-agent": "iaSolutionHub-Webhook/1.0",
        "x-delivery-id": "delivery-unsigned-1",
        "x-webhook-id": "hub-webhook-1",
      },
      body: messageBody(),
    });

    expect(delivery.status).toBe(200);
    expect(await delivery.json()).toEqual({
      accepted: 1,
      duplicates: 0,
      failed: 0,
    });
    const state = await t.run(async (ctx) => ({
      channel: await ctx.db.get(channelId),
      events: await ctx.db.query("channelEvents").collect(),
      threads: await ctx.db.query("channelThreads").collect(),
    }));
    expect(state.channel).toMatchObject({ webhookStatus: "verified" });
    expect(state.events).toHaveLength(1);
    expect(state.threads).toHaveLength(1);
  });

  it("rejects unsigned direct Hub deliveries with mismatched metadata", async () => {
    const t = convexTest(schema);
    await seed(t);

    const unsigned = await t.fetch(ROUTE, {
      method: "POST",
      headers: {
        "user-agent": "iaSolutionHub-Webhook/1.0",
        "x-delivery-id": "delivery-unsigned-2",
        "x-webhook-id": "hub-webhook-1",
      },
      body: messageBody().replace("+258 84 000 0001", "+258 84 000 0002"),
    });

    expect(unsigned.status).toBe(401);
    const events = await t.run(async (ctx) =>
      ctx.db.query("channelEvents").collect(),
    );
    expect(events).toEqual([]);
  });
});
