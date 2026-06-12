import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { isServiceWindowOpen, SERVICE_WINDOW_MS } from "../lib/flow/window";

// Flow sends schedule messages._dispatchOne, which POSTs to Meta. Stub the
// network so scheduled dispatches resolve deterministically.
beforeEach(() => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.stubbed.out.1" }],
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type Seeded = {
  tenantId: Id<"tenants">;
  memberId: Id<"members">;
  chatbotId: Id<"chatbots">;
  whatsappAccountId: Id<"whatsappAccounts">;
  phoneNumberId: Id<"phoneNumbers">;
  contactId: Id<"contacts">;
  conversationId: Id<"conversations">;
};

const HOUR_MS = 60 * 60 * 1000;

function inboundArgs(
  seeded: Seeded,
  overrides: {
    text?: string;
    replyId?: string;
    metaMessageId: string;
    receivedAt?: number;
  },
) {
  return {
    tenantId: seeded.tenantId,
    conversationId: seeded.conversationId,
    contactId: seeded.contactId,
    phoneNumberId: seeded.phoneNumberId,
    receivedAt: Date.now(),
    ...overrides,
  };
}

async function seedFlow(
  t: ReturnType<typeof convexTest>,
  flowNodes: Array<Record<string, unknown>>,
  opts?: {
    triggerKind?: "inbound" | "keyword" | "ctwa" | "handoff";
    triggerKeywords?: string[];
    /** Offset of conversations.lastIncomingAt relative to now (ms). */
    lastInboundOffsetMs?: number;
  },
): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const lastIncomingAt = now + (opts?.lastInboundOffsetMs ?? 0);
    const userId = await ctx.db.insert("users", { name: "Flow Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Flow Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: now,
    });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
    });
    const whatsappAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "META_APP",
      wabaId: "WABA_C1",
      accessToken: "test-token",
      status: "active",
      tokenStatus: "ok",
      createdAt: now,
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "PHONE_C1",
      e164: "+258840000000",
      displayName: "Flow Clinic",
      createdAt: now,
    });
    const contactId = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258841234567",
      name: "Marisa",
      tags: [],
      createdAt: now,
    });
    const conversationId = await ctx.db.insert("conversations", {
      tenantId,
      phoneNumberId,
      contactId,
      status: "open",
      lastMessageAt: now,
      lastIncomingAt,
      serviceWindowExpiresAt: lastIncomingAt + SERVICE_WINDOW_MS,
      unreadCount: 0,
      tags: [],
      leadSource: "organic",
      opportunityStatus: "new",
    });
    const chatbotId = await ctx.db.insert("chatbots", {
      tenantId,
      name: "Compliance flow",
      status: "active",
      triggerKind: opts?.triggerKind ?? "inbound",
      triggerKeywords: opts?.triggerKeywords,
      entryNodeKey: "start",
      flowNodes: flowNodes as never,
      flowValidationIssues: [],
      channel: "whatsapp",
      createdBy: memberId,
      createdAt: now,
      updatedAt: now,
    });
    return {
      tenantId,
      memberId,
      chatbotId,
      whatsappAccountId,
      phoneNumberId,
      contactId,
      conversationId,
    };
  });
}

async function seedTemplate(
  t: ReturnType<typeof convexTest>,
  seeded: Seeded,
  opts?: {
    status?: "draft" | "pending" | "approved";
    category?: "marketing" | "utility" | "authentication";
    grantConsent?: boolean;
    parameterCount?: number;
  },
): Promise<Id<"templates">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const status = opts?.status ?? "approved";
    const category = opts?.category ?? "utility";
    const paramCount = opts?.parameterCount ?? 1;
    const templateId = await ctx.db.insert("templates", {
      tenantId: seeded.tenantId,
      whatsappAccountId: seeded.whatsappAccountId,
      name: "appointment_followup",
      language: "pt_PT",
      category,
      currentVersion: 1,
      status,
      createdAt: now,
      createdBy: seeded.memberId,
    });
    await ctx.db.insert("templateVersions", {
      templateId,
      tenantId: seeded.tenantId,
      version: 1,
      bodyText: "Olá {{1}}, a sua consulta está confirmada.",
      parameterSchema: Array.from({ length: paramCount }, (_, i) => ({
        index: i + 1,
        name: `param${i + 1}`,
        example: "Maria",
      })),
      isLocked: true,
      createdBy: seeded.memberId,
      createdAt: now,
    });
    if (opts?.grantConsent !== false) {
      const purpose =
        category === "marketing"
          ? ("marketing" as const)
          : category === "authentication"
            ? ("authentication" as const)
            : ("transactional" as const);
      const eventId = await ctx.db.insert("consentEvents", {
        tenantId: seeded.tenantId,
        contactId: seeded.contactId,
        purpose,
        channel: "whatsapp",
        newStatus: "granted",
        source: "test_seed",
        capturedAt: now,
      });
      await ctx.db.insert("currentConsents", {
        tenantId: seeded.tenantId,
        contactId: seeded.contactId,
        purpose,
        channel: "whatsapp",
        status: "granted",
        effectiveAt: now,
        lastEventId: eventId,
      });
    }
    return templateId;
  });
}

describe("24h service window", () => {
  it("isServiceWindowOpen unit behavior", () => {
    const now = Date.now();
    expect(isServiceWindowOpen(now - 23 * HOUR_MS, now)).toBe(true);
    expect(isServiceWindowOpen(now - 25 * HOUR_MS, now)).toBe(false);
    expect(isServiceWindowOpen(undefined, now)).toBe(false);
  });

  it("blocks free-form sends outside the window and fails the run safely", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(
      t,
      [
        { key: "start", type: "start", title: "Start", nextKey: "hello" },
        {
          key: "hello",
          type: "send_message",
          title: "Hello",
          body: "Mensagem livre fora da janela.",
          nextKey: "end",
        },
        { key: "end", type: "end", title: "End" },
      ],
      { lastInboundOffsetMs: -25 * HOUR_MS },
    );

    const result = await t.mutation(
      (internal as any).chatbotFlows.dispatchInbound,
      { ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.win.1" }) },
    );
    expect(result.consumed).toBe(true);
    expect(result.status).toBe("failed");

    const rows = await t.run(async (ctx) => ({
      runs: await ctx.db.query("chatbotFlowRuns").collect(),
      events: await ctx.db.query("chatbotFlowEvents").collect(),
      messages: await ctx.db.query("messages").collect(),
    }));
    expect(rows.runs[0].status).toBe("failed");
    expect(rows.runs[0].endReason).toBe("service_window_closed");
    expect(rows.messages).toHaveLength(0);
    const skipped = rows.events.find((e) => e.eventType === "message_skipped");
    expect(skipped?.payload).toMatchObject({ reason: "outside_service_window" });
  });

  it("handoff outside the window still applies tags without sending copy", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(
      t,
      [
        { key: "start", type: "start", title: "Start", nextKey: "handoff" },
        { key: "handoff", type: "handoff", title: "Handoff" },
      ],
      { lastInboundOffsetMs: -25 * HOUR_MS },
    );

    const result = await t.mutation(
      (internal as any).chatbotFlows.dispatchInbound,
      { ...inboundArgs(seeded, { text: "humano", metaMessageId: "wamid.win.2" }) },
    );
    expect(result.status).toBe("handed_off");

    const rows = await t.run(async (ctx) => ({
      contact: await ctx.db.get(seeded.contactId),
      messages: await ctx.db.query("messages").collect(),
    }));
    expect(rows.contact?.tags).toContain("handoff_requested");
    expect(rows.messages).toHaveLength(0);
  });

  it("send_template bypasses the closed window", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(
      t,
      [
        { key: "start", type: "start", title: "Start", nextKey: "tpl" },
        {
          key: "tpl",
          type: "send_template",
          title: "Template",
            nextKey: "end",
        },
        { key: "end", type: "end", title: "End" },
      ],
      { lastInboundOffsetMs: -25 * HOUR_MS },
    );
    const templateId = await seedTemplate(t, seeded);
    await t.run(async (ctx) => {
      const bot = await ctx.db.get(seeded.chatbotId);
      const nodes = (bot!.flowNodes as Array<Record<string, unknown>>).map((node) =>
        node.key === "tpl"
          ? { ...node, template: { templateId, variables: { "1": "{{contact.name}}" } } }
          : node,
      );
      await ctx.db.patch(seeded.chatbotId, { flowNodes: nodes as never });
    });

    const result = await t.mutation(
      (internal as any).chatbotFlows.dispatchInbound,
      { ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.win.3" }) },
    );
    expect(result.status).toBe("completed");

    const messages = await t.run(async (ctx) => ctx.db.query("messages").collect());
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("template");
    expect(messages[0].content.template.variables).toEqual(["Marisa"]);
    expect(messages[0].templateId).toBe(templateId);
  });
});

describe("send_template node", () => {
  it("sends an approved template with interpolated ordered variables", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "ask" },
      {
        key: "ask",
        type: "collect_input",
        title: "Ask",
        body: "Nome?",
        variableKey: "name",
        nextKey: "tpl",
      },
      {
        key: "tpl",
        type: "send_template",
        title: "Template",
        nextKey: "end",
      },
      { key: "end", type: "end", title: "End" },
    ]);
    const templateId = await seedTemplate(t, seeded);
    await t.run(async (ctx) => {
      const bot = await ctx.db.get(seeded.chatbotId);
      const nodes = (bot!.flowNodes as Array<Record<string, unknown>>).map((node) =>
        node.key === "tpl"
          ? { ...node, template: { templateId, variables: { "1": "{{vars.name}}" } } }
          : node,
      );
      await ctx.db.patch(seeded.chatbotId, { flowNodes: nodes as never });
    });

    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.tpl.1" }),
    });
    const result = await t.mutation(
      (internal as any).chatbotFlows.dispatchInbound,
      { ...inboundArgs(seeded, { text: "Helena", metaMessageId: "wamid.tpl.2" }) },
    );
    expect(result.status).toBe("completed");

    const rows = await t.run(async (ctx) => ({
      messages: await ctx.db.query("messages").collect(),
      run: (await ctx.db.query("chatbotFlowRuns").collect())[0],
    }));
    const tplMessage = rows.messages.find((m) => m.type === "template");
    expect(tplMessage).toBeTruthy();
    expect(tplMessage!.content.template.variables).toEqual(["Helena"]);
    expect(tplMessage!.pricingCategory).toBe("utility");
    expect(tplMessage!.sentByChatbotId).toBe(seeded.chatbotId);
  });

  it("fails safely with zero outbound when the template is not approved", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "tpl" },
      {
        key: "tpl",
        type: "send_template",
        title: "Template",
        nextKey: "end",
      },
      { key: "end", type: "end", title: "End" },
    ]);
    const templateId = await seedTemplate(t, seeded, { status: "draft" });
    await t.run(async (ctx) => {
      const bot = await ctx.db.get(seeded.chatbotId);
      const nodes = (bot!.flowNodes as Array<Record<string, unknown>>).map((node) =>
        node.key === "tpl"
          ? { ...node, template: { templateId, variables: { "1": "x" } } }
          : node,
      );
      await ctx.db.patch(seeded.chatbotId, { flowNodes: nodes as never });
    });

    const result = await t.mutation(
      (internal as any).chatbotFlows.dispatchInbound,
      { ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.tpl.3" }) },
    );
    expect(result.status).toBe("failed");

    const rows = await t.run(async (ctx) => ({
      run: (await ctx.db.query("chatbotFlowRuns").collect())[0],
      messages: await ctx.db.query("messages").collect(),
    }));
    expect(rows.run.endReason).toBe("template_not_approved");
    expect(rows.messages).toHaveLength(0);
  });

  it("skips and fails when consent for the template purpose is absent", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "tpl" },
      {
        key: "tpl",
        type: "send_template",
        title: "Template",
        nextKey: "end",
      },
      { key: "end", type: "end", title: "End" },
    ]);
    const templateId = await seedTemplate(t, seeded, {
      category: "marketing",
      grantConsent: false,
    });
    await t.run(async (ctx) => {
      const bot = await ctx.db.get(seeded.chatbotId);
      const nodes = (bot!.flowNodes as Array<Record<string, unknown>>).map((node) =>
        node.key === "tpl"
          ? { ...node, template: { templateId, variables: { "1": "x" } } }
          : node,
      );
      await ctx.db.patch(seeded.chatbotId, { flowNodes: nodes as never });
    });

    const result = await t.mutation(
      (internal as any).chatbotFlows.dispatchInbound,
      { ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.tpl.4" }) },
    );
    expect(result.status).toBe("failed");

    const rows = await t.run(async (ctx) => ({
      run: (await ctx.db.query("chatbotFlowRuns").collect())[0],
      events: await ctx.db.query("chatbotFlowEvents").collect(),
      messages: await ctx.db.query("messages").collect(),
    }));
    expect(rows.run.endReason).toBe("consent_not_granted");
    expect(rows.messages).toHaveLength(0);
    expect(
      rows.events.some(
        (e) =>
          e.eventType === "message_skipped" &&
          (e.payload as { reason?: string })?.reason === "skipped_consent",
      ),
    ).toBe(true);
  });
});

describe("run lifecycle guards", () => {
  it("fails a cyclic graph at the loop guard without input nodes", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "a" },
      { key: "a", type: "send_message", title: "A", body: "ping", nextKey: "b" },
      { key: "b", type: "send_message", title: "B", body: "pong", nextKey: "a" },
    ]);

    const result = await t.mutation(
      (internal as any).chatbotFlows.dispatchInbound,
      { ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.loop.1" }) },
    );
    expect(result.status).toBe("failed");

    const run = (await t.run(async (ctx) => ctx.db.query("chatbotFlowRuns").collect()))[0];
    expect(run.endReason).toBe("max_runtime_steps_exceeded");
  });

  it("keeps a single run when a second inbound arrives mid-flow", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "ask" },
      {
        key: "ask",
        type: "collect_input",
        title: "Ask",
        body: "Nome?",
        variableKey: "name",
        nextKey: "end",
      },
      { key: "end", type: "end", title: "End" },
    ]);

    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.dup.1" }),
    });
    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, { text: "Marisa", metaMessageId: "wamid.dup.2" }),
    });

    const runs = await t.run(async (ctx) => ctx.db.query("chatbotFlowRuns").collect());
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].vars?.name).toBe("Marisa");
  });

  it("does not let tenant B drive tenant A's conversation", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "end" },
      { key: "end", type: "end", title: "End" },
    ]);
    const tenantB = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        name: "Other Clinic",
        vertical: "clinic",
        plan: "starter",
        settings: {
          defaultLocale: "pt-PT",
          timezone: "Europe/Lisbon",
          retentionDays: 730,
        },
        createdAt: Date.now(),
      }),
    );

    const result = await t.mutation(
      (internal as any).chatbotFlows.dispatchInbound,
      {
        ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.xt.1" }),
        tenantId: tenantB,
      },
    );
    expect(result.consumed).toBe(false);

    const rows = await t.run(async (ctx) => ({
      runs: await ctx.db.query("chatbotFlowRuns").collect(),
      events: await ctx.db.query("chatbotFlowEvents").collect(),
    }));
    expect(rows.runs).toHaveLength(0);
    expect(rows.events).toHaveLength(0);
  });
});

describe("condition operators", () => {
  async function runCondition(
    operator: string,
    value: string,
    input: string,
  ): Promise<string | undefined> {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "ask" },
      {
        key: "ask",
        type: "collect_input",
        title: "Ask",
        body: "Diz algo",
        variableKey: "answer",
        nextKey: "branch",
      },
      {
        key: "branch",
        type: "condition",
        title: "Branch",
        condition: {
          variableKey: "answer",
          operator,
          value,
          trueNextKey: "yes",
          falseNextKey: "no",
        },
      },
      { key: "yes", type: "set_tag", title: "Yes", tag: "matched", nextKey: "end" },
      { key: "no", type: "set_tag", title: "No", tag: "unmatched", nextKey: "end" },
      { key: "end", type: "end", title: "End" },
    ]);

    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.cond.1" }),
    });
    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, { text: input, metaMessageId: "wamid.cond.2" }),
    });
    const contact = await t.run(async (ctx) => ctx.db.get(seeded.contactId));
    return contact?.tags?.[0];
  }

  it("routes equals to the matching branch both ways", async () => {
    expect(await runCondition("equals", "sim", "Sim")).toBe("matched");
    expect(await runCondition("equals", "sim", "não")).toBe("unmatched");
  });

  it("routes starts_with both ways", async () => {
    expect(await runCondition("starts_with", "mar", "Marcar consulta")).toBe("matched");
    expect(await runCondition("starts_with", "mar", "consulta marcar")).toBe("unmatched");
  });

  it("routes ends_with both ways", async () => {
    expect(await runCondition("ends_with", "consulta", "marcar consulta")).toBe("matched");
    expect(await runCondition("ends_with", "consulta", "consulta amanhã")).toBe("unmatched");
  });
});

describe("STOP keyword", () => {
  it("stops active runs and they never resume", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "ask" },
      {
        key: "ask",
        type: "collect_input",
        title: "Ask",
        body: "Nome?",
        variableKey: "name",
        nextKey: "end",
      },
      { key: "end", type: "end", title: "End" },
    ]);

    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, { text: "olá", metaMessageId: "wamid.stop.1" }),
    });

    await t.mutation((internal as any).webhooks.handleStopKeyword, {
      tenantId: seeded.tenantId,
      contactId: seeded.contactId,
      triggeredByText: "STOP",
    });

    const afterStop = await t.run(async (ctx) => ({
      runs: await ctx.db.query("chatbotFlowRuns").collect(),
      events: await ctx.db.query("chatbotFlowEvents").collect(),
    }));
    expect(afterStop.runs[0].status).toBe("stopped");
    expect(afterStop.runs[0].endReason).toBe("stop_keyword");
    expect(afterStop.events.some((e) => e.eventType === "stopped")).toBe(true);

    // A later inbound must not resume the stopped run...
    const result = await t.mutation(
      (internal as any).chatbotFlows.dispatchInbound,
      { ...inboundArgs(seeded, { text: "Marisa", metaMessageId: "wamid.stop.2" }) },
    );
    // ...the inbound starts a new run at most (trigger inbound), never
    // touches the stopped one.
    const runs = await t.run(async (ctx) => ctx.db.query("chatbotFlowRuns").collect());
    const stopped = runs.find((r) => r.endReason === "stop_keyword");
    expect(stopped?.status).toBe("stopped");
    expect(stopped?.vars?.name).toBeUndefined();
    void result;
  });
});
