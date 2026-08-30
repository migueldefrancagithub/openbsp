import { ConvexError, v } from "convex/values";
import {
  loadByIdInTenant,
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import type { Doc, Id } from "./_generated/dataModel";

const NAME_MIN = 2;
const NAME_MAX = 80;

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
);

const triggerValidator = v.union(
  v.literal("inbound"),
  v.literal("keyword"),
  v.literal("ctwa"),
  v.literal("handoff"),
);

const flowTemplateSlugValidator = v.union(
  v.literal("welcome_menu"),
  v.literal("clinic_lead_capture"),
  v.literal("faq_handoff"),
);

const flowNodeTypeValidator = v.union(
  v.literal("start"),
  v.literal("send_message"),
  v.literal("send_template"),
  v.literal("send_buttons"),
  v.literal("send_list"),
  v.literal("collect_input"),
  v.literal("condition"),
  v.literal("set_tag"),
  v.literal("handoff"),
  v.literal("end"),
);

const flowNodeValidator = v.object({
  key: v.string(),
  type: flowNodeTypeValidator,
  title: v.string(),
  body: v.optional(v.string()),
  nextKey: v.optional(v.string()),
  position: v.optional(
    v.object({
      x: v.number(),
      y: v.number(),
    }),
  ),
  variableKey: v.optional(v.string()),
  tag: v.optional(v.string()),
  template: v.optional(
    v.object({
      templateId: v.id("templates"),
      variables: v.record(v.string(), v.string()),
    }),
  ),
  channelTemplate: v.optional(
    v.object({
      templateId: v.id("channelTemplates"),
      variables: v.record(v.string(), v.string()),
    }),
  ),
  condition: v.optional(
    v.object({
      variableKey: v.string(),
      operator: v.union(
        v.literal("equals"),
        v.literal("contains"),
        v.literal("starts_with"),
        v.literal("ends_with"),
        v.literal("present"),
        v.literal("absent"),
      ),
      value: v.optional(v.string()),
      trueNextKey: v.string(),
      falseNextKey: v.string(),
    }),
  ),
  buttons: v.optional(
    v.array(
      v.object({
        replyId: v.string(),
        label: v.string(),
        nextKey: v.string(),
      }),
    ),
  ),
});

const flowIssueValidator = v.object({
  severity: v.union(v.literal("error"), v.literal("warning")),
  scope: v.union(v.literal("flow"), v.literal("trigger"), v.literal("node")),
  nodeKey: v.optional(v.string()),
  field: v.optional(v.string()),
  message: v.string(),
});

type FlowNodeType =
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

type FlowNode = {
  key: string;
  type: FlowNodeType;
  title: string;
  body?: string;
  nextKey?: string;
  position?: { x: number; y: number };
  variableKey?: string;
  tag?: string;
  template?: {
    templateId: Id<"templates">;
    variables: Record<string, string>;
  };
  channelTemplate?: {
    templateId: Id<"channelTemplates">;
    variables: Record<string, string>;
  };
  condition?: {
    variableKey: string;
    operator:
      | "equals"
      | "contains"
      | "starts_with"
      | "ends_with"
      | "present"
      | "absent";
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

type FlowIssue = {
  severity: "error" | "warning";
  scope: "flow" | "trigger" | "node";
  nodeKey?: string;
  field?: string;
  message: string;
};

type FlowTemplate = {
  slug: "welcome_menu" | "clinic_lead_capture" | "faq_handoff";
  name: string;
  description: string;
  triggerKind: "inbound" | "keyword" | "ctwa" | "handoff";
  triggerKeywords?: string[];
  entryNodeKey: string;
  nodes: FlowNode[];
};

const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    slug: "clinic_lead_capture",
    name: "Clinic lead capture",
    description:
      "Captures name, service interest, budget, then hands off to the clinic team.",
    triggerKind: "ctwa",
    entryNodeKey: "start",
    nodes: [
      {
        key: "start",
        type: "start",
        title: "Start",
        nextKey: "welcome",
      },
      {
        key: "welcome",
        type: "send_message",
        title: "Welcome",
        body:
          "Olá! Sou o assistente da clínica. Vou fazer 3 perguntas rápidas para encaminhar bem o teu pedido.",
        nextKey: "ask_name",
      },
      {
        key: "ask_name",
        type: "collect_input",
        title: "Collect name",
        body: "Qual é o teu nome?",
        variableKey: "name",
        nextKey: "ask_service",
      },
      {
        key: "ask_service",
        type: "send_buttons",
        title: "Service menu",
        body: "Que tipo de serviço procuras?",
        buttons: [
          { replyId: "skin", label: "Pele", nextKey: "ask_budget" },
          { replyId: "body", label: "Corpo", nextKey: "ask_budget" },
          { replyId: "other", label: "Outro", nextKey: "ask_budget" },
        ],
      },
      {
        key: "ask_budget",
        type: "collect_input",
        title: "Collect budget",
        body: "Qual é o orçamento aproximado em MT?",
        variableKey: "budget_mt",
        nextKey: "tag_qualified",
      },
      {
        key: "tag_qualified",
        type: "set_tag",
        title: "Tag qualified lead",
        tag: "qualified_lead",
        nextKey: "handoff",
      },
      {
        key: "handoff",
        type: "handoff",
        title: "Human handoff",
        body:
          "Lead qualificado pelo bot. Rever nome, serviço e orçamento antes de responder.",
      },
    ],
  },
  {
    slug: "welcome_menu",
    name: "Welcome menu",
    description:
      "A button menu for support/sales routing, inspired by wacrm flows.",
    triggerKind: "keyword",
    triggerKeywords: ["ola", "olá", "menu", "ajuda"],
    entryNodeKey: "start",
    nodes: [
      { key: "start", type: "start", title: "Start", nextKey: "menu" },
      {
        key: "menu",
        type: "send_buttons",
        title: "Welcome menu",
        body: "Olá! Como podemos ajudar?",
        buttons: [
          { replyId: "book", label: "Marcar", nextKey: "book" },
          { replyId: "prices", label: "Preços", nextKey: "prices" },
          { replyId: "human", label: "Humano", nextKey: "handoff" },
        ],
      },
      {
        key: "book",
        type: "send_message",
        title: "Booking reply",
        body: "Perfeito. Diz-nos o serviço e o horário preferido.",
        nextKey: "handoff",
      },
      {
        key: "prices",
        type: "send_message",
        title: "Pricing reply",
        body: "Os preços variam por serviço. Um consultor vai confirmar contigo em MT.",
        nextKey: "handoff",
      },
      {
        key: "handoff",
        type: "handoff",
        title: "Human handoff",
        body: "Cliente pediu atendimento humano pelo menu.",
      },
    ],
  },
  {
    slug: "faq_handoff",
    name: "FAQ + handoff",
    description:
      "Answers common questions, then routes complex cases to a human.",
    triggerKind: "inbound",
    entryNodeKey: "start",
    nodes: [
      { key: "start", type: "start", title: "Start", nextKey: "faq" },
      {
        key: "faq",
        type: "send_list",
        title: "FAQ menu",
        body: "Escolhe uma opção:",
        buttons: [
          { replyId: "hours", label: "Horários", nextKey: "hours" },
          { replyId: "location", label: "Local", nextKey: "location" },
          { replyId: "human", label: "Humano", nextKey: "handoff" },
        ],
      },
      {
        key: "hours",
        type: "send_message",
        title: "Hours",
        body: "Atendemos de segunda a sexta, das 9h às 18h.",
        nextKey: "end",
      },
      {
        key: "location",
        type: "send_message",
        title: "Location",
        body: "Enviaremos a localização assim que um agente confirmar a unidade certa.",
        nextKey: "handoff",
      },
      { key: "handoff", type: "handoff", title: "Human handoff" },
      { key: "end", type: "end", title: "End" },
    ],
  },
];

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function assertName(name: string): string {
  const cleaned = cleanName(name);
  if (cleaned.length < NAME_MIN || cleaned.length > NAME_MAX) {
    throw new ConvexError({
      code: "INVALID_NAME",
      message: `Name must be ${NAME_MIN}-${NAME_MAX} characters.`,
    });
  }
  return cleaned;
}

export const list = tenantQuery({
  args: {},
  returns: v.object({
    folders: v.array(
      v.object({
        _id: v.id("chatbotFolders"),
        name: v.string(),
        botCount: v.number(),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
    ),
    bots: v.array(
      v.object({
        _id: v.id("chatbots"),
        folderId: v.optional(v.id("chatbotFolders")),
        folderName: v.optional(v.string()),
        name: v.string(),
        description: v.optional(v.string()),
        status: statusValidator,
        triggerKind: triggerValidator,
        triggerKeywords: v.optional(v.array(v.string())),
        model: v.optional(v.string()),
        entryNodeKey: v.optional(v.string()),
        flowNodes: v.optional(v.array(flowNodeValidator)),
        nodeCount: v.number(),
        flowValidationIssues: v.array(flowIssueValidator),
        channel: v.literal("whatsapp"),
        channelId: v.optional(v.id("channels")),
        channelDisplayName: v.optional(v.string()),
        channelConnectionState: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
    ),
    stats: v.object({
      total: v.number(),
      active: v.number(),
      draft: v.number(),
      paused: v.number(),
      flowReady: v.number(),
      flowIssues: v.number(),
    }),
    templates: v.array(
      v.object({
        slug: flowTemplateSlugValidator,
        name: v.string(),
        description: v.string(),
        triggerKind: triggerValidator,
        nodeCount: v.number(),
      }),
    ),
    automationChannels: v.array(
      v.object({
        _id: v.id("channels"),
        displayName: v.string(),
        connectionState: v.optional(v.string()),
        status: v.string(),
        sendMode: v.string(),
        phoneNumber: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const [folders, bots, tenantChannels] = await Promise.all([
      ctx.db
        .query("chatbotFolders")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .order("desc")
        .collect(),
      ctx.db
        .query("chatbots")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .order("desc")
        .collect(),
      ctx.db
        .query("channels")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .order("desc")
        .take(100),
    ]);

    const folderById = new Map(folders.map((folder) => [folder._id, folder]));
    const channelById = new Map(tenantChannels.map((channel) => [channel._id, channel]));
    const botCountByFolder = new Map<Id<"chatbotFolders">, number>();
    const stats = {
      total: bots.length,
      active: 0,
      draft: 0,
      paused: 0,
      flowReady: 0,
      flowIssues: 0,
    };
    const botIssues = new Map<Id<"chatbots">, FlowIssue[]>();

    for (const bot of bots) {
      stats[bot.status] += 1;
      const issues =
        bot.flowValidationIssues ??
        validateFlow({
          name: bot.name,
          triggerKind: bot.triggerKind,
          triggerKeywords: bot.triggerKeywords,
          entryNodeKey: bot.entryNodeKey,
          nodes: bot.flowNodes,
        });
      botIssues.set(bot._id, issues);
      if (issues.some((issue) => issue.severity === "error")) {
        stats.flowIssues += 1;
      } else {
        stats.flowReady += 1;
      }
      if (bot.folderId) {
        botCountByFolder.set(
          bot.folderId,
          (botCountByFolder.get(bot.folderId) ?? 0) + 1,
        );
      }
    }

    return {
      folders: folders.map((folder) => ({
        _id: folder._id,
        name: folder.name,
        botCount: botCountByFolder.get(folder._id) ?? 0,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      })),
      bots: bots.map((bot) => ({
        _id: bot._id,
        folderId: bot.folderId,
        folderName: bot.folderId ? folderById.get(bot.folderId)?.name : undefined,
        name: bot.name,
        description: bot.description,
        status: bot.status,
        triggerKind: bot.triggerKind,
        triggerKeywords: bot.triggerKeywords,
        model: bot.model,
        entryNodeKey: bot.entryNodeKey,
        flowNodes: bot.flowNodes,
        nodeCount: bot.flowNodes?.length ?? 0,
        flowValidationIssues: botIssues.get(bot._id) ?? [],
        channel: bot.channel,
        channelId: bot.channelId,
        channelDisplayName: bot.channelId
          ? channelById.get(bot.channelId)?.displayName
          : undefined,
        channelConnectionState: bot.channelId
          ? channelById.get(bot.channelId)?.connectionState
          : undefined,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
      })),
      stats,
      templates: FLOW_TEMPLATES.map((template) => ({
        slug: template.slug,
        name: template.name,
        description: template.description,
        triggerKind: template.triggerKind,
        nodeCount: template.nodes.length,
      })),
      automationChannels: tenantChannels
        .filter(
          (channel) =>
            channel.provider === "iasolution_hub" &&
            channel.kind === "whatsapp" &&
            channel.operationalTerritory === "openbsp",
        )
        .map((channel) => ({
          _id: channel._id,
          displayName: channel.displayName,
          connectionState: channel.connectionState,
          status: channel.status,
          sendMode: channel.sendMode,
          phoneNumber: channel.phoneNumber,
        })),
    };
  },
});

export const createFolder = tenantMutation({
  args: { name: v.string() },
  returns: v.id("chatbotFolders"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const name = assertName(args.name);
    const existing = await ctx.db
      .query("chatbotFolders")
      .withIndex("by_tenant_name", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("name", name),
      )
      .unique();
    if (existing) throw new ConvexError({ code: "FOLDER_NAME_EXISTS" });
    const now = Date.now();
    return await ctx.db.insert("chatbotFolders", {
      tenantId: ctx.tenantId,
      name,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createBot = tenantMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    folderId: v.optional(v.id("chatbotFolders")),
    triggerKind: triggerValidator,
    triggerKeywords: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
    templateSlug: v.optional(flowTemplateSlugValidator),
    channelId: v.optional(v.id("channels")),
  },
  returns: v.id("chatbots"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const name = assertName(args.name);
    if (args.folderId) {
      await loadByIdInTenant(
        ctx as Parameters<typeof loadByIdInTenant>[0],
        "chatbotFolders",
        args.folderId,
      );
    }
    if (args.channelId) {
      await requireAutomationChannel(ctx, args.channelId);
    }
    const now = Date.now();
    const template =
      findTemplate(args.templateSlug) ?? defaultTemplateForTrigger(args.triggerKind);
    const triggerKeywords = cleanKeywords(
      args.triggerKeywords ?? template.triggerKeywords,
    );
    const issues = validateFlow({
      name,
      triggerKind: args.triggerKind,
      triggerKeywords,
      entryNodeKey: template.entryNodeKey,
      nodes: template.nodes,
    });
    return await ctx.db.insert("chatbots", {
      tenantId: ctx.tenantId,
      name,
      description: args.description?.trim() || undefined,
      folderId: args.folderId,
      status: "draft",
      triggerKind: args.triggerKind,
      triggerKeywords,
      model: args.model?.trim() || "CXCast guardrail bot",
      entryNodeKey: template.entryNodeKey,
      flowNodes: template.nodes,
      flowValidationIssues: issues,
      channel: "whatsapp",
      channelId: args.channelId,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const bindChannel = tenantMutation({
  args: {
    chatbotId: v.id("chatbots"),
    channelId: v.id("channels"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const bot = (await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "chatbots",
      args.chatbotId,
    )) as Doc<"chatbots">;
    await requireAutomationChannel(ctx, args.channelId);
    if (bot.channelId === args.channelId) return null;
    await ctx.db.patch(bot._id, {
      channelId: args.channelId,
      status: "draft",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const updateFlow = tenantMutation({
  args: {
    chatbotId: v.id("chatbots"),
    triggerKind: triggerValidator,
    triggerKeywords: v.optional(v.array(v.string())),
    entryNodeKey: v.string(),
    nodes: v.array(flowNodeValidator),
  },
  returns: v.array(flowIssueValidator),
  handler: async (ctx, args) => {
    const bot = (await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "chatbots",
      args.chatbotId,
    )) as Doc<"chatbots">;
    requireCapability(
      ctx.role,
      bot.status === "active" ? "campaigns.start" : "campaigns.create",
    );
    const triggerKeywords = cleanKeywords(args.triggerKeywords);
    const nodes = normalizeNodes(args.nodes);
    const issues = validateFlow({
      name: bot.name,
      triggerKind: args.triggerKind,
      triggerKeywords,
      entryNodeKey: args.entryNodeKey.trim(),
      nodes,
    });
    issues.push(...(await validateTemplateRefs(ctx, nodes, bot.channelId)));
    await ctx.db.patch(args.chatbotId, {
      triggerKind: args.triggerKind,
      triggerKeywords,
      entryNodeKey: args.entryNodeKey.trim(),
      flowNodes: nodes,
      flowValidationIssues: issues,
      status: issues.some((issue) => issue.severity === "error")
        ? "draft"
        : bot.status,
      updatedAt: Date.now(),
    });
    return issues;
  },
});

export const applyTemplate = tenantMutation({
  args: {
    chatbotId: v.id("chatbots"),
    templateSlug: flowTemplateSlugValidator,
  },
  returns: v.array(flowIssueValidator),
  handler: async (ctx, args) => {
    const bot = (await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "chatbots",
      args.chatbotId,
    )) as Doc<"chatbots">;
    requireCapability(
      ctx.role,
      bot.status === "active" ? "campaigns.start" : "campaigns.create",
    );
    const template = findTemplate(args.templateSlug);
    if (!template) throw new ConvexError({ code: "UNKNOWN_FLOW_TEMPLATE" });
    const triggerKeywords = cleanKeywords(template.triggerKeywords);
    const issues = validateFlow({
      name: bot.name,
      triggerKind: template.triggerKind,
      triggerKeywords,
      entryNodeKey: template.entryNodeKey,
      nodes: template.nodes,
    });
    await ctx.db.patch(args.chatbotId, {
      triggerKind: template.triggerKind,
      triggerKeywords,
      entryNodeKey: template.entryNodeKey,
      flowNodes: template.nodes,
      flowValidationIssues: issues,
      status: "draft",
      updatedAt: Date.now(),
    });
    return issues;
  },
});

export const updateStatus = tenantMutation({
  args: {
    chatbotId: v.id("chatbots"),
    status: statusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const bot = (await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "chatbots",
      args.chatbotId,
    )) as Doc<"chatbots">;
    requireCapability(
      ctx.role,
      args.status === "active" || bot.status === "active"
        ? "campaigns.start"
        : "campaigns.create",
    );
    const template = defaultTemplateForTrigger(bot.triggerKind);
    const triggerKeywords = cleanKeywords(
      bot.triggerKeywords ?? template.triggerKeywords,
    );
    const nodes = bot.flowNodes ?? template.nodes;
    const entryNodeKey = bot.entryNodeKey ?? template.entryNodeKey;
    const issues = validateFlow({
      name: bot.name,
      triggerKind: bot.triggerKind,
      triggerKeywords,
      entryNodeKey,
      nodes,
    });
    issues.push(...(await validateTemplateRefs(ctx, nodes, bot.channelId)));
    if (args.status === "active") {
      if (bot.channelId) {
        const channel = await requireAutomationChannel(ctx, bot.channelId);
        if (
          channel.status !== "active" ||
          channel.webhookStatus !== "verified" ||
          channel.sendMode !== "allowlist" ||
          channel.connectionState !== "allowlist_only"
        ) {
          issues.push({
            severity: "error",
            scope: "flow",
            field: "channelId",
            message:
              "The selected channel must have a verified webhook and allowlist-only pilot enabled.",
          });
        }
        issues.push(...(await validateTriggerConflicts(ctx, bot)));
      }
    }
    if (
      args.status === "active" &&
      issues.some((issue) => issue.severity === "error")
    ) {
      await ctx.db.patch(args.chatbotId, {
        triggerKeywords,
        entryNodeKey,
        flowNodes: nodes,
        flowValidationIssues: issues,
        updatedAt: Date.now(),
      });
      throw new ConvexError({
        code: "FLOW_INVALID",
        message: "Fix the flow builder issues before activating this bot.",
        issues,
      });
    }
    await ctx.db.patch(args.chatbotId, {
      status: args.status,
      triggerKeywords,
      entryNodeKey,
      flowNodes: nodes,
      flowValidationIssues: issues,
      updatedAt: Date.now(),
    });
    return null;
  },
});

function findTemplate(slug?: FlowTemplate["slug"]): FlowTemplate | undefined {
  return slug ? FLOW_TEMPLATES.find((template) => template.slug === slug) : undefined;
}

async function requireAutomationChannel(
  ctx: { db: any; tenantId: Id<"tenants"> },
  channelId: Id<"channels">,
): Promise<Doc<"channels">> {
  const channel = await ctx.db.get(channelId);
  if (
    !channel ||
    channel.tenantId !== ctx.tenantId ||
    channel.kind !== "whatsapp" ||
    channel.provider !== "iasolution_hub" ||
    channel.operationalTerritory !== "openbsp"
  ) {
    throw new ConvexError({ code: "AUTOMATION_CHANNEL_NOT_FOUND" });
  }
  return channel;
}

async function validateTriggerConflicts(
  ctx: { db: any; tenantId: Id<"tenants"> },
  bot: Doc<"chatbots">,
): Promise<FlowIssue[]> {
  if (!bot.channelId) return [];
  const active = await ctx.db
    .query("chatbots")
    .withIndex("by_channel_status", (q: any) =>
      q.eq("channelId", bot.channelId).eq("status", "active"),
    )
    .take(50);
  const keywords = new Set(cleanKeywords(bot.triggerKeywords) ?? []);
  const conflict = active.find((candidate: Doc<"chatbots">) => {
    if (candidate._id === bot._id || candidate.tenantId !== ctx.tenantId) {
      return false;
    }
    if (candidate.triggerKind !== bot.triggerKind) return false;
    if (bot.triggerKind !== "keyword") return true;
    return (cleanKeywords(candidate.triggerKeywords) ?? []).some((keyword) =>
      keywords.has(keyword),
    );
  });
  return conflict
    ? [{
        severity: "error" as const,
        scope: "trigger" as const,
        field: "triggerKind",
        message: `Trigger overlaps active bot "${conflict.name}" on this channel.`,
      }]
    : [];
}

function defaultTemplateForTrigger(triggerKind: FlowTemplate["triggerKind"]): FlowTemplate {
  return (
    FLOW_TEMPLATES.find((template) => template.triggerKind === triggerKind) ??
    FLOW_TEMPLATES[0]
  );
}

function cleanKeywords(keywords?: string[]): string[] | undefined {
  const cleaned = (keywords ?? [])
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
}

function normalizeNodes(nodes: FlowNode[]): FlowNode[] {
  return nodes.map((node) => ({
    key: cleanKey(node.key),
    type: node.type,
    title: cleanName(node.title || node.key || node.type),
    body: node.body?.trim() || undefined,
    nextKey: node.nextKey?.trim() || undefined,
    position:
      node.position &&
      Number.isFinite(node.position.x) &&
      Number.isFinite(node.position.y)
        ? {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
          }
        : undefined,
    variableKey: node.variableKey?.trim() || undefined,
    tag: node.tag?.trim() || undefined,
    template: node.template
      ? {
          templateId: node.template.templateId,
          variables: Object.fromEntries(
            Object.entries(node.template.variables ?? {})
              .map(([key, value]) => [key.trim(), value.trim()])
              .filter(([key]) => key.length > 0),
          ),
        }
      : undefined,
    channelTemplate: node.channelTemplate
      ? {
          templateId: node.channelTemplate.templateId,
          variables: Object.fromEntries(
            Object.entries(node.channelTemplate.variables ?? {})
              .map(([key, value]) => [key.trim(), value.trim()])
              .filter(([key]) => key.length > 0),
          ),
        }
      : undefined,
    condition: node.condition
      ? {
          variableKey: node.condition.variableKey.trim(),
          operator: node.condition.operator,
          value: node.condition.value?.trim() || undefined,
          trueNextKey: node.condition.trueNextKey.trim(),
          falseNextKey: node.condition.falseNextKey.trim(),
        }
      : undefined,
    buttons:
      node.buttons
        ?.map((button) => ({
          replyId: cleanKey(button.replyId),
          label: button.label.trim(),
          nextKey: button.nextKey.trim(),
        }))
        .filter((button) => button.replyId || button.label || button.nextKey) ??
      undefined,
  }));
}

function cleanKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function validateFlow(args: {
  name: string;
  triggerKind: "inbound" | "keyword" | "ctwa" | "handoff";
  triggerKeywords?: string[];
  entryNodeKey?: string;
  nodes?: FlowNode[];
}): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const nodes = normalizeNodes(args.nodes ?? []);
  const keys = new Set(nodes.map((node) => node.key));

  if (!args.name.trim()) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "name",
      message: "Bot name is required.",
    });
  }
  if (args.triggerKind === "keyword" && !cleanKeywords(args.triggerKeywords)?.length) {
    issues.push({
      severity: "error",
      scope: "trigger",
      field: "triggerKeywords",
      message: "Keyword-triggered flows need at least one keyword.",
    });
  }
  if (nodes.length === 0) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "nodes",
      message: "Add at least one node before activation.",
    });
  }
  if (!args.entryNodeKey?.trim()) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entryNodeKey",
      message: "Pick an entry node.",
    });
  } else if (!keys.has(args.entryNodeKey.trim())) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entryNodeKey",
      message: `Entry node "${args.entryNodeKey}" does not exist.`,
    });
  }

  const seen = new Set<string>();
  for (const node of nodes) {
    if (!node.key) {
      issues.push({
        severity: "error",
        scope: "node",
        field: "key",
        message: "Each node needs a stable key.",
      });
    } else if (seen.has(node.key)) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "key",
        message: `Duplicate node key "${node.key}".`,
      });
    }
    seen.add(node.key);
    issues.push(...validateNode(node, keys));
  }

  if (args.entryNodeKey && keys.has(args.entryNodeKey)) {
    const reached = reachableFrom(args.entryNodeKey, nodes);
    for (const node of nodes) {
      if (!reached.has(node.key)) {
        issues.push({
          severity: "warning",
          scope: "node",
          nodeKey: node.key,
          message: `Node "${node.title}" is not reachable from the entry node.`,
        });
      }
    }
  }

  return issues;
}

/**
 * DB-backed validation for send_template nodes: the referenced template must
 * exist in the tenant, be approved, and have every parameter of its current
 * version mapped. Sync graph checks live in validateFlow; this complements
 * them wherever persisted nodes can gain template refs (updateFlow,
 * updateStatus).
 */
async function validateTemplateRefs(
  ctx: { db: any; tenantId: Id<"tenants"> },
  nodes: FlowNode[],
  channelId?: Id<"channels">,
): Promise<FlowIssue[]> {
  const issues: FlowIssue[] = [];
  for (const node of nodes) {
    if (node.type !== "send_template") continue;
    if (channelId) {
      if (!node.channelTemplate?.templateId) {
        issues.push({
          severity: "error",
          scope: "node",
          nodeKey: node.key,
          field: "channelTemplate.templateId",
          message: `${node.title} needs a template synced to the selected channel.`,
        });
        continue;
      }
      const channelTemplate = await ctx.db.get(node.channelTemplate.templateId);
      if (
        !channelTemplate ||
        channelTemplate.tenantId !== ctx.tenantId ||
        channelTemplate.channelId !== channelId
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          nodeKey: node.key,
          field: "channelTemplate.templateId",
          message: `${node.title} references a template from another channel.`,
        });
      } else if (
        !["approved", "active"].includes(channelTemplate.status.toLowerCase())
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          nodeKey: node.key,
          field: "channelTemplate.templateId",
          message: `${node.title} must use an approved channel template.`,
        });
      }
      continue;
    }
    if (!node.template?.templateId) continue;
    const tpl = await ctx.db.get(node.template.templateId);
    if (!tpl || tpl.tenantId !== ctx.tenantId) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "template.templateId",
        message: `${node.title} references a template that does not exist.`,
      });
      continue;
    }
    if (tpl.status !== "approved") {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "template.templateId",
        message: `${node.title} must use an approved template (current status: ${tpl.status}).`,
      });
      continue;
    }
    const ver = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q: any) =>
        q.eq("templateId", tpl._id).eq("version", tpl.currentVersion),
      )
      .unique();
    if (!ver) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "template.templateId",
        message: `${node.title}: template version is missing.`,
      });
      continue;
    }
    for (const p of ver.parameterSchema as Array<{ index: number }>) {
      const val = node.template.variables[String(p.index)];
      if (!val || !val.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          nodeKey: node.key,
          field: `template.variables.${p.index}`,
          message: `${node.title} is missing a value for template variable {{${p.index}}}.`,
        });
      }
    }
  }
  return issues;
}

function validateNode(node: FlowNode, keys: Set<string>): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const checkTarget = (target: string | undefined, field: string) => {
    if (!target) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field,
        message: `${node.title} needs a next node.`,
      });
    } else if (!keys.has(target)) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field,
        message: `${node.title} points to missing node "${target}".`,
      });
    }
  };

  if (node.type === "start") {
    checkTarget(node.nextKey, "nextKey");
  }
  if (node.type === "send_message") {
    if (!node.body?.trim()) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "body",
        message: `${node.title} needs message text.`,
      });
    }
    checkTarget(node.nextKey, "nextKey");
  }
  if (node.type === "send_template") {
    if (!node.template?.templateId && !node.channelTemplate?.templateId) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "template.templateId",
        message: `${node.title} needs an approved template.`,
      });
    }
    checkTarget(node.nextKey, "nextKey");
  }
  if (node.type === "collect_input") {
    if (!node.body?.trim()) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "body",
        message: `${node.title} needs a prompt.`,
      });
    }
    if (!node.variableKey?.trim()) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "variableKey",
        message: `${node.title} needs a variable key.`,
      });
    }
    checkTarget(node.nextKey, "nextKey");
  }
  if (node.type === "send_buttons" || node.type === "send_list") {
    if (!node.body?.trim()) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "body",
        message: `${node.title} needs menu message text.`,
      });
    }
    const buttons = node.buttons ?? [];
    const maxChoices = node.type === "send_buttons" ? 3 : 10;
    if (buttons.length === 0 || buttons.length > maxChoices) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "buttons",
        message:
          node.type === "send_buttons"
            ? "Button nodes need 1-3 buttons for Meta."
            : "List nodes need 1-10 rows.",
      });
    }
    buttons.forEach((button, index) => {
      if (!button.replyId.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          nodeKey: node.key,
          field: `buttons.${index}.replyId`,
          message: "Each button needs a reply id.",
        });
      }
      const maxLabelLength = node.type === "send_buttons" ? 20 : 24;
      if (!button.label.trim() || button.label.length > maxLabelLength) {
        issues.push({
          severity: "error",
          scope: "node",
          nodeKey: node.key,
          field: `buttons.${index}.label`,
          message: `Choice labels must be 1-${maxLabelLength} characters.`,
        });
      }
      checkTarget(button.nextKey, `buttons.${index}.nextKey`);
    });
  }
  if (node.type === "set_tag") {
    if (!node.tag?.trim() && !node.body?.trim()) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "tag",
        message: `${node.title} needs a tag value.`,
      });
    }
    checkTarget(node.nextKey, "nextKey");
  }
  if (node.type === "condition") {
    if (!node.condition?.variableKey.trim()) {
      issues.push({
        severity: "error",
        scope: "node",
        nodeKey: node.key,
        field: "condition.variableKey",
        message: "Condition nodes need a variable key.",
      });
    }
    checkTarget(node.condition?.trueNextKey, "condition.trueNextKey");
    checkTarget(node.condition?.falseNextKey, "condition.falseNextKey");
  }
  return issues;
}

function reachableFrom(entryKey: string, nodes: FlowNode[]): Set<string> {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const reached = new Set<string>();
  const visit = (key: string) => {
    if (reached.has(key)) return;
    const node = byKey.get(key);
    if (!node) return;
    reached.add(key);
    for (const next of outgoingKeys(node)) visit(next);
  };
  visit(entryKey);
  return reached;
}

function outgoingKeys(node: FlowNode): string[] {
  const keys = [];
  if (node.nextKey) keys.push(node.nextKey);
  for (const button of node.buttons ?? []) {
    if (button.nextKey) keys.push(button.nextKey);
  }
  if (node.condition?.trueNextKey) keys.push(node.condition.trueNextKey);
  if (node.condition?.falseNextKey) keys.push(node.condition.falseNextKey);
  return keys;
}
