import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { tenantQuery } from "./lib/customFunctions";

const PROVIDER = "iasolution_hub" as const;
const MAX_RUNTIME_STEPS = 24;
const MAX_REPROMPTS = 3;
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1_000;
const STOP_WORDS = new Set(["stop", "parar", "sair", "cancelar"]);
const HANDOFF_TAG = "handoff_requested";
const HANDOFF_COPY =
  "Obrigado. A nossa equipa humana vai continuar o atendimento daqui.";

const runStatusValidator = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("handed_off"),
  v.literal("timed_out"),
  v.literal("stopped"),
  v.literal("failed"),
);

const dispatchStatusValidator = v.union(
  v.literal("accepted"),
  v.literal("failed"),
  v.literal("unknown"),
);

type RunStatus =
  | "active"
  | "completed"
  | "handed_off"
  | "timed_out"
  | "stopped"
  | "failed";

type FlowNode = NonNullable<Doc<"chatbots">["flowNodes"]>[number];
type RunState = {
  runId: Id<"channelAutomationRuns">;
  vars: Record<string, string>;
  repromptCount: number;
};

type InboundContent = {
  text?: string;
  replyId?: string;
  isCtwa: boolean;
  isHandoff: boolean;
};

const dispatchResultValidator = v.object({
  consumed: v.boolean(),
  idempotent: v.optional(v.boolean()),
  runId: v.optional(v.id("channelAutomationRuns")),
  status: v.optional(runStatusValidator),
});

export const dispatchInbound = internalMutation({
  args: {
    eventId: v.id("channelEvents"),
    /** Test/recovery hook. Production webhook ingestion never disables it. */
    deferOutbound: v.optional(v.boolean()),
  },
  returns: dispatchResultValidator,
  handler: async (ctx, args): Promise<{
    consumed: boolean;
    idempotent?: boolean;
    runId?: Id<"channelAutomationRuns">;
    status?: RunStatus;
  }> => {
    const event = await ctx.db.get(args.eventId);
    if (
      !event ||
      event.status !== "processed" ||
      event.direction !== "incoming" ||
      !event.eventKind.startsWith("message.") ||
      !event.threadKey
    ) {
      return { consumed: false };
    }
    const channel = await ctx.db.get(event.channelId);
    if (
      !channel ||
      channel.provider !== PROVIDER ||
      channel.operationalTerritory !== "openbsp"
    ) {
      return { consumed: false };
    }
    const thread = await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_thread", (q) =>
        q.eq("channelId", channel._id).eq("threadKey", event.threadKey!),
      )
      .unique();
    if (!thread || thread.tenantId !== channel.tenantId) {
      return { consumed: false };
    }

    const prior = await ctx.db
      .query("channelAutomationEvents")
      .withIndex("by_channel_source_event", (q) =>
        q.eq("channelId", channel._id).eq("sourceEventId", event._id),
      )
      .first();
    if (prior) {
      const run = await ctx.db.get(prior.runId);
      return {
        consumed: true,
        idempotent: true,
        runId: prior.runId,
        status: run?.status,
      };
    }

    const inbound = extractInbound(event);
    const activeRun = await ctx.db
      .query("channelAutomationRuns")
      .withIndex("by_thread_status", (q) =>
        q
          .eq("channelId", channel._id)
          .eq("threadId", thread._id)
          .eq("status", "active"),
      )
      .first();

    if (isStop(inbound)) {
      if (activeRun) {
        const bot = await ctx.db.get(activeRun.chatbotId);
        if (bot) {
          await addEvent(ctx, {
            run: activeRun,
            eventType: "stopped",
            sourceEventId: event._id,
            nodeKey: activeRun.currentNodeKey,
            payload: { reason: "contact_stop_keyword" },
          });
        }
        await ctx.db.patch(activeRun._id, {
          status: "stopped",
          endedAt: event.receivedAt,
          endReason: "contact_stop_keyword",
          pendingDispatchId: undefined,
          lastInboundEventId: event._id,
          lastAdvancedAt: event.receivedAt,
        });
      }
      await setThreadMode(ctx, thread, "stopped", "contact_stop_keyword");
      return {
        consumed: true,
        runId: activeRun?._id,
        status: activeRun ? "stopped" : undefined,
      };
    }

    if (activeRun) {
      const bot = await ctx.db.get(activeRun.chatbotId);
      if (
        !bot ||
        bot.status !== "active" ||
        bot.channelId !== channel._id ||
        thread.automationMode === "human" ||
        thread.automationMode === "stopped"
      ) {
        await stopRun(ctx, activeRun, event, "automation_not_available");
        return { consumed: false, runId: activeRun._id, status: "stopped" };
      }
      return await advanceActiveRun(
        ctx,
        event,
        thread,
        bot,
        activeRun,
        inbound,
        args.deferOutbound !== true,
      );
    }

    const bot = await findMatchingBot(ctx, channel._id, event, inbound);
    if (
      thread.automationMode === "stopped" ||
      (thread.automationMode === "human" && bot?.triggerKind !== "keyword")
    ) {
      return { consumed: false };
    }
    if (!bot?.entryNodeKey || !bot.flowNodes?.length) {
      return { consumed: false };
    }
    const runId = await ctx.db.insert("channelAutomationRuns", {
      tenantId: channel.tenantId,
      chatbotId: bot._id,
      channelId: channel._id,
      threadId: thread._id,
      threadKey: thread.threadKey,
      status: "active",
      currentNodeKey: bot.entryNodeKey,
      vars: {},
      repromptCount: 0,
      startedAt: event.receivedAt,
      lastAdvancedAt: event.receivedAt,
      lastInboundEventId: event._id,
    });
    const run = (await ctx.db.get(runId))!;
    await setThreadMode(ctx, thread, "bot", `chatbot:${bot._id}`);
    await addEvent(ctx, {
      run,
      eventType: "started",
      sourceEventId: event._id,
      payload: {
        triggerKind: bot.triggerKind,
        hasReplyId: Boolean(inbound.replyId),
        textLength: inbound.text?.length ?? 0,
      },
    });
    return await enterFlow(ctx, event, thread, bot, {
      runId,
      vars: {},
      repromptCount: 0,
    }, bot.entryNodeKey, args.deferOutbound !== true);
  },
});

export const pauseForHuman = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    threadKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_thread", (q) =>
        q.eq("channelId", args.channelId).eq("threadKey", args.threadKey),
      )
      .unique();
    if (!thread || thread.tenantId !== args.tenantId) return null;
    const run = await ctx.db
      .query("channelAutomationRuns")
      .withIndex("by_thread_status", (q) =>
        q
          .eq("channelId", args.channelId)
          .eq("threadId", thread._id)
          .eq("status", "active"),
      )
      .first();
    const now = Date.now();
    if (run) {
      await ctx.db.patch(run._id, {
        status: "stopped",
        pendingDispatchId: undefined,
        endedAt: now,
        endReason: "human_operator_reply",
        lastAdvancedAt: now,
      });
      await addEvent(ctx, {
        run,
        eventType: "stopped",
        nodeKey: run.currentNodeKey,
        payload: { reason: "human_operator_reply" },
      });
    }
    await setThreadMode(ctx, thread, "human", "human_operator_reply");
    return null;
  },
});

export const loadDispatch = internalQuery({
  args: { dispatchId: v.id("channelAutomationDispatches") },
  returns: v.union(
    v.object({
      dispatchId: v.id("channelAutomationDispatches"),
      tenantId: v.id("tenants"),
      memberId: v.id("members"),
      channelId: v.id("channels"),
      threadKey: v.string(),
      businessKey: v.string(),
      messageKind: v.union(
        v.literal("text"),
        v.literal("template"),
        v.literal("interactive"),
      ),
      payload: v.any(),
      replyToProviderMessageId: v.optional(v.string()),
      autoDispatch: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);
    if (!dispatch || dispatch.status !== "queued") return null;
    const [run, bot, channel, thread] = await Promise.all([
      ctx.db.get(dispatch.runId),
      ctx.db.get(dispatch.chatbotId),
      ctx.db.get(dispatch.channelId),
      ctx.db.get(dispatch.threadId),
    ]);
    const runAllowed =
      run?.status === "active" ||
      (dispatch.resumeMode === "terminal" && run?.status === "handed_off");
    if (
      !runAllowed ||
      !bot ||
      bot.channelId !== dispatch.channelId ||
      !channel ||
      channel.provider !== PROVIDER ||
      channel.operationalTerritory !== "openbsp" ||
      channel.tenantId !== dispatch.tenantId ||
      !thread ||
      thread.channelId !== channel._id ||
      thread.threadKey !== dispatch.threadKey
    ) {
      return null;
    }
    return {
      dispatchId: dispatch._id,
      tenantId: dispatch.tenantId,
      memberId: dispatch.createdBy,
      channelId: dispatch.channelId,
      threadKey: dispatch.threadKey,
      businessKey: dispatch.businessKey,
      messageKind: dispatch.messageKind,
      payload: dispatch.payload,
      replyToProviderMessageId: dispatch.replyToProviderMessageId,
      autoDispatch: dispatch.autoDispatch,
    };
  },
});

export const settleDispatch = internalMutation({
  args: {
    dispatchId: v.id("channelAutomationDispatches"),
    status: dispatchStatusValidator,
    outboxId: v.optional(v.id("channelOutbox")),
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const dispatch = await ctx.db.get(args.dispatchId);
    if (!dispatch || dispatch.status !== "queued") return null;
    const now = Date.now();
    await ctx.db.patch(dispatch._id, {
      status: args.status,
      outboxId: args.outboxId,
      providerMessageId: args.providerMessageId,
      failureReason: args.failureReason?.slice(0, 500),
      updatedAt: now,
    });
    const run = await ctx.db.get(dispatch.runId);
    if (!run) return null;
    await addEvent(ctx, {
      run,
      eventType: args.status === "accepted" ? "message_sent" : "error",
      sourceEventId: dispatch.sourceEventId,
      nodeKey: dispatch.nodeKey,
      payload: {
        status: args.status,
        outboxId: args.outboxId,
        hasProviderMessageId: Boolean(args.providerMessageId),
        reason: args.failureReason?.slice(0, 160),
      },
    });
    if (args.status !== "accepted") {
      if (run.status === "active") {
        await failRun(ctx, run, `outbound_${args.status}`, now);
        const thread = await ctx.db.get(run.threadId);
        if (thread) {
          await setThreadMode(ctx, thread, "human", `outbound_${args.status}`);
        }
      }
      return null;
    }
    if (dispatch.resumeMode === "terminal" || run.status !== "active") {
      return null;
    }
    if (run.pendingDispatchId !== dispatch._id) return null;
    const [sourceEvent, thread, bot] = await Promise.all([
      ctx.db.get(dispatch.sourceEventId),
      ctx.db.get(dispatch.threadId),
      ctx.db.get(dispatch.chatbotId),
    ]);
    if (!sourceEvent || !thread || !bot || bot.status !== "active") {
      await failRun(ctx, run, "dispatch_resume_context_missing", now);
      return null;
    }
    await ctx.db.patch(run._id, {
      pendingDispatchId: undefined,
      currentNodeKey:
        dispatch.resumeMode === "wait_input"
          ? dispatch.waitNodeKey
          : dispatch.nextNodeKey,
      lastAdvancedAt: now,
    });
    if (dispatch.resumeMode === "continue") {
      await enterFlow(
        ctx,
        sourceEvent,
        thread,
        bot,
        {
          runId: run._id,
          vars: run.vars ?? {},
          repromptCount: run.repromptCount,
        },
        dispatch.nextNodeKey,
        dispatch.autoDispatch,
      );
    }
    return null;
  },
});

export const sweepStaleRuns = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ timedOut: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const cutoff = now - (args.olderThanMs ?? DEFAULT_STALE_MS);
    const runs = await ctx.db
      .query("channelAutomationRuns")
      .withIndex("by_status_last_advanced", (q) =>
        q.eq("status", "active").lt("lastAdvancedAt", cutoff),
      )
      .take(Math.min(args.limit ?? 100, 500));
    for (const run of runs) {
      await ctx.db.patch(run._id, {
        status: "timed_out",
        pendingDispatchId: undefined,
        endedAt: now,
        endReason: "stale_run_timeout",
        lastAdvancedAt: now,
      });
      await addEvent(ctx, {
        run,
        eventType: "timeout",
        nodeKey: run.currentNodeKey,
        payload: { staleForMs: now - run.lastAdvancedAt },
      });
      const thread = await ctx.db.get(run.threadId);
      if (thread) await setThreadMode(ctx, thread, "idle", "stale_run_timeout");
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
      _id: v.id("channelAutomationRuns"),
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
          _id: v.id("channelAutomationEvents"),
          eventType: v.string(),
          nodeKey: v.optional(v.string()),
          payload: v.optional(v.any()),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const bot = await ctx.db.get(args.chatbotId);
    if (!bot || bot.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHATBOT_NOT_FOUND" });
    }
    const runs = await ctx.db
      .query("channelAutomationRuns")
      .withIndex("by_chatbot_started", (q) => q.eq("chatbotId", bot._id))
      .order("desc")
      .take(Math.min(args.limit ?? 12, 50));
    return await Promise.all(
      runs.map(async (run) => {
        const thread = await ctx.db.get(run.threadId);
        const identity = thread?.identityId
          ? await ctx.db.get(thread.identityId)
          : null;
        const events = await ctx.db
          .query("channelAutomationEvents")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .order("desc")
          .take(100);
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
          contactName: identity?.displayName,
          contactHandle: identity?.phone ?? identity?.username ?? run.threadKey,
          eventCount: events.length,
          events: events.slice(0, 12).reverse().map((event) => ({
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

async function advanceActiveRun(
  ctx: any,
  event: Doc<"channelEvents">,
  thread: Doc<"channelThreads">,
  bot: Doc<"chatbots">,
  run: Doc<"channelAutomationRuns">,
  inbound: InboundContent,
  autoDispatch: boolean,
) {
  await addEvent(ctx, {
    run,
    eventType: "reply_received",
    sourceEventId: event._id,
    nodeKey: run.currentNodeKey,
    payload: {
      hasReplyId: Boolean(inbound.replyId),
      replyId: inbound.replyId,
      textLength: inbound.text?.length ?? 0,
    },
  });
  if (run.pendingDispatchId) {
    await ctx.db.patch(run._id, {
      status: "handed_off",
      pendingDispatchId: undefined,
      endedAt: event.receivedAt,
      endReason: "inbound_while_dispatch_pending",
      lastInboundEventId: event._id,
      lastAdvancedAt: event.receivedAt,
    });
    await setThreadMode(
      ctx,
      thread,
      "human",
      "inbound_while_dispatch_pending",
    );
    await addEvent(ctx, {
      run,
      eventType: "handoff",
      sourceEventId: event._id,
      nodeKey: run.currentNodeKey,
      payload: { reason: "inbound_while_dispatch_pending" },
    });
    return { consumed: true, runId: run._id, status: "handed_off" as const };
  }
  const nodes = nodesByKey(bot.flowNodes ?? []);
  const current = run.currentNodeKey ? nodes.get(run.currentNodeKey) : undefined;
  if (!current) {
    await failRun(ctx, run, "missing_current_node", event.receivedAt);
    return { consumed: true, runId: run._id, status: "failed" as const };
  }
  const vars = { ...(run.vars ?? {}) };
  if (current.type === "collect_input") {
    const value = (inbound.text || inbound.replyId || "").trim().slice(0, 500);
    if (!value) {
      return await reprompt(ctx, event, thread, bot, run, current, autoDispatch);
    }
    if (current.variableKey) vars[current.variableKey] = value;
    return await enterFlow(ctx, event, thread, bot, {
      runId: run._id,
      vars,
      repromptCount: run.repromptCount,
    }, current.nextKey, autoDispatch);
  }
  if (current.type === "send_buttons" || current.type === "send_list") {
    const choice = matchChoice(current.buttons ?? [], inbound);
    if (!choice) {
      return await reprompt(ctx, event, thread, bot, run, current, autoDispatch);
    }
    if (current.variableKey) vars[current.variableKey] = choice.replyId;
    return await enterFlow(ctx, event, thread, bot, {
      runId: run._id,
      vars,
      repromptCount: run.repromptCount,
    }, choice.nextKey, autoDispatch);
  }
  await failRun(ctx, run, "unexpected_reply_state", event.receivedAt);
  return { consumed: true, runId: run._id, status: "failed" as const };
}

async function enterFlow(
  ctx: any,
  sourceEvent: Doc<"channelEvents">,
  thread: Doc<"channelThreads">,
  bot: Doc<"chatbots">,
  state: RunState,
  startKey?: string,
  autoDispatch = true,
): Promise<{ consumed: true; runId: Id<"channelAutomationRuns">; status: RunStatus }> {
  const nodes = nodesByKey(bot.flowNodes ?? []);
  const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
  let currentKey = startKey;
  for (let step = 0; step < MAX_RUNTIME_STEPS; step += 1) {
    const run = await ctx.db.get(state.runId);
    if (!run || run.status !== "active") {
      return { consumed: true, runId: state.runId, status: run?.status ?? "failed" };
    }
    if (!currentKey) {
      await completeRun(ctx, run, thread, "completed_without_next");
      return { consumed: true, runId: state.runId, status: "completed" };
    }
    const node = nodes.get(currentKey);
    if (!node) {
      await failRun(ctx, run, `missing_node:${currentKey}`, sourceEvent.receivedAt);
      await setThreadMode(ctx, thread, "human", `missing_node:${currentKey}`);
      return { consumed: true, runId: state.runId, status: "failed" };
    }
    await addEvent(ctx, {
      run,
      eventType: "node_entered",
      sourceEventId: sourceEvent._id,
      nodeKey: node.key,
      payload: { type: node.type },
    });
    if (node.type === "start") {
      currentKey = node.nextKey;
      continue;
    }
    if (node.type === "condition") {
      currentKey = evaluateCondition(node, state.vars)
        ? node.condition?.trueNextKey
        : node.condition?.falseNextKey;
      continue;
    }
    if (node.type === "set_tag") {
      const tag = interpolate(node.tag ?? node.body ?? "", state.vars, identity).trim();
      if (tag) {
        await addThreadTag(ctx, thread, tag);
        await addEvent(ctx, {
          run,
          eventType: "tag_set",
          sourceEventId: sourceEvent._id,
          nodeKey: node.key,
          payload: { tag },
        });
      }
      currentKey = node.nextKey;
      continue;
    }
    if (node.type === "end") {
      await completeRun(ctx, run, thread, "end_node");
      return { consumed: true, runId: state.runId, status: "completed" };
    }
    if (node.type === "handoff") {
      await addThreadTag(ctx, thread, HANDOFF_TAG);
      await ctx.db.patch(run._id, {
        status: "handed_off",
        currentNodeKey: node.key,
        vars: state.vars,
        pendingDispatchId: undefined,
        endedAt: sourceEvent.receivedAt,
        endReason: "handoff",
        lastAdvancedAt: sourceEvent.receivedAt,
      });
      await setThreadMode(ctx, thread, "human", "flow_handoff");
      await addEvent(ctx, {
        run,
        eventType: "handoff",
        sourceEventId: sourceEvent._id,
        nodeKey: node.key,
        payload: { tag: HANDOFF_TAG },
      });
      if (
        thread.serviceWindowExpiresAt &&
        thread.serviceWindowExpiresAt > Date.now()
      ) {
        await enqueueDispatch(ctx, sourceEvent, thread, bot, run, node, {
          messageKind: "text",
          payload: { text: HANDOFF_COPY, previewUrl: false },
          resumeMode: "terminal",
          businessSuffix: "handoff",
        }, autoDispatch);
      } else {
        await addEvent(ctx, {
          run,
          eventType: "message_skipped",
          sourceEventId: sourceEvent._id,
          nodeKey: node.key,
          payload: { reason: "outside_service_window", kind: "handoff" },
        });
      }
      return { consumed: true, runId: state.runId, status: "handed_off" };
    }
    if (node.type === "send_template") {
      const binding = node.channelTemplate;
      const template = binding ? await ctx.db.get(binding.templateId) : null;
      if (
        !binding ||
        !template ||
        template.channelId !== bot.channelId ||
        !["approved", "active"].includes(template.status.toLowerCase())
      ) {
        await failRun(ctx, run, "channel_template_not_available", Date.now());
        await setThreadMode(ctx, thread, "human", "channel_template_not_available");
        return { consumed: true, runId: state.runId, status: "failed" };
      }
      const bodyVariables = Object.keys(binding.variables)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => interpolate(binding.variables[key], state.vars, identity));
      const dispatchId = await enqueueDispatch(ctx, sourceEvent, thread, bot, run, node, {
        messageKind: "template",
        payload: {
          templateName: template.name,
          languageCode: template.languageCode,
          bodyVariables,
        },
        resumeMode: "continue",
        nextNodeKey: node.nextKey,
        businessSuffix: "template",
      }, autoDispatch);
      await markWaitingForDispatch(ctx, run, node.key, dispatchId, state);
      return { consumed: true, runId: state.runId, status: "active" };
    }
    if (node.type === "send_message") {
      const text = interpolate(node.body ?? "", state.vars, identity).trim();
      if (!text) {
        currentKey = node.nextKey;
        continue;
      }
      const dispatchId = await enqueueDispatch(ctx, sourceEvent, thread, bot, run, node, {
        messageKind: "text",
        payload: { text: text.slice(0, 4096), previewUrl: false },
        resumeMode: "continue",
        nextNodeKey: node.nextKey,
        businessSuffix: "message",
      }, autoDispatch);
      await markWaitingForDispatch(ctx, run, node.key, dispatchId, state);
      return { consumed: true, runId: state.runId, status: "active" };
    }
    if (
      node.type === "collect_input" ||
      node.type === "send_buttons" ||
      node.type === "send_list"
    ) {
      const interactive =
        node.type === "collect_input"
          ? null
          : buildInteractive(node, state.vars, identity);
      const text = interpolate(node.body ?? "", state.vars, identity).trim();
      const dispatchId = await enqueueDispatch(ctx, sourceEvent, thread, bot, run, node, {
        messageKind: interactive ? "interactive" : "text",
        payload: interactive
          ? { interactive }
          : { text: text.slice(0, 4096), previewUrl: false },
        resumeMode: "wait_input",
        waitNodeKey: node.key,
        businessSuffix: "prompt",
      }, autoDispatch);
      await markWaitingForDispatch(ctx, run, node.key, dispatchId, state);
      return { consumed: true, runId: state.runId, status: "active" };
    }
  }
  const run = await ctx.db.get(state.runId);
  if (run) {
    await failRun(ctx, run, "max_runtime_steps_exceeded", Date.now());
    await setThreadMode(ctx, thread, "human", "max_runtime_steps_exceeded");
  }
  return { consumed: true, runId: state.runId, status: "failed" };
}

async function reprompt(
  ctx: any,
  event: Doc<"channelEvents">,
  thread: Doc<"channelThreads">,
  bot: Doc<"chatbots">,
  run: Doc<"channelAutomationRuns">,
  node: FlowNode,
  autoDispatch: boolean,
) {
  const nextCount = run.repromptCount + 1;
  if (nextCount > MAX_REPROMPTS) {
    await ctx.db.patch(run._id, {
      status: "handed_off",
      pendingDispatchId: undefined,
      endedAt: event.receivedAt,
      endReason: "reprompt_limit",
      lastAdvancedAt: event.receivedAt,
      lastInboundEventId: event._id,
    });
    await setThreadMode(ctx, thread, "human", "reprompt_limit");
    await addEvent(ctx, {
      run,
      eventType: "handoff",
      sourceEventId: event._id,
      nodeKey: node.key,
      payload: { reason: "reprompt_limit" },
    });
    return { consumed: true, runId: run._id, status: "handed_off" as const };
  }
  await addEvent(ctx, {
    run,
    eventType: "fallback_fired",
    sourceEventId: event._id,
    nodeKey: node.key,
    payload: { reason: "input_not_matched", repromptCount: nextCount },
  });
  const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
  const interactive =
    node.type === "send_buttons" || node.type === "send_list"
      ? buildInteractive(node, run.vars ?? {}, identity)
      : null;
  const text = interpolate(node.body ?? "", run.vars ?? {}, identity).trim();
  const dispatchId = await enqueueDispatch(ctx, event, thread, bot, run, node, {
    messageKind: interactive ? "interactive" : "text",
    payload: interactive
      ? { interactive }
      : { text: text.slice(0, 4096), previewUrl: false },
    resumeMode: "wait_input",
    waitNodeKey: node.key,
    businessSuffix: `reprompt:${nextCount}`,
  }, autoDispatch);
  await ctx.db.patch(run._id, {
    pendingDispatchId: dispatchId,
    currentNodeKey: node.key,
    repromptCount: nextCount,
    lastInboundEventId: event._id,
    lastAdvancedAt: event.receivedAt,
  });
  return { consumed: true, runId: run._id, status: "active" as const };
}

async function enqueueDispatch(
  ctx: any,
  sourceEvent: Doc<"channelEvents">,
  thread: Doc<"channelThreads">,
  bot: Doc<"chatbots">,
  run: Doc<"channelAutomationRuns">,
  node: FlowNode,
  args: {
    messageKind: "text" | "template" | "interactive";
    payload: unknown;
    resumeMode: "continue" | "wait_input" | "terminal";
    nextNodeKey?: string;
    waitNodeKey?: string;
    businessSuffix: string;
  },
  autoDispatch: boolean,
): Promise<Id<"channelAutomationDispatches">> {
  if (
    args.messageKind !== "template" &&
    (!thread.serviceWindowExpiresAt || thread.serviceWindowExpiresAt <= Date.now())
  ) {
    throw new ConvexError({ code: "SERVICE_WINDOW_EXPIRED" });
  }
  const businessKey = `automation:${run._id}:${node.key}:${args.businessSuffix}:${sourceEvent._id}`;
  const existing = await ctx.db
    .query("channelAutomationDispatches")
    .withIndex("by_channel_business_key", (q: any) =>
      q.eq("channelId", run.channelId).eq("businessKey", businessKey),
    )
    .unique();
  if (existing) return existing._id;
  const now = Date.now();
  const dispatchId = await ctx.db.insert("channelAutomationDispatches", {
    tenantId: run.tenantId,
    chatbotId: bot._id,
    runId: run._id,
    channelId: run.channelId,
    threadId: thread._id,
    threadKey: thread.threadKey,
    sourceEventId: sourceEvent._id,
    nodeKey: node.key,
    businessKey,
    messageKind: args.messageKind,
    payload: args.payload,
    replyToProviderMessageId: sourceEvent.providerEventId,
    resumeMode: args.resumeMode,
    autoDispatch,
    nextNodeKey: args.nextNodeKey,
    waitNodeKey: args.waitNodeKey,
    status: "queued",
    createdBy: bot.createdBy,
    createdAt: now,
    updatedAt: now,
  });
  if (autoDispatch) {
    await ctx.scheduler.runAfter(
      0,
      internal.iaSolutionHub.dispatchAutomationMessage,
      { dispatchId },
    );
  }
  return dispatchId;
}

async function markWaitingForDispatch(
  ctx: any,
  run: Doc<"channelAutomationRuns">,
  nodeKey: string,
  dispatchId: Id<"channelAutomationDispatches">,
  state: RunState,
) {
  await ctx.db.patch(run._id, {
    currentNodeKey: nodeKey,
    vars: state.vars,
    repromptCount: state.repromptCount,
    pendingDispatchId: dispatchId,
    lastAdvancedAt: Date.now(),
  });
}

async function findMatchingBot(
  ctx: any,
  channelId: Id<"channels">,
  event: Doc<"channelEvents">,
  inbound: InboundContent,
): Promise<Doc<"chatbots"> | null> {
  const bots = await ctx.db
    .query("chatbots")
    .withIndex("by_channel_status", (q: any) =>
      q.eq("channelId", channelId).eq("status", "active"),
    )
    .take(50);
  const text = normalizeText(inbound.text ?? "");
  for (const bot of bots) {
    if (
      bot.channelId !== channelId ||
      !bot.entryNodeKey ||
      !bot.flowNodes?.some((node: FlowNode) => node.key === bot.entryNodeKey) ||
      bot.flowValidationIssues?.some(
        (issue: { severity: string }) => issue.severity === "error",
      )
    ) {
      continue;
    }
    if (bot.triggerKind === "inbound" && (text || inbound.replyId)) return bot;
    if (bot.triggerKind === "ctwa" && inbound.isCtwa) return bot;
    if (bot.triggerKind === "handoff" && inbound.isHandoff) return bot;
    if (
      bot.triggerKind === "keyword" &&
      (bot.triggerKeywords ?? []).some((keyword: string) =>
        text.includes(normalizeText(keyword)),
      )
    ) {
      return bot;
    }
  }
  return null;
}

async function addEvent(
  ctx: any,
  args: {
    run: Doc<"channelAutomationRuns">;
    eventType:
      | "started"
      | "node_entered"
      | "message_sent"
      | "message_skipped"
      | "reply_received"
      | "fallback_fired"
      | "tag_set"
      | "handoff"
      | "completed"
      | "timeout"
      | "stopped"
      | "error";
    sourceEventId?: Id<"channelEvents">;
    nodeKey?: string;
    payload?: unknown;
  },
) {
  await ctx.db.insert("channelAutomationEvents", {
    tenantId: args.run.tenantId,
    chatbotId: args.run.chatbotId,
    runId: args.run._id,
    channelId: args.run.channelId,
    threadId: args.run.threadId,
    sourceEventId: args.sourceEventId,
    eventType: args.eventType,
    nodeKey: args.nodeKey,
    payload: args.payload,
    createdAt: Date.now(),
  });
}

async function completeRun(
  ctx: any,
  run: Doc<"channelAutomationRuns">,
  thread: Doc<"channelThreads">,
  reason: string,
) {
  const now = Date.now();
  await ctx.db.patch(run._id, {
    status: "completed",
    pendingDispatchId: undefined,
    endedAt: now,
    endReason: reason,
    lastAdvancedAt: now,
  });
  await addEvent(ctx, {
    run,
    eventType: "completed",
    nodeKey: run.currentNodeKey,
    payload: { reason },
  });
  await setThreadMode(ctx, thread, "idle", reason);
}

async function failRun(
  ctx: any,
  run: Doc<"channelAutomationRuns">,
  reason: string,
  now: number,
) {
  await ctx.db.patch(run._id, {
    status: "failed",
    pendingDispatchId: undefined,
    endedAt: now,
    endReason: reason.slice(0, 200),
    lastAdvancedAt: now,
  });
  await addEvent(ctx, {
    run,
    eventType: "error",
    nodeKey: run.currentNodeKey,
    payload: { reason: reason.slice(0, 200) },
  });
}

async function stopRun(
  ctx: any,
  run: Doc<"channelAutomationRuns">,
  event: Doc<"channelEvents">,
  reason: string,
) {
  await ctx.db.patch(run._id, {
    status: "stopped",
    pendingDispatchId: undefined,
    endedAt: event.receivedAt,
    endReason: reason,
    lastInboundEventId: event._id,
    lastAdvancedAt: event.receivedAt,
  });
  await addEvent(ctx, {
    run,
    eventType: "stopped",
    sourceEventId: event._id,
    nodeKey: run.currentNodeKey,
    payload: { reason },
  });
}

async function setThreadMode(
  ctx: any,
  thread: Doc<"channelThreads">,
  mode: "idle" | "bot" | "human" | "stopped",
  reason: string,
) {
  await ctx.db.patch(thread._id, {
    automationMode: mode,
    automationChangedAt: Date.now(),
    automationChangeReason: reason.slice(0, 200),
    updatedAt: Date.now(),
  });
}

async function addThreadTag(
  ctx: any,
  thread: Doc<"channelThreads">,
  rawTag: string,
) {
  const tag = rawTag.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 64);
  if (!tag) return;
  const tags = Array.from(new Set([...(thread.tags ?? []), tag])).slice(0, 50);
  await ctx.db.patch(thread._id, { tags, updatedAt: Date.now() });
  thread.tags = tags;
}

function nodesByKey(nodes: FlowNode[]): Map<string, FlowNode> {
  return new Map(nodes.map((node) => [node.key, node]));
}

function extractInbound(event: Doc<"channelEvents">): InboundContent {
  const payload = object(event.payload);
  const message = object(payload?.message);
  const text = object(message?.text);
  const interactive = object(message?.interactive);
  const buttonReply = object(interactive?.button_reply);
  const listReply = object(interactive?.list_reply);
  const button = object(message?.button);
  const referral = object(message?.referral) ?? object(payload?.referral);
  const normalizedText = string(payload?.normalizedText);
  const body =
    normalizedText ??
    string(text?.body) ??
    string(message?.body) ??
    string(buttonReply?.title) ??
    string(listReply?.title) ??
    string(button?.text);
  const replyId =
    string(buttonReply?.id) ??
    string(listReply?.id) ??
    string(button?.payload);
  return {
    text: body,
    replyId,
    isCtwa: Boolean(referral || message?.referral),
    isHandoff:
      event.eventKind === "event.handoff" ||
      payload?.handoff === true ||
      message?.handoff === true,
  };
}

function buildInteractive(
  node: FlowNode,
  vars: Record<string, string>,
  identity: Doc<"channelIdentities"> | null,
) {
  const body = interpolate(node.body ?? "", vars, identity).slice(0, 1_024);
  const choices = node.buttons ?? [];
  if (node.type === "send_buttons") {
    return {
      type: "button",
      body: { text: body },
      action: {
        buttons: choices.slice(0, 3).map((choice) => ({
          type: "reply",
          reply: { id: choice.replyId, title: choice.label.slice(0, 20) },
        })),
      },
    };
  }
  return {
    type: "list",
    body: { text: body },
    action: {
      button: "Escolher",
      sections: [
        {
          title: node.title.slice(0, 24),
          rows: choices.slice(0, 10).map((choice) => ({
            id: choice.replyId,
            title: choice.label.slice(0, 24),
          })),
        },
      ],
    },
  };
}

function matchChoice(
  choices: NonNullable<FlowNode["buttons"]>,
  inbound: InboundContent,
) {
  const replyId = normalizeText(inbound.replyId ?? "");
  const text = normalizeText(inbound.text ?? "");
  if (replyId) {
    const byId = choices.find((choice) => normalizeText(choice.replyId) === replyId);
    if (byId) return byId;
  }
  const byLabel = choices.find((choice) => normalizeText(choice.label) === text);
  if (byLabel) return byLabel;
  const number = Number(text);
  return Number.isInteger(number) && number >= 1 && number <= choices.length
    ? choices[number - 1]
    : undefined;
}

function evaluateCondition(node: FlowNode, vars: Record<string, string>): boolean {
  const condition = node.condition;
  if (!condition) return false;
  const actual = normalizeText(vars[condition.variableKey] ?? "");
  const expected = normalizeText(condition.value ?? "");
  if (condition.operator === "present") return actual.length > 0;
  if (condition.operator === "absent") return actual.length === 0;
  if (condition.operator === "equals") return actual === expected;
  if (condition.operator === "contains") return actual.includes(expected);
  if (condition.operator === "starts_with") return actual.startsWith(expected);
  if (condition.operator === "ends_with") return actual.endsWith(expected);
  return false;
}

function interpolate(
  input: string,
  vars: Record<string, string>,
  identity: Doc<"channelIdentities"> | null,
): string {
  return input.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (key.startsWith("vars.")) return vars[key.slice(5)] ?? "";
    if (key === "contact.name") return identity?.displayName ?? "";
    if (key === "contact.phone") return identity?.phone ?? "";
    return vars[key] ?? "";
  });
}

function isStop(inbound: InboundContent): boolean {
  const value = normalizeText(inbound.text ?? inbound.replyId ?? "");
  return STOP_WORDS.has(value);
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function object(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
