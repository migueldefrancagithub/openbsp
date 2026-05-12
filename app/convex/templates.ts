import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  action,
} from "./_generated/server";
import {
  tenantMutation,
  tenantQuery,
  loadByIdInTenant,
} from "./lib/customFunctions";
import {
  submitTemplateToMeta,
  listMetaTemplates,
} from "./lib/meta/graph";
import type { Id } from "./_generated/dataModel";

const categoryValidator = v.union(
  v.literal("marketing"),
  v.literal("utility"),
  v.literal("authentication"),
);

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("paused"),
  v.literal("disabled"),
);

/** Detects {{1}}, {{2}}, ... placeholders in the body and returns indices. */
export function extractParameterIndices(body: string): number[] {
  const indices = new Set<number>();
  const re = /\{\{(\d+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    indices.add(Number(m[1]));
  }
  return Array.from(indices).sort((a, b) => a - b);
}

// ---------- Public queries ----------

export const list = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("templates"),
      name: v.string(),
      language: v.string(),
      category: v.string(),
      status: v.string(),
      currentVersion: v.number(),
      qualityScore: v.optional(v.string()),
      rejectionReason: v.optional(v.string()),
      syncedAt: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("templates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .collect();
    return rows.map((t) => ({
      _id: t._id,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      currentVersion: t.currentVersion,
      qualityScore: t.qualityScore,
      rejectionReason: t.rejectionReason,
      syncedAt: t.syncedAt,
      createdAt: t.createdAt,
    }));
  },
});

export const getById = tenantQuery({
  args: { templateId: v.id("templates") },
  returns: v.union(
    v.object({
      _id: v.id("templates"),
      name: v.string(),
      language: v.string(),
      category: v.string(),
      status: v.string(),
      currentVersion: v.number(),
      qualityScore: v.optional(v.string()),
      rejectionReason: v.optional(v.string()),
      syncedAt: v.optional(v.number()),
      whatsappAccountId: v.id("whatsappAccounts"),
      versions: v.array(
        v.object({
          _id: v.id("templateVersions"),
          version: v.number(),
          bodyText: v.string(),
          parameterSchema: v.array(
            v.object({
              index: v.number(),
              name: v.string(),
              example: v.string(),
            }),
          ),
          isLocked: v.boolean(),
          submittedAt: v.optional(v.number()),
          approvedAt: v.optional(v.number()),
          rejectedAt: v.optional(v.number()),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const t = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "templates",
      args.templateId,
    );
    const versions = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", args.templateId),
      )
      .collect();
    return {
      _id: t._id,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      currentVersion: t.currentVersion,
      qualityScore: t.qualityScore,
      rejectionReason: t.rejectionReason,
      syncedAt: t.syncedAt,
      whatsappAccountId: t.whatsappAccountId,
      versions: versions
        .sort((a, b) => b.version - a.version)
        .map((v) => ({
          _id: v._id,
          version: v.version,
          bodyText: v.bodyText,
          parameterSchema: v.parameterSchema,
          isLocked: v.isLocked,
          submittedAt: v.submittedAt,
          approvedAt: v.approvedAt,
          rejectedAt: v.rejectedAt,
        })),
    };
  },
});

// ---------- Create draft (BODY-only utility/marketing) ----------

const NAME_REGEX = /^[a-z0-9_]{3,40}$/;

export const createDraft = tenantMutation({
  args: {
    whatsappAccountId: v.id("whatsappAccounts"),
    name: v.string(),
    language: v.string(),
    category: categoryValidator,
    bodyText: v.string(),
    parameterSchema: v.array(
      v.object({
        index: v.number(),
        name: v.string(),
        example: v.string(),
      }),
    ),
  },
  returns: v.id("templates"),
  handler: async (ctx, args): Promise<Id<"templates">> => {
    if (!NAME_REGEX.test(args.name)) {
      throw new ConvexError({
        code: "INVALID_NAME",
        message: "Name must be 3-40 chars, lowercase alphanumeric or underscore.",
      });
    }
    if (args.bodyText.trim().length === 0) {
      throw new ConvexError({ code: "EMPTY_BODY" });
    }
    if (args.bodyText.length > 1024) {
      throw new ConvexError({ code: "BODY_TOO_LONG", limit: 1024 });
    }

    // Verify the whatsappAccount belongs to this tenant
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "whatsappAccounts",
      args.whatsappAccountId,
    );

    // Verify placeholder schema matches body
    const detected = extractParameterIndices(args.bodyText);
    const declared = args.parameterSchema.map((p) => p.index).sort((a, b) => a - b);
    if (
      detected.length !== declared.length ||
      !detected.every((d, i) => d === declared[i])
    ) {
      throw new ConvexError({
        code: "PARAM_SCHEMA_MISMATCH",
        detected,
        declared,
      });
    }

    // Reject if a template with same name+language already exists
    const existing = await ctx.db
      .query("templates")
      .withIndex("by_tenant_name_lang", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("name", args.name)
          .eq("language", args.language),
      )
      .unique();
    if (existing) {
      throw new ConvexError({
        code: "TEMPLATE_NAME_EXISTS",
        message: "A template with this name+language already exists.",
      });
    }

    const templateId = await ctx.db.insert("templates", {
      tenantId: ctx.tenantId,
      whatsappAccountId: args.whatsappAccountId,
      name: args.name,
      language: args.language,
      category: args.category,
      currentVersion: 1,
      status: "draft",
      createdAt: Date.now(),
      createdBy: ctx.memberId,
    });
    await ctx.db.insert("templateVersions", {
      templateId,
      tenantId: ctx.tenantId,
      version: 1,
      bodyText: args.bodyText,
      parameterSchema: args.parameterSchema,
      isLocked: false,
      createdBy: ctx.memberId,
      createdAt: Date.now(),
    });
    return templateId;
  },
});

// ---------- Internal helpers used by submit action ----------

export const _loadForSubmit = internalQuery({
  args: { templateId: v.id("templates"), tenantId: v.id("tenants") },
  returns: v.union(
    v.object({
      whatsappAccountId: v.id("whatsappAccounts"),
      name: v.string(),
      language: v.string(),
      category: v.string(),
      currentVersionId: v.id("templateVersions"),
      bodyText: v.string(),
      parameterSchema: v.array(
        v.object({
          index: v.number(),
          name: v.string(),
          example: v.string(),
        }),
      ),
      isLocked: v.boolean(),
      wabaId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const t = await ctx.db.get(args.templateId);
    if (!t || t.tenantId !== args.tenantId) return null;
    const ver = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", args.templateId).eq("version", t.currentVersion),
      )
      .unique();
    if (!ver) return null;
    const waba = await ctx.db.get(t.whatsappAccountId);
    if (!waba) return null;
    return {
      whatsappAccountId: t.whatsappAccountId,
      name: t.name,
      language: t.language,
      category: t.category,
      currentVersionId: ver._id,
      bodyText: ver.bodyText,
      parameterSchema: ver.parameterSchema,
      isLocked: ver.isLocked,
      wabaId: waba.wabaId,
    };
  },
});

export const _markSubmitted = internalMutation({
  args: {
    templateId: v.id("templates"),
    versionId: v.id("templateVersions"),
    metaTemplateId: v.string(),
    metaStatus: statusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, {
      status: args.metaStatus,
      metaTemplateId: args.metaTemplateId,
      syncedAt: Date.now(),
    });
    await ctx.db.patch(args.versionId, {
      isLocked: true,
      submittedAt: Date.now(),
      ...(args.metaStatus === "approved"
        ? { approvedAt: Date.now() }
        : args.metaStatus === "rejected"
          ? { rejectedAt: Date.now() }
          : {}),
    });
    return null;
  },
});

export const _meTenantWithRole = internalQuery({
  args: {},
  returns: v.union(
    v.object({ tenantId: v.id("tenants"), role: v.string() }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await (
      await import("@convex-dev/auth/server")
    ).getAuthUserId(ctx);
    if (!userId) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId as Id<"users">))
      .unique();
    if (!session) return null;
    const member = await ctx.db
      .query("members")
      .withIndex("by_tenant_user", (q) =>
        q
          .eq("tenantId", session.activeTenantId)
          .eq("userId", userId as Id<"users">),
      )
      .unique();
    if (!member || member.status !== "active") return null;
    return { tenantId: session.activeTenantId, role: member.role };
  },
});

// ---------- Submit + sync actions ----------

export const submitForApproval = action({
  args: { templateId: v.id("templates") },
  returns: v.object({ status: v.string(), metaTemplateId: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: string; metaTemplateId: string }> => {
    const me: { tenantId: Id<"tenants">; role: string } | null =
      await ctx.runQuery(internal.templates._meTenantWithRole, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    if (me.role !== "owner" && me.role !== "admin" && me.role !== "marketing") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }

    const data = await ctx.runQuery(internal.templates._loadForSubmit, {
      templateId: args.templateId,
      tenantId: me.tenantId,
    });
    if (!data) throw new ConvexError({ code: "NOT_FOUND" });
    if (data.isLocked)
      throw new ConvexError({
        code: "VERSION_LOCKED",
        message: "Edit a fresh version before re-submitting.",
      });

    const token: string | null = await ctx.runAction(
      internal.whatsappAccounts.decryptWabaToken,
      { whatsappAccountId: data.whatsappAccountId },
    );
    if (!token) throw new ConvexError({ code: "NO_TOKEN" });

    const result = await submitTemplateToMeta({
      token,
      wabaId: data.wabaId,
      name: data.name,
      language: data.language,
      category: data.category.toUpperCase() as
        | "MARKETING"
        | "UTILITY"
        | "AUTHENTICATION",
      bodyText: data.bodyText,
      exampleVariables: data.parameterSchema
        .sort((a, b) => a.index - b.index)
        .map((p) => p.example),
    });
    if (!result.ok) {
      throw new ConvexError({
        code: "META_SUBMIT_FAILED",
        message: result.reason,
        statusCode: result.statusCode,
        metaCode: result.metaCode,
      });
    }

    await ctx.runMutation(internal.templates._markSubmitted, {
      templateId: args.templateId,
      versionId: data.currentVersionId,
      metaTemplateId: result.metaTemplateId,
      metaStatus: result.status.toLowerCase() as
        | "pending"
        | "approved"
        | "rejected"
        | "paused"
        | "disabled",
    });

    return {
      status: result.status.toLowerCase(),
      metaTemplateId: result.metaTemplateId,
    };
  },
});

export const _patchSyncedStatus = internalMutation({
  args: {
    templateId: v.id("templates"),
    status: statusValidator,
    qualityScore: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, {
      status: args.status,
      qualityScore: args.qualityScore,
      rejectionReason: args.rejectionReason,
      syncedAt: Date.now(),
    });
    return null;
  },
});

export const _listLocalForSync = internalQuery({
  args: { tenantId: v.id("tenants") },
  returns: v.array(
    v.object({
      _id: v.id("templates"),
      whatsappAccountId: v.id("whatsappAccounts"),
      name: v.string(),
      language: v.string(),
      metaTemplateId: v.optional(v.string()),
      wabaId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("templates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .filter((q) => q.neq(q.field("metaTemplateId"), undefined))
      .collect();
    const out = [];
    for (const r of rows) {
      const w = await ctx.db.get(r.whatsappAccountId);
      if (!w) continue;
      out.push({
        _id: r._id,
        whatsappAccountId: r.whatsappAccountId,
        name: r.name,
        language: r.language,
        metaTemplateId: r.metaTemplateId,
        wabaId: w.wabaId,
      });
    }
    return out;
  },
});

export const syncFromMeta = action({
  args: {},
  returns: v.object({ updated: v.number() }),
  handler: async (ctx): Promise<{ updated: number }> => {
    const me: { tenantId: Id<"tenants">; role: string } | null =
      await ctx.runQuery(internal.templates._meTenantWithRole, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });

    const local: Array<{
      _id: Id<"templates">;
      whatsappAccountId: Id<"whatsappAccounts">;
      name: string;
      language: string;
      metaTemplateId?: string;
      wabaId: string;
    }> = await ctx.runQuery(internal.templates._listLocalForSync, {
      tenantId: me.tenantId,
    });

    // Group by whatsappAccountId so we fetch each WABA's list once
    const byAccount = new Map<
      Id<"whatsappAccounts">,
      { wabaId: string; templates: typeof local }
    >();
    for (const t of local) {
      const cur = byAccount.get(t.whatsappAccountId);
      if (cur) cur.templates.push(t);
      else
        byAccount.set(t.whatsappAccountId, {
          wabaId: t.wabaId,
          templates: [t],
        });
    }

    let updated = 0;
    for (const [accountId, { wabaId, templates: ts }] of byAccount) {
      const token: string | null = await ctx.runAction(
        internal.whatsappAccounts.decryptWabaToken,
        { whatsappAccountId: accountId },
      );
      if (!token) continue;
      const res = await listMetaTemplates({ token, wabaId });
      if (!res.ok) continue;
      const byKey = new Map(
        res.data.map((m) => [`${m.name}|${m.language}`, m]),
      );
      for (const t of ts) {
        const remote = byKey.get(`${t.name}|${t.language}`);
        if (!remote) continue;
        const lower = remote.status.toLowerCase();
        const status: "draft" | "pending" | "approved" | "rejected" | "paused" | "disabled" =
          lower === "approved"
            ? "approved"
            : lower === "rejected"
              ? "rejected"
              : lower === "paused"
                ? "paused"
                : lower === "disabled"
                  ? "disabled"
                  : "pending";
        await ctx.runMutation(internal.templates._patchSyncedStatus, {
          templateId: t._id,
          status,
          qualityScore: remote.qualityScore,
          rejectionReason: remote.rejectionReason,
        });
        updated++;
      }
    }
    return { updated };
  },
});
