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
        model: v.optional(v.string()),
        channel: v.literal("whatsapp"),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
    ),
    stats: v.object({
      total: v.number(),
      active: v.number(),
      draft: v.number(),
      paused: v.number(),
    }),
  }),
  handler: async (ctx) => {
    const [folders, bots] = await Promise.all([
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
    ]);

    const folderById = new Map(folders.map((folder) => [folder._id, folder]));
    const botCountByFolder = new Map<Id<"chatbotFolders">, number>();
    const stats = { total: bots.length, active: 0, draft: 0, paused: 0 };

    for (const bot of bots) {
      stats[bot.status] += 1;
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
        model: bot.model,
        channel: bot.channel,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
      })),
      stats,
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
    model: v.optional(v.string()),
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
    const now = Date.now();
    return await ctx.db.insert("chatbots", {
      tenantId: ctx.tenantId,
      name,
      description: args.description?.trim() || undefined,
      folderId: args.folderId,
      status: "draft",
      triggerKind: args.triggerKind,
      model: args.model?.trim() || "CXCast guardrail bot",
      channel: "whatsapp",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
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
    await ctx.db.patch(args.chatbotId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});
