import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { loadByIdInTenant, tenantQuery } from "./lib/customFunctions";
import type { Doc, Id } from "./_generated/dataModel";

const flowRunStatusValidator = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("handed_off"),
  v.literal("timed_out"),
  v.literal("failed"),
);

const dispatchResultValidator = v.object({
  consumed: v.boolean(),
  idempotent: v.optional(v.boolean()),
  flowRunId: v.optional(v.id("chatbotFlowRuns")),
  status: v.optional(flowRunStatusValidator),
});

type FlowNode = {
  key: string;
  type:
    | "start"
    | "send_message"
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
  position?: { x: number; y: number };
  variableKey?: string;
  tag?: string;
  condition?: {
    variableKey: string;
    operator: "equals" | "contains" | "present" | "absent";
    value?: string;
    trueNextKey: string;
    falseNextKey: string;
  };
  buttons?: Array<{
    replyId: string;
    label: string;
    nextKey: string;
  }>;
};

type DispatchArgs = {
  tenantId: Id<"tenants">;
  conversationId: Id<"conversations">;
  contactId: Id<"contacts">;
  phoneNumberId: Id<"phoneNumbers">;
  inboundMessageId?: Id<"messages">;
  metaMessageId: string;
  text?: string;
  replyId?: string;
  receivedAt: number;
};

type RunState = {
  runId: Id<"chatbotFlowRuns">;
  vars: Record<string, string>;
  repromptCount: number;
};

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;
const MAX_RUNTIME_STEPS = 24;
const HANDOFF_TAG = "handoff_requested";
const HANDOFF_COPY = "Obrigado. A nossa equipa humana vai continuar o atendimento daqui.";

export const dispatchInbound = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    phoneNumberId: v.id("phoneNumbers"),
    inboundMessageId: v.optional(v.id("messages")),
    metaMessageId: v.string(),
    text: v.optional(v.string()),
    replyId: v.optional(v.string()),
    receivedAt: v.number(),
  },
  returns: dispatchResultValidator,
  handler: async (ctx, args): Promise<{
    consumed: boolean;
    idempotent?: boolean;
    flowRunId?: Id<"chatbotFlowRuns">;
    status?: "active" | "completed" | "handed_off" | "timed_out" | "failed";
  }> => {
    const existing = await ctx.db
      .query("chatbotFlowEvents")
      .withIndex("by_tenant_meta_message", (q) =>
        q.eq("tenantId", args.tenantId).eq("metaMessageId", args.metaMessageId),
      )
      .first();
    if (existing) {
      const run = await ctx.db.get(existing.flowRunId);
      return {
        consumed: true,
        idempotent: true,
        flowRunId: existing.flowRunId,
        status: run?.status,
      };
    }

    const conversation = await ctx.db.get(args.conversationId);
    if (
      !conversation ||
      conversation.tenantId !== args.tenantId ||
      conversation.contactId !== args.contactId ||
      conversation.phoneNumberId !== args.phoneNumberId
    ) {
      return { consumed: false };
    }

    const activeRun = await findActiveRun(ctx, args);
    if (activeRun) {
      return await advanceActiveRun(ctx, args, activeRun);
    }

    const bot = await findMatchingBot(ctx, args, conversation);
    if (!bot?.entryNodeKey || !bot.flowNodes?.length) {
      return { consumed: false };
    }

    const runId = await ctx.db.insert("chatbotFlowRuns", {
      tenantId: args.tenantId,
      chatbotId: bot._id,
      conversationId: args.conversationId,
      contactId: args.contactId,
      status: "active",
      currentNodeKey: bot.entryNodeKey,
      vars: {},
      repromptCount: 0,
      startedAt: args.receivedAt,
      lastAdvancedAt: args.receivedAt,
      lastInboundMessageId: args.inboundMessageId,
    });
    await addEvent(ctx, args, {
      bot,
      runId,
      eventType: "started",
      metaMessageId: args.metaMessageId,
      payload: {
        triggerKind: bot.triggerKind,
        hasReplyId: Boolean(args.replyId),
        textLength: args.text?.trim().length ?? 0,
      },
    });

    return await enterFlow(ctx, args, bot, {
      runId,
      vars: {},
      repromptCount: 0,
    }, bot.entryNodeKey);
  },
});

export const sweepStaleRuns = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ timedOut: v.number() }),
  handler: async (ctx, args): Promise<{ timedOut: number }> => {
    const now = args.now ?? Date.now();
    const cutoff = now - (args.olderThanMs ?? DEFAULT_STALE_MS);
    const runs = await ctx.db
      .query("chatbotFlowRuns")
      .withIndex("by_status_last_advanced", (q) =>
        q.eq("status", "active").lt("lastAdvancedAt", cutoff),
      )
      .take(Math.min(args.limit ?? 100, 500));

    for (const run of runs) {
      await ctx.db.patch(run._id, {
        status: "timed_out",
        endedAt: now,
        endReason: "stale_run_timeout",
        lastAdvancedAt: now,
      });
      const bot = await ctx.db.get(run.chatbotId);
      if (bot) {
        await ctx.db.insert("chatbotFlowEvents", {
          tenantId: run.tenantId,
          chatbotId: run.chatbotId,
          flowRunId: run._id,
          conversationId: run.conversationId,
          contactId: run.contactId,
          eventType: "timeout",
          nodeKey: run.currentNodeKey,
          payload: { staleForMs: now - run.lastAdvancedAt },
          createdAt: now,
        });
      }
    }
    return { timedOut: runs.length };
  },
});

export const listRuns = tenantQuery({
  args: {
    chatbotId: v.id("chatbots"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("chatbotFlowRuns"),
      status: v.string(),
      currentNodeKey: v.optional(v.string()),
      vars: v.optional(v.record(v.string(), v.string())),
      repromptCount: v.number(),
      startedAt: v.number(),
      lastAdvancedAt: v.number(),
      endedAt: v.optional(v.number()),
      endReason: v.optional(v.string()),
      contactName: v.optional(v.string()),
      contactHandle: v.optional(v.string()),
      eventCount: v.number(),
      events: v.array(
        v.object({
          _id: v.id("chatbotFlowEvents"),
          eventType: v.string(),
          nodeKey: v.optional(v.string()),
          payload: v.optional(v.any()),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "chatbots",
      args.chatbotId,
    );
    const runs = await ctx.db
      .query("chatbotFlowRuns")
      .withIndex("by_chatbot_started", (q) => q.eq("chatbotId", args.chatbotId))
      .order("desc")
      .take(Math.min(args.limit ?? 12, 50));

    return await Promise.all(
      runs.map(async (run) => {
        const [contact, events] = await Promise.all([
          ctx.db.get(run.contactId),
          ctx.db
            .query("chatbotFlowEvents")
            .withIndex("by_run", (q) => q.eq("flowRunId", run._id))
            .order("desc")
            .take(10),
        ]);
        return {
          _id: run._id,
          status: run.status,
          currentNodeKey: run.currentNodeKey,
          vars: run.vars,
          repromptCount: run.repromptCount,
          startedAt: run.startedAt,
          lastAdvancedAt: run.lastAdvancedAt,
          endedAt: run.endedAt,
          endReason: run.endReason,
          contactName: contact?.name,
          contactHandle:
            contact?.whatsappUsername ?? contact?.e164 ?? contact?.bsuid,
          eventCount: events.length,
          events: events.reverse().map((event) => ({
            _id: event._id,
            eventType: event.eventType,
            nodeKey: event.nodeKey,
            payload: event.payload,
            createdAt: event.createdAt,
          })),
        };
      }),
    );
  },
});

async function findActiveRun(
  ctx: any,
  args: DispatchArgs,
): Promise<Doc<"chatbotFlowRuns"> | null> {
  return await ctx.db
    .query("chatbotFlowRuns")
    .withIndex("by_contact_status", (q: any) =>
      q
        .eq("tenantId", args.tenantId)
        .eq("contactId", args.contactId)
        .eq("status", "active"),
    )
    .first();
}

async function findMatchingBot(
  ctx: any,
  args: DispatchArgs,
  conversation: Doc<"conversations">,
): Promise<Doc<"chatbots"> | null> {
  const bots = await ctx.db
    .query("chatbots")
    .withIndex("by_tenant_status", (q: any) =>
      q.eq("tenantId", args.tenantId).eq("status", "active"),
    )
    .collect();
  const text = normalizeText(args.text ?? "");
  for (const bot of bots) {
    if (!bot.flowNodes?.length || !bot.entryNodeKey) continue;
    if (
      bot.flowValidationIssues?.some(
        (issue: { severity: string }) => issue.severity === "error",
      )
    ) {
      continue;
    }
    if (
      !bot.flowNodes.some(
        (node: { key: string }) => node.key === bot.entryNodeKey,
      )
    ) {
      continue;
    }
    if (bot.triggerKind === "inbound" && (text || args.replyId)) return bot;
    if (
      bot.triggerKind === "ctwa" &&
      conversation.leadSource === "ctwa" &&
      (text || args.replyId)
    ) {
      return bot;
    }
    if (bot.triggerKind === "keyword") {
      const keywords = bot.triggerKeywords ?? [];
      if (
        keywords.some((keyword: string) =>
          text.includes(normalizeText(keyword)),
        )
      ) {
        return bot;
      }
    }
  }
  return null;
}

async function advanceActiveRun(
  ctx: any,
  args: DispatchArgs,
  activeRun: Doc<"chatbotFlowRuns">,
): Promise<{
  consumed: boolean;
  idempotent?: boolean;
  flowRunId?: Id<"chatbotFlowRuns">;
  status?: "active" | "completed" | "handed_off" | "timed_out" | "failed";
}> {
  const bot = await ctx.db.get(activeRun.chatbotId);
  if (!bot?.flowNodes?.length) {
    await failRun(ctx, activeRun, "missing_bot_or_flow", args.receivedAt);
    return { consumed: true, flowRunId: activeRun._id, status: "failed" };
  }
  const nodes = nodesByKey(bot.flowNodes as FlowNode[]);
  const current = activeRun.currentNodeKey
    ? nodes.get(activeRun.currentNodeKey)
    : undefined;
  await addEvent(ctx, args, {
    bot,
    runId: activeRun._id,
    eventType: "reply_received",
    nodeKey: activeRun.currentNodeKey,
    metaMessageId: args.metaMessageId,
    payload: {
      hasReplyId: Boolean(args.replyId),
      replyId: args.replyId,
      textLength: args.text?.trim().length ?? 0,
    },
  });

  if (!current) {
    await failRun(ctx, activeRun, "missing_current_node", args.receivedAt);
    return { consumed: true, flowRunId: activeRun._id, status: "failed" };
  }

  const vars = { ...(activeRun.vars ?? {}) };
  if (current.type === "collect_input") {
    const value = (args.text?.trim() || args.replyId || "").slice(0, 500);
    if (!value) {
      return await repromptNode(ctx, args, bot, activeRun, current);
    }
    if (current.variableKey) vars[current.variableKey] = value;
    return await enterFlow(
      ctx,
      args,
      bot,
      {
        runId: activeRun._id,
        vars,
        repromptCount: activeRun.repromptCount,
      },
      current.nextKey,
    );
  }

  if (current.type === "send_buttons" || current.type === "send_list") {
    const match = matchChoice(current.buttons ?? [], {
      replyId: args.replyId,
      text: args.text,
    });
    if (!match) {
      await addEvent(ctx, args, {
        bot,
        runId: activeRun._id,
        eventType: "fallback_fired",
        nodeKey: current.key,
        payload: {
          reason: "choice_not_matched",
          textLength: args.text?.trim().length ?? 0,
          hasReplyId: Boolean(args.replyId),
        },
      });
      return await repromptNode(ctx, args, bot, activeRun, current);
    }
    if (current.variableKey) vars[current.variableKey] = match.replyId;
    return await enterFlow(
      ctx,
      args,
      bot,
      {
        runId: activeRun._id,
        vars,
        repromptCount: activeRun.repromptCount,
      },
      match.nextKey,
    );
  }

  return await enterFlow(
    ctx,
    args,
    bot,
    {
      runId: activeRun._id,
      vars,
      repromptCount: activeRun.repromptCount,
    },
    activeRun.currentNodeKey ?? bot.entryNodeKey,
  );
}

async function enterFlow(
  ctx: any,
  args: DispatchArgs,
  bot: Doc<"chatbots">,
  state: RunState,
  startKey: string | undefined,
): Promise<{
  consumed: boolean;
  idempotent?: boolean;
  flowRunId?: Id<"chatbotFlowRuns">;
  status?: "active" | "completed" | "handed_off" | "timed_out" | "failed";
}> {
  const nodes = nodesByKey((bot.flowNodes ?? []) as FlowNode[]);
  const contact = await ctx.db.get(args.contactId);
  let currentKey = startKey;

  for (let step = 0; step < MAX_RUNTIME_STEPS; step += 1) {
    if (!currentKey) {
      await completeRun(ctx, args, state, "completed_without_next");
      return { consumed: true, flowRunId: state.runId, status: "completed" };
    }
    const node = nodes.get(currentKey);
    if (!node) {
      const run = await ctx.db.get(state.runId);
      if (run) await failRun(ctx, run, `missing_node:${currentKey}`, args.receivedAt);
      return { consumed: true, flowRunId: state.runId, status: "failed" };
    }

    await addEvent(ctx, args, {
      bot,
      runId: state.runId,
      eventType: "node_entered",
      nodeKey: node.key,
      payload: { type: node.type },
    });

    if (node.type === "start") {
      currentKey = node.nextKey;
      continue;
    }

    if (node.type === "send_message") {
      await enqueueFlowText(ctx, args, bot, state.runId, node, "message", {
        body: interpolate(node.body ?? "", state.vars, contact),
      });
      currentKey = node.nextKey;
      continue;
    }

    if (node.type === "send_buttons" || node.type === "send_list") {
      await enqueueFlowText(ctx, args, bot, state.runId, node, node.type, {
        body: renderChoices(node, state.vars, contact),
      });
      await patchActiveRun(ctx, args, state, node.key);
      return { consumed: true, flowRunId: state.runId, status: "active" };
    }

    if (node.type === "collect_input") {
      await enqueueFlowText(ctx, args, bot, state.runId, node, "prompt", {
        body: interpolate(node.body ?? "", state.vars, contact),
      });
      await patchActiveRun(ctx, args, state, node.key);
      return { consumed: true, flowRunId: state.runId, status: "active" };
    }

    if (node.type === "condition") {
      currentKey = evaluateCondition(node, state.vars)
        ? node.condition?.trueNextKey
        : node.condition?.falseNextKey;
      continue;
    }

    if (node.type === "set_tag") {
      const tag = interpolate(node.tag ?? node.body ?? "", state.vars, contact).trim();
      if (tag) {
        await addContactTag(ctx, args.contactId, tag);
        await addEvent(ctx, args, {
          bot,
          runId: state.runId,
          eventType: "tag_set",
          nodeKey: node.key,
          payload: { tagApplied: true, tagLength: tag.length },
        });
      }
      currentKey = node.nextKey;
      continue;
    }

    if (node.type === "handoff") {
      await addContactTag(ctx, args.contactId, HANDOFF_TAG);
      await addConversationTag(ctx, args.conversationId, HANDOFF_TAG);
      await enqueueFlowText(ctx, args, bot, state.runId, node, "handoff", {
        body: HANDOFF_COPY,
      });
      await ctx.db.patch(state.runId, {
        status: "handed_off",
        currentNodeKey: node.key,
        vars: state.vars,
        endedAt: args.receivedAt,
        endReason: "handoff",
        lastAdvancedAt: args.receivedAt,
        lastInboundMessageId: args.inboundMessageId,
      });
      await addEvent(ctx, args, {
        bot,
        runId: state.runId,
        eventType: "handoff",
        nodeKey: node.key,
        payload: { tag: HANDOFF_TAG },
      });
      return { consumed: true, flowRunId: state.runId, status: "handed_off" };
    }

    if (node.type === "end") {
      await completeRun(ctx, args, state, "end_node");
      return { consumed: true, flowRunId: state.runId, status: "completed" };
    }
  }

  const run = await ctx.db.get(state.runId);
  if (run) await failRun(ctx, run, "max_runtime_steps_exceeded", args.receivedAt);
  return { consumed: true, flowRunId: state.runId, status: "failed" };
}

async function repromptNode(
  ctx: any,
  args: DispatchArgs,
  bot: Doc<"chatbots">,
  run: Doc<"chatbotFlowRuns">,
  node: FlowNode,
) {
  const contact = await ctx.db.get(args.contactId);
  const nextState = {
    runId: run._id,
    vars: run.vars ?? {},
    repromptCount: run.repromptCount + 1,
  };
  const body =
    node.type === "send_buttons" || node.type === "send_list"
      ? renderChoices(node, nextState.vars, contact)
      : interpolate(node.body ?? "", nextState.vars, contact);
  await enqueueFlowText(ctx, args, bot, run._id, node, "reprompt", {
    body,
  });
  await patchActiveRun(ctx, args, nextState, node.key);
  return { consumed: true, flowRunId: run._id, status: "active" as const };
}

async function enqueueFlowText(
  ctx: any,
  args: DispatchArgs,
  bot: Doc<"chatbots">,
  runId: Id<"chatbotFlowRuns">,
  node: FlowNode,
  kind: string,
  message: { body: string },
): Promise<Id<"messages"> | null> {
  const body = message.body.trim().slice(0, 4096);
  if (!body) return null;
  const now = Date.now();
  const businessKey = `flow:${runId}:${node.key}:${kind}:${args.metaMessageId}`;
  const existing = await ctx.db
    .query("messages")
    .withIndex("by_business_key", (q: any) => q.eq("businessKey", businessKey))
    .unique();
  if (existing) return existing._id;

  const messageId = await ctx.db.insert("messages", {
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    direction: "outgoing",
    businessKey,
    type: "text",
    content: {
      text: { body },
      flow: {
        chatbotId: bot._id,
        flowRunId: runId,
        nodeKey: node.key,
        kind,
      },
    },
    status: "queued",
    dispatchAttempts: 0,
    sentByChatbotId: bot._id,
    sentByFlowRunId: runId,
    createdAt: now,
  });
  await ctx.db.patch(args.conversationId, { lastMessageAt: now });
  await ctx.scheduler.runAfter(0, internal.messages._dispatchOne, { messageId });
  await addEvent(ctx, args, {
    bot,
    runId,
    eventType: "message_sent",
    nodeKey: node.key,
    payload: { kind, textLength: body.length },
  });
  return messageId;
}

async function patchActiveRun(
  ctx: any,
  args: DispatchArgs,
  state: RunState,
  currentNodeKey: string,
): Promise<void> {
  await ctx.db.patch(state.runId, {
    status: "active",
    currentNodeKey,
    vars: state.vars,
    repromptCount: state.repromptCount,
    lastAdvancedAt: args.receivedAt,
    lastInboundMessageId: args.inboundMessageId,
  });
}

async function completeRun(
  ctx: any,
  args: DispatchArgs,
  state: RunState,
  reason: string,
): Promise<void> {
  await ctx.db.patch(state.runId, {
    status: "completed",
    currentNodeKey: undefined,
    vars: state.vars,
    endedAt: args.receivedAt,
    endReason: reason,
    lastAdvancedAt: args.receivedAt,
    lastInboundMessageId: args.inboundMessageId,
  });
  const run = await ctx.db.get(state.runId);
  if (run) {
    await ctx.db.insert("chatbotFlowEvents", {
      tenantId: run.tenantId,
      chatbotId: run.chatbotId,
      flowRunId: run._id,
      conversationId: run.conversationId,
      contactId: run.contactId,
      eventType: "completed",
      payload: { reason },
      createdAt: args.receivedAt,
    });
  }
}

async function failRun(
  ctx: any,
  run: Doc<"chatbotFlowRuns">,
  reason: string,
  now: number,
): Promise<void> {
  await ctx.db.patch(run._id, {
    status: "failed",
    endedAt: now,
    endReason: reason,
    lastAdvancedAt: now,
  });
  await ctx.db.insert("chatbotFlowEvents", {
    tenantId: run.tenantId,
    chatbotId: run.chatbotId,
    flowRunId: run._id,
    conversationId: run.conversationId,
    contactId: run.contactId,
    eventType: "error",
    payload: { reason },
    createdAt: now,
  });
}

async function addEvent(
  ctx: any,
  args: DispatchArgs,
  event: {
    bot: Doc<"chatbots">;
    runId: Id<"chatbotFlowRuns">;
    eventType:
      | "started"
      | "node_entered"
      | "message_sent"
      | "reply_received"
      | "fallback_fired"
      | "tag_set"
      | "handoff";
    nodeKey?: string;
    metaMessageId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.db.insert("chatbotFlowEvents", {
    tenantId: args.tenantId,
    chatbotId: event.bot._id,
    flowRunId: event.runId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    eventType: event.eventType,
    nodeKey: event.nodeKey,
    metaMessageId: event.metaMessageId,
    payload: event.payload,
    createdAt: args.receivedAt,
  });
}

async function addContactTag(
  ctx: any,
  contactId: Id<"contacts">,
  tag: string,
): Promise<void> {
  const contact = await ctx.db.get(contactId);
  if (!contact) return;
  const normalized = tag.trim();
  if (!normalized) return;
  const tags = new Set(contact.tags ?? []);
  tags.add(normalized);
  await ctx.db.patch(contactId, { tags: Array.from(tags) });
}

async function addConversationTag(
  ctx: any,
  conversationId: Id<"conversations">,
  tag: string,
): Promise<void> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) return;
  const tags = new Set(conversation.tags ?? []);
  tags.add(tag);
  await ctx.db.patch(conversationId, {
    tags: Array.from(tags),
    aiState: conversation.aiState === "eligible" ? "paused" : conversation.aiState,
    aiPausedReason:
      conversation.aiState === "eligible" ? "flow_handoff" : conversation.aiPausedReason,
  });
}

function nodesByKey(nodes: FlowNode[]): Map<string, FlowNode> {
  return new Map(nodes.map((node) => [node.key, node]));
}

function matchChoice(
  choices: NonNullable<FlowNode["buttons"]>,
  input: { replyId?: string; text?: string },
): NonNullable<FlowNode["buttons"]>[number] | null {
  const replyId = normalizeText(input.replyId ?? "");
  const text = normalizeText(input.text ?? "");
  return (
    choices.find((choice, index) => {
      const id = normalizeText(choice.replyId);
      const label = normalizeText(choice.label);
      return (
        (replyId && replyId === id) ||
        (text && (text === id || text === label || text === String(index + 1)))
      );
    }) ?? null
  );
}

function renderChoices(
  node: FlowNode,
  vars: Record<string, string>,
  contact: Doc<"contacts"> | null,
): string {
  const body = interpolate(node.body ?? "", vars, contact);
  const rows = (node.buttons ?? []).map(
    (button, index) => `${index + 1}. ${button.label}`,
  );
  return [body, rows.join("\n")].filter(Boolean).join("\n\n");
}

function evaluateCondition(node: FlowNode, vars: Record<string, string>): boolean {
  const condition = node.condition;
  if (!condition) return false;
  const actual = vars[condition.variableKey]?.trim() ?? "";
  const expected = condition.value?.trim() ?? "";
  if (condition.operator === "present") return actual.length > 0;
  if (condition.operator === "absent") return actual.length === 0;
  if (condition.operator === "equals") {
    return normalizeText(actual) === normalizeText(expected);
  }
  return normalizeText(actual).includes(normalizeText(expected));
}

function interpolate(
  template: string,
  vars: Record<string, string>,
  contact: Doc<"contacts"> | null,
): string {
  return template.replace(
    /\{\{\s*(vars|contact)\.([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, scope: "vars" | "contact", key: string) => {
      if (scope === "vars") return vars[key] ?? "";
      if (key === "name") return contact?.name ?? "";
      if (key === "phone") return contact?.e164 ?? "";
      if (key === "username") return contact?.whatsappUsername ?? "";
      return "";
    },
  );
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
