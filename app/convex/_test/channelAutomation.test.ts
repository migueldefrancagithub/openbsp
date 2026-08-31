import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import schema from "../schema";

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
    return { tenantId, memberId };
  });
}

async function seedChannel(
  t: ReturnType<typeof convexTest>,
  owner: Awaited<ReturnType<typeof seedTenant>>,
  suffix: string,
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("channels", {
      tenantId: owner.tenantId,
      publicId: `hub_${suffix.padEnd(24, "x")}`,
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: `channel-${suffix}`,
      displayName: `Channel ${suffix}`,
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
}

type Node = {
  key: string;
  type:
    | "start"
    | "send_message"
    | "send_template"
    | "send_buttons"
    | "send_list"
    | "collect_input"
    | "condition"
    | "set_tag"
    | "handoff"
    | "end";
  title: string;
  body?: string;
  nextKey?: string;
  variableKey?: string;
  buttons?: Array<{ replyId: string; label: string; nextKey: string }>;
};

async function seedBot(
  t: ReturnType<typeof convexTest>,
  owner: Awaited<ReturnType<typeof seedTenant>>,
  args: {
    channelId?: Id<"channels">;
    name: string;
    triggerKind: "inbound" | "keyword" | "ctwa" | "handoff";
    triggerKeywords?: string[];
    nodes: Node[];
  },
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("chatbots", {
      tenantId: owner.tenantId,
      name: args.name,
      status: "active",
      triggerKind: args.triggerKind,
      triggerKeywords: args.triggerKeywords,
      entryNodeKey: "start",
      flowNodes: args.nodes,
      flowValidationIssues: [],
      channel: "whatsapp",
      channelId: args.channelId,
      createdBy: owner.memberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

function textPayload(wamid: string, body: string, referral = false) {
  return {
    contacts: [{ profile: { name: "Test User" }, wa_id: "258840000099" }],
    messages: [
      {
        from: "258840000099",
        id: wamid,
        timestamp: "1787300000",
        type: "text",
        text: { body },
        ...(referral ? { referral: { source_type: "ad" } } : {}),
      },
    ],
  };
}

async function ingestAndDispatch(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"channels">,
  payload: unknown,
  sha: string,
) {
  const normalized = normalizeWebhook(payload, sha)[0];
  const eventId = await t.run(async (ctx) => {
    const channel = await ctx.db.get(channelId);
    if (!channel || !normalized.threadKey) throw new Error("Invalid test event");
    const now = Date.now();
    let identity = (await ctx.db.query("channelIdentities").collect()).find(
      (row) =>
        row.channelId === channelId &&
        row.providerScopedId === normalized.actorProviderScopedId,
    ) ?? null;
    if (!identity) {
      const identityId = await ctx.db.insert("channelIdentities", {
        tenantId: channel.tenantId,
        channelId,
        providerScopedId: normalized.actorProviderScopedId!,
        displayName: normalized.actorDisplayName,
        phone: normalized.actorPhone,
        createdAt: now,
        updatedAt: now,
      });
      identity = await ctx.db.get(identityId);
    }
    let thread = (await ctx.db.query("channelThreads").collect()).find(
      (row) =>
        row.channelId === channelId && row.threadKey === normalized.threadKey,
    ) ?? null;
    if (!thread) {
      const threadId = await ctx.db.insert("channelThreads", {
        tenantId: channel.tenantId,
        channelId,
        threadKey: normalized.threadKey,
        identityId: identity?._id,
        lastEventAt: now,
        lastEventKind: normalized.eventKind,
        lastInboundAt: now,
        lastPreview: "test",
        unreadCount: 1,
        serviceWindowExpiresAt: now + 24 * 60 * 60 * 1_000,
        createdAt: now,
        updatedAt: now,
      });
      thread = await ctx.db.get(threadId);
    } else {
      await ctx.db.patch(thread._id, {
        lastEventAt: now,
        lastEventKind: normalized.eventKind,
        lastInboundAt: now,
        serviceWindowExpiresAt: now + 24 * 60 * 60 * 1_000,
        updatedAt: now,
      });
    }
    return await ctx.db.insert("channelEvents", {
      tenantId: channel.tenantId,
      channelId,
      eventKey: normalized.eventKey,
      providerEventId: normalized.providerEventId,
      eventKind: normalized.eventKind,
      direction: normalized.direction,
      actorProviderScopedId: normalized.actorProviderScopedId,
      actorDisplayName: normalized.actorDisplayName,
      actorPhone: normalized.actorPhone,
      threadKey: normalized.threadKey,
      replyToProviderMessageId: normalized.replyToProviderMessageId,
      flowToken: normalized.flowToken,
      payload: normalized.payload,
      rawPayload: JSON.stringify(payload),
      rawBodySha256: sha,
      providerTimestamp: normalized.providerTimestamp,
      status: "processed",
      attempts: 1,
      receivedAt: now,
      processedAt: now,
    });
  });
  const result = await t.mutation(internal.channelAutomation.dispatchInbound, {
    eventId,
    deferOutbound: true,
  });
  return { eventId, result };
}

const instantFlow: Node[] = [
  { key: "start", type: "start", title: "Start", nextKey: "hello" },
  {
    key: "hello",
    type: "send_message",
    title: "Hello",
    body: "Olá!",
    nextKey: "end",
  },
  { key: "end", type: "end", title: "End" },
];

describe("channel-neutral chatbot runtime", () => {
  it("binds triggers to the exact channel and claims a WAMID idempotently", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP");
    const channelA = await seedChannel(t, owner, "alpha");
    const channelB = await seedChannel(t, owner, "beta");
    const botA = await seedBot(t, owner, {
      channelId: channelA,
      name: "Keyword A",
      triggerKind: "keyword",
      triggerKeywords: ["preco"],
      nodes: instantFlow,
    });
    await seedBot(t, owner, {
      channelId: channelB,
      name: "Keyword B",
      triggerKind: "keyword",
      triggerKeywords: ["preco"],
      nodes: instantFlow,
    });
    await seedBot(t, owner, {
      name: "Unbound legacy bot",
      triggerKind: "inbound",
      nodes: instantFlow,
    });

    const first = await ingestAndDispatch(
      t,
      channelA,
      textPayload("wamid.keyword", "Qual é o preço?"),
      "sha-keyword",
    );
    const replay = await t.mutation(internal.channelAutomation.dispatchInbound, {
      eventId: first.eventId,
      deferOutbound: true,
    });
    expect(first.result).toMatchObject({ consumed: true, status: "active" });
    expect(replay).toMatchObject({ consumed: true, idempotent: true });

    const rows = await t.run(async (ctx) => ({
      runs: await ctx.db.query("channelAutomationRuns").collect(),
      dispatches: await ctx.db.query("channelAutomationDispatches").collect(),
    }));
    expect(rows.runs).toHaveLength(1);
    expect(rows.runs[0]).toMatchObject({ chatbotId: botA, channelId: channelA });
    expect(rows.dispatches).toHaveLength(1);
    expect(rows.dispatches[0]).toMatchObject({ channelId: channelA, status: "queued" });
  });

  it("recognizes CTWA independently from a generic inbound trigger", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP CTWA");
    const channel = await seedChannel(t, owner, "ctwa");
    const ctwaBot = await seedBot(t, owner, {
      channelId: channel,
      name: "CTWA",
      triggerKind: "ctwa",
      nodes: instantFlow,
    });
    await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.ctwa", "Olá", true),
      "sha-ctwa",
    );
    const [run] = await t.run(async (ctx) =>
      await ctx.db.query("channelAutomationRuns").collect(),
    );
    expect(run.chatbotId).toBe(ctwaBot);
  });

  it("collects input, hands off, and keeps the thread under human control", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP handoff");
    const channel = await seedChannel(t, owner, "handoff");
    await seedBot(t, owner, {
      channelId: channel,
      name: "Lead handoff",
      triggerKind: "inbound",
      nodes: [
        { key: "start", type: "start", title: "Start", nextKey: "name" },
        {
          key: "name",
          type: "collect_input",
          title: "Name",
          body: "Qual é o teu nome?",
          variableKey: "name",
          nextKey: "handoff",
        },
        { key: "handoff", type: "handoff", title: "Human handoff" },
      ],
    });
    await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.start", "Olá"),
      "sha-start",
    );
    const prompt = await t.run(async (ctx) =>
      await ctx.db.query("channelAutomationDispatches").first(),
    );
    await t.mutation(internal.channelAutomation.settleDispatch, {
      dispatchId: prompt!._id,
      status: "accepted",
      providerMessageId: "wamid.prompt",
    });
    const reply = await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.name", "Sidney"),
      "sha-name",
    );
    expect(reply.result).toMatchObject({ consumed: true, status: "handed_off" });
    const state = await t.run(async (ctx) => ({
      run: await ctx.db.query("channelAutomationRuns").first(),
      thread: await ctx.db.query("channelThreads").first(),
      dispatches: await ctx.db.query("channelAutomationDispatches").collect(),
    }));
    expect(state.run).toMatchObject({
      status: "handed_off",
      vars: { name: "Sidney" },
    });
    expect(state.thread).toMatchObject({
      automationMode: "human",
      tags: [HANDOFF_TAG_FOR_TEST],
    });
    expect(state.dispatches).toHaveLength(2);
  });

  it("STOP cancels pending automation and prevents a fresh run", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP STOP");
    const channel = await seedChannel(t, owner, "stop");
    await seedBot(t, owner, {
      channelId: channel,
      name: "Inbound",
      triggerKind: "inbound",
      nodes: instantFlow,
    });
    await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.before-stop", "Olá"),
      "sha-before-stop",
    );
    const stopped = await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.stop", "STOP"),
      "sha-stop",
    );
    expect(stopped.result).toMatchObject({ consumed: true, status: "stopped" });
    const after = await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.after-stop", "Olá novamente"),
      "sha-after-stop",
    );
    expect(after.result).toEqual({ consumed: false });
    const state = await t.run(async (ctx) => ({
      runs: await ctx.db.query("channelAutomationRuns").collect(),
      thread: await ctx.db.query("channelThreads").first(),
    }));
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].status).toBe("stopped");
    expect(state.thread?.automationMode).toBe("stopped");
  });

  it("a human operator reply stops the bot before any further automation send", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP human");
    const channel = await seedChannel(t, owner, "human");
    await seedBot(t, owner, {
      channelId: channel,
      name: "Inbound",
      triggerKind: "inbound",
      nodes: instantFlow,
    });
    await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.human", "Olá"),
      "sha-human",
    );
    await t.mutation(internal.channelAutomation.pauseForHuman, {
      tenantId: owner.tenantId,
      channelId: channel,
      threadKey: "258840000099",
    });
    const state = await t.run(async (ctx) => ({
      run: await ctx.db.query("channelAutomationRuns").first(),
      thread: await ctx.db.query("channelThreads").first(),
      dispatch: await ctx.db.query("channelAutomationDispatches").first(),
    }));
    expect(state.run).toMatchObject({
      status: "stopped",
      endReason: "human_operator_reply",
    });
    expect(state.thread?.automationMode).toBe("human");
    expect(
      await t.query(internal.channelAutomation.loadDispatch, {
        dispatchId: state.dispatch!._id,
      }),
    ).toBeNull();
    const nextInbound = await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.after-human", "Olá outra vez"),
      "sha-after-human",
    );
    expect(nextInbound.result).toEqual({ consumed: false });
  });

  it("captures micro campaign intent even while the thread is under human control", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP micro reply");
    const channel = await seedChannel(t, owner, "micro-reply");
    await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.micro-thread", "Olá"),
      "sha-micro-thread",
    );
    await t.mutation(internal.channelAutomation.pauseForHuman, {
      tenantId: owner.tenantId,
      channelId: channel,
      threadKey: "258840000099",
    });
    await t.run(async (ctx) => {
      const thread = await ctx.db.query("channelThreads").first();
      if (!thread) throw new Error("Missing thread");
      await ctx.db.insert("channelOutbox", {
        tenantId: owner.tenantId,
        channelId: channel,
        businessKey: "hub:text:micro-lab-campaign",
        recipient: "258840000099",
        threadKey: thread.threadKey,
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const reply = await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.micro-reply", "micro demo"),
      "sha-micro-reply",
    );
    expect(reply.result).toEqual({ consumed: true, status: "completed" });
    const thread = await t.run(async (ctx) =>
      await ctx.db.query("channelThreads").first(),
    );
    expect(thread).toMatchObject({
      automationMode: "human",
      tags: ["campaign_micro", "campaign_intent_demo"],
    });
  });

  it("lets an explicit keyword restart a bot on a human-controlled thread", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP keyword resume");
    const channel = await seedChannel(t, owner, "keyword-resume");
    await seedBot(t, owner, {
      channelId: channel,
      name: "Keyword resume",
      triggerKind: "keyword",
      triggerKeywords: ["openbspbot"],
      nodes: instantFlow,
    });
    await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.keyword-start", "openbspbot"),
      "sha-keyword-start",
    );
    await t.mutation(internal.channelAutomation.pauseForHuman, {
      tenantId: owner.tenantId,
      channelId: channel,
      threadKey: "258840000099",
    });
    const ignored = await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.keyword-ignore", "Olá outra vez"),
      "sha-keyword-ignore",
    );
    expect(ignored.result).toEqual({ consumed: false });

    const resumed = await ingestAndDispatch(
      t,
      channel,
      textPayload("wamid.keyword-resume", "quero openbspbot"),
      "sha-keyword-resume",
    );
    expect(resumed.result).toMatchObject({ consumed: true, status: "active" });

    const state = await t.run(async (ctx) => ({
      runs: await ctx.db.query("channelAutomationRuns").collect(),
      thread: await ctx.db.query("channelThreads").first(),
      dispatches: await ctx.db.query("channelAutomationDispatches").collect(),
    }));
    expect(state.runs).toHaveLength(2);
    expect(state.runs.map((run) => run.status)).toEqual(["stopped", "active"]);
    expect(state.thread).toMatchObject({ automationMode: "bot" });
    expect(state.dispatches).toHaveLength(2);
  });
});

const HANDOFF_TAG_FOR_TEST = "handoff_requested";
