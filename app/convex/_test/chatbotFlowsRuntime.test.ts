import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

type SeededFlow = {
  userId: Id<"users">;
  tenantId: Id<"tenants">;
  chatbotId: Id<"chatbots">;
  phoneNumberId: Id<"phoneNumbers">;
  contactId: Id<"contacts">;
  conversationId: Id<"conversations">;
};

function inboundArgs(
  seeded: SeededFlow,
  overrides: {
    text?: string;
    replyId?: string;
    metaMessageId: string;
    receivedAt: number;
  },
) {
  return {
    tenantId: seeded.tenantId,
    conversationId: seeded.conversationId,
    contactId: seeded.contactId,
    phoneNumberId: seeded.phoneNumberId,
    ...overrides,
  };
}

async function seedFlow(
  t: ReturnType<typeof convexTest>,
  flowNodes: Array<Record<string, unknown>>,
  opts?: {
    triggerKind?: "inbound" | "keyword" | "ctwa" | "handoff";
    triggerKeywords?: string[];
    entryNodeKey?: string;
    contactName?: string;
  },
): Promise<SeededFlow> {
  return await t.run(async (ctx) => {
    const now = Date.now();
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
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: now,
    });
    const whatsappAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "META_APP",
      wabaId: "WABA_1",
      accessToken: "test-token",
      status: "active",
      tokenStatus: "ok",
      createdAt: now,
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "PHONE_1",
      e164: "+258840000000",
      displayName: "Flow Clinic",
      createdAt: now,
    });
    const contactId = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258841234567",
      name: opts?.contactName ?? "Marisa",
      tags: [],
      createdAt: now,
    });
    const conversationId = await ctx.db.insert("conversations", {
      tenantId,
      phoneNumberId,
      contactId,
      status: "open",
      lastMessageAt: now,
      lastIncomingAt: now,
      serviceWindowExpiresAt: now + 24 * 60 * 60 * 1000,
      unreadCount: 0,
      tags: [],
      leadSource: "organic",
      opportunityStatus: "new",
    });
    const chatbotId = await ctx.db.insert("chatbots", {
      tenantId,
      name: "Runtime flow",
      status: "active",
      triggerKind: opts?.triggerKind ?? "keyword",
      triggerKeywords: opts?.triggerKeywords ?? ["menu"],
      entryNodeKey: opts?.entryNodeKey ?? "start",
      flowNodes: flowNodes as never,
      flowValidationIssues: [],
      channel: "whatsapp",
      createdBy: memberId,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, tenantId, chatbotId, phoneNumberId, contactId, conversationId };
  });
}

describe("chatbot flow runtime", () => {
  it("starts a keyword flow, queues the menu, and ignores duplicate inbound ids", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "menu" },
      {
        key: "menu",
        type: "send_buttons",
        title: "Menu",
        body: "Como podemos ajudar?",
        buttons: [
          { replyId: "book", label: "Marcar", nextKey: "book" },
          { replyId: "human", label: "Humano", nextKey: "handoff" },
        ],
      },
      {
        key: "book",
        type: "send_message",
        title: "Booking",
        body: "Perfeito {{contact.name}}, diz o horário preferido.",
        nextKey: "handoff",
      },
      { key: "handoff", type: "handoff", title: "Handoff" },
    ]);

    const result = await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, {
      text: "menu",
      metaMessageId: "wamid.flow.1",
      receivedAt: 1_700_000_000_000,
      }),
    });
    expect(result.consumed).toBe(true);

    const duplicate = await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, {
      text: "menu",
      metaMessageId: "wamid.flow.1",
      receivedAt: 1_700_000_001_000,
      }),
    });
    expect(duplicate.idempotent).toBe(true);

    const rows = await t.run(async (ctx) => ({
      runs: await ctx.db.query("chatbotFlowRuns").collect(),
      events: await ctx.db.query("chatbotFlowEvents").collect(),
      messages: await ctx.db.query("messages").collect(),
    }));
    expect(rows.runs).toHaveLength(1);
    expect(rows.runs[0]).toMatchObject({ status: "active", currentNodeKey: "menu" });
    expect(rows.messages).toHaveLength(1);
    expect(rows.messages[0].content.text.body).toContain("Como podemos ajudar?");
    expect(
      rows.events.filter((event) => event.metaMessageId === "wamid.flow.1"),
    ).toHaveLength(1);
  });

  it("lists flow runs with exact event counts and a bounded latest event window", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "menu" },
      {
        key: "menu",
        type: "send_buttons",
        title: "Menu",
        body: "Como podemos ajudar?",
        buttons: [{ replyId: "book", label: "Marcar", nextKey: "book" }],
      },
      { key: "book", type: "send_message", title: "Booking", body: "Vamos marcar." },
    ]);

    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, {
      text: "menu",
      metaMessageId: "wamid.flow.audit",
      receivedAt: 1_700_000_000_000,
      }),
    });

    const totalEvents = await t.run(async (ctx) => {
      const [run] = await ctx.db.query("chatbotFlowRuns").collect();
      for (let i = 0; i < 14; i += 1) {
        await ctx.db.insert("chatbotFlowEvents", {
          tenantId: seeded.tenantId,
          chatbotId: seeded.chatbotId,
          flowRunId: run._id,
          conversationId: seeded.conversationId,
          contactId: seeded.contactId,
          eventType: "node_entered",
          nodeKey: `audit_${i}`,
          payload: { sequence: i },
          createdAt: 1_700_000_010_000 + i,
        });
      }
      return (await ctx.db.query("chatbotFlowEvents").collect()).length;
    });

    const owner = t.withIdentity({ subject: seeded.userId });
    const [run] = await owner.query(api.chatbotFlows.listRuns, {
      chatbotId: seeded.chatbotId,
      limit: 1,
    });

    expect(run.contactName).toBe("Marisa");
    expect(run.contactHandle).toBe("+258841234567");
    expect(run.eventCount).toBe(totalEvents);
    expect(run.events).toHaveLength(12);
    expect(run.events[0].createdAt).toBeLessThanOrEqual(
      run.events.at(-1)?.createdAt ?? 0,
    );
    expect(run.events[0].nodeKey).toBe("audit_2");
    expect(run.events.at(-1)?.nodeKey).toBe("audit_13");
  });

  it("advances from a reply id and hands off without duplicating the run", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "menu" },
      {
        key: "menu",
        type: "send_buttons",
        title: "Menu",
        body: "Escolhe uma opção:",
        buttons: [{ replyId: "book", label: "Marcar", nextKey: "book" }],
      },
      {
        key: "book",
        type: "send_message",
        title: "Booking",
        body: "Perfeito {{contact.name}}, vamos marcar.",
        nextKey: "handoff",
      },
      { key: "handoff", type: "handoff", title: "Handoff" },
    ]);

    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, {
      text: "menu",
      metaMessageId: "wamid.flow.2",
      receivedAt: 1_700_000_000_000,
      }),
    });
    const result = await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, {
      text: "Marcar",
      replyId: "book",
      metaMessageId: "wamid.flow.3",
      receivedAt: 1_700_000_002_000,
      }),
    });
    expect(result.consumed).toBe(true);

    const rows = await t.run(async (ctx) => ({
      runs: await ctx.db.query("chatbotFlowRuns").collect(),
      messages: await ctx.db.query("messages").collect(),
      contact: await ctx.db.get(seeded.contactId),
    }));
    expect(rows.runs).toHaveLength(1);
    expect(rows.runs[0].status).toBe("handed_off");
    expect(rows.contact?.tags).toContain("handoff_requested");
    expect(rows.messages.some((message) => message.content.text.body.includes("vamos marcar"))).toBe(true);
  });

  it("collects variables, interpolates copy, and applies tags", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(
      t,
      [
        { key: "start", type: "start", title: "Start", nextKey: "ask_name" },
        {
          key: "ask_name",
          type: "collect_input",
          title: "Ask name",
          body: "Qual é o teu nome?",
          variableKey: "name",
          nextKey: "tag_lead",
        },
        {
          key: "tag_lead",
          type: "set_tag",
          title: "Tag lead",
          tag: "lead:{{vars.name}}",
          nextKey: "thanks",
        },
        {
          key: "thanks",
          type: "send_message",
          title: "Thanks",
          body: "Obrigado {{vars.name}}, já te encaminhei.",
          nextKey: "end",
        },
        { key: "end", type: "end", title: "End" },
      ],
      { triggerKind: "inbound", triggerKeywords: undefined },
    );

    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, {
      text: "Olá",
      metaMessageId: "wamid.flow.4",
      receivedAt: 1_700_000_000_000,
      }),
    });
    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, {
      text: "Marisa",
      metaMessageId: "wamid.flow.5",
      receivedAt: 1_700_000_001_000,
      }),
    });

    const rows = await t.run(async (ctx) => ({
      run: (await ctx.db.query("chatbotFlowRuns").collect())[0],
      events: await ctx.db.query("chatbotFlowEvents").collect(),
      messages: await ctx.db.query("messages").collect(),
      contact: await ctx.db.get(seeded.contactId),
    }));
    expect(rows.run.status).toBe("completed");
    expect(rows.run.vars?.name).toBe("Marisa");
    expect(rows.contact?.tags).toContain("lead:Marisa");
    expect(rows.messages.some((message) => message.content.text.body.includes("Obrigado Marisa"))).toBe(true);
    expect(JSON.stringify(rows.events)).not.toContain("Marisa");
  });

  it("times out stale active runs", async () => {
    const t = convexTest(schema);
    const seeded = await seedFlow(t, [
      { key: "start", type: "start", title: "Start", nextKey: "ask" },
      {
        key: "ask",
        type: "collect_input",
        title: "Ask",
        body: "Responde quando puderes.",
        variableKey: "reply",
        nextKey: "end",
      },
      { key: "end", type: "end", title: "End" },
    ]);

    await t.mutation((internal as any).chatbotFlows.dispatchInbound, {
      ...inboundArgs(seeded, {
      text: "menu",
      metaMessageId: "wamid.flow.6",
      receivedAt: 1_700_000_000_000,
      }),
    });
    await t.run(async (ctx) => {
      const [run] = await ctx.db.query("chatbotFlowRuns").collect();
      await ctx.db.patch(run._id, { lastAdvancedAt: 1_000 });
    });

    const result = await t.mutation((internal as any).chatbotFlows.sweepStaleRuns, {
      olderThanMs: 60_000,
      now: 1_700_000_000_000,
    });
    expect(result.timedOut).toBe(1);
    const [run] = await t.run(async (ctx) => ctx.db.query("chatbotFlowRuns").collect());
    expect(run.status).toBe("timed_out");
  });
});
