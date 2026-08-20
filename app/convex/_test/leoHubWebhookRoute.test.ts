import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { encryptSecret } from "../lib/secrets";

const PUBLIC_ID = "lab_abcdefghijklmnopqrstuvwx";
const WEBHOOK_SECRET = "hub-webhook-secret-value";
const RECIPIENT = "258860439352";
const ROUTE = `/provider-webhook/leo-hub/${PUBLIC_ID}`;

beforeAll(() => {
  // 32-byte key, hex encoded. Test-only value.
  process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "a".repeat(64);
});

async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return (
    "sha256=" +
    Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    )
  );
}

async function seed(t: ReturnType<typeof convexTest>) {
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Lab Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "OpenBSP Lab",
      vertical: "services",
      plan: "starter",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      rgpd: {
        controllerName: "OpenBSP Lab",
        controllerEmail: "lab@example.test",
        dpaSignedAt: Date.now(),
        dpiaCompletedAt: Date.now(),
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
    return { userId, tenantId, memberId };
  });

  // Real ciphertext, so loadWebhookContext performs a real decrypt.
  const token = await encryptSecret("hub-channel-token");
  const hook = await encryptSecret(WEBHOOK_SECRET);

  const { channelId } = await t.mutation(
    internal.leoHubLab._upsertConnection,
    {
      tenantId: ids.tenantId,
      memberId: ids.memberId,
      publicId: PUBLIC_ID,
      externalChannelId: "hub-channel-lab-1",
      displayName: "OpenBSP Lab",
      outboundAllowlist: [RECIPIENT],
      accessTokenCiphertext: token.ciphertext,
      accessTokenKeyVersion: token.keyVersion,
      webhookSecretCiphertext: hook.ciphertext,
      webhookSecretKeyVersion: hook.keyVersion,
      encryptedAt: Date.now(),
      healthStatus: "GREEN",
    },
  );
  return { ...ids, channelId: channelId as Id<"channels"> };
}

async function seedAcceptedOutbox(
  t: ReturnType<typeof convexTest>,
  args: {
    tenantId: Id<"tenants">;
    memberId: Id<"members">;
    channelId: Id<"channels">;
    providerMessageId: string;
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(args.channelId, { sendMode: "allowlist" });
  });
  const claim = await t.mutation(internal.leoHubLab._claimOutbox, {
    tenantId: args.tenantId,
    memberId: args.memberId,
    channelId: args.channelId,
    businessKey: "lab:text:e2e",
    recipient: RECIPIENT,
    messageKind: "text",
    payload: { body: "Ping do OpenBSP Lab" },
  });
  await t.mutation(internal.leoHubLab._settleOutbox, {
    outboxId: claim.outboxId,
    status: "accepted",
    providerMessageId: args.providerMessageId,
  });
  return claim.outboxId;
}

function statusBody(providerMessageId: string, status: string) {
  return JSON.stringify({
    statuses: [
      {
        id: providerMessageId,
        status,
        recipient_id: RECIPIENT,
        timestamp: "1755500000",
      },
    ],
  });
}

async function post(
  t: ReturnType<typeof convexTest>,
  args: { body: string; signature?: string; route?: string },
) {
  return await t.fetch(args.route ?? ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(args.signature ? { "x-hub-signature-256": args.signature } : {}),
    },
    body: args.body,
  });
}

describe("Leo Hub webhook route, end to end", () => {
  it("settles an outbox row without projecting a status-only thread", async () => {
    const t = convexTest(schema);
    const seeded = await seed(t);
    const outboxId = await seedAcceptedOutbox(t, {
      ...seeded,
      providerMessageId: "wamid.E2E",
    });

    const body = statusBody("wamid.E2E", "delivered");
    const res = await post(t, {
      body,
      signature: await signBody(WEBHOOK_SECRET, body),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0 });

    const state = await t.run(async (ctx) => ({
      outbox: await ctx.db.get(outboxId),
      threads: await ctx.db.query("channelThreads").collect(),
      events: await ctx.db.query("channelEvents").collect(),
    }));
    expect(state.outbox?.status).toBe("delivered");
    expect(state.threads).toHaveLength(0);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      eventKind: "status.delivered",
      providerEventId: "wamid.E2E",
    });
    expect(state.events[0].threadKey).toBeUndefined();
  });

  it("stores an orphan provider status as event evidence only", async () => {
    const t = convexTest(schema);
    await seed(t);

    const body = statusBody("wamid.UNKNOWN", "delivered");
    const res = await post(t, {
      body,
      signature: await signBody(WEBHOOK_SECRET, body),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0 });

    const state = await t.run(async (ctx) => ({
      outbox: await ctx.db.query("channelOutbox").collect(),
      threads: await ctx.db.query("channelThreads").collect(),
      events: await ctx.db.query("channelEvents").collect(),
    }));
    expect(state.outbox).toHaveLength(0);
    expect(state.threads).toHaveLength(0);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      eventKind: "status.delivered",
      providerEventId: "wamid.UNKNOWN",
    });
    expect(state.events[0].threadKey).toBeUndefined();
  });

  it("treats a replayed delivery as a duplicate", async () => {
    const t = convexTest(schema);
    const seeded = await seed(t);
    const outboxId = await seedAcceptedOutbox(t, {
      ...seeded,
      providerMessageId: "wamid.E2E",
    });

    const body = statusBody("wamid.E2E", "delivered");
    const signature = await signBody(WEBHOOK_SECRET, body);

    const first = await post(t, { body, signature });
    const afterFirst = await t.run(async (ctx) => await ctx.db.get(outboxId));
    const second = await post(t, { body, signature });
    const afterSecond = await t.run(async (ctx) => await ctx.db.get(outboxId));

    expect(await first.json()).toEqual({ accepted: 1, duplicates: 0 });
    expect(await second.json()).toEqual({ accepted: 0, duplicates: 1 });
    expect(afterSecond?.status).toBe("delivered");
    expect(afterSecond?.updatedAt).toBe(afterFirst?.updatedAt);
    const state = await t.run(async (ctx) => ({
      events: await ctx.db.query("channelEvents").collect(),
      threads: await ctx.db.query("channelThreads").collect(),
    }));
    expect(state.events).toHaveLength(1);
    expect(state.threads).toHaveLength(0);
  });

  it("rejects a tampered body and writes nothing", async () => {
    const t = convexTest(schema);
    const seeded = await seed(t);
    const outboxId = await seedAcceptedOutbox(t, {
      ...seeded,
      providerMessageId: "wamid.E2E",
    });

    const honest = statusBody("wamid.E2E", "delivered");
    const signature = await signBody(WEBHOOK_SECRET, honest);
    const tampered = statusBody("wamid.E2E", "read");

    const res = await post(t, { body: tampered, signature });

    expect(res.status).toBe(401);
    const state = await t.run(async (ctx) => ({
      outbox: await ctx.db.get(outboxId),
      events: await ctx.db.query("channelEvents").collect(),
    }));
    expect(state.outbox?.status).toBe("accepted");
    expect(state.events).toHaveLength(0);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const t = convexTest(schema);
    await seed(t);
    const body = statusBody("wamid.E2E", "delivered");

    const res = await post(t, {
      body,
      signature: await signBody("not-the-secret", body),
    });

    expect(res.status).toBe(401);
    const events = await t.run(
      async (ctx) => await ctx.db.query("channelEvents").collect(),
    );
    expect(events).toHaveLength(0);
  });

  it("rejects a request with no signature header", async () => {
    const t = convexTest(schema);
    await seed(t);
    const res = await post(t, { body: statusBody("wamid.E2E", "delivered") });
    expect(res.status).toBe(401);
  });

  it("refuses a malformed or unknown publicId before touching secrets", async () => {
    const t = convexTest(schema);
    await seed(t);
    const body = statusBody("wamid.E2E", "delivered");
    const signature = await signBody(WEBHOOK_SECRET, body);

    const malformed = await post(t, {
      body,
      signature,
      route: "/provider-webhook/leo-hub/not-a-lab-id",
    });
    expect(malformed.status).toBe(404);

    const unknown = await post(t, {
      body,
      signature,
      route: "/provider-webhook/leo-hub/lab_zzzzzzzzzzzzzzzzzzzzzzzz",
    });
    expect(unknown.status).toBe(404);
  });
});
