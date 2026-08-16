import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
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
  listMetaTemplatesFull,
  type TemplateButton,
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

const parameterSchemaValidator = v.array(
  v.object({
    index: v.number(),
    name: v.string(),
    example: v.string(),
  }),
);

const templateButtonValidator = v.union(
  v.object({
    type: v.literal("quick_reply"),
    text: v.string(),
  }),
  v.object({
    type: v.literal("url"),
    text: v.string(),
    url: v.string(),
  }),
  v.object({
    type: v.literal("phone_number"),
    text: v.string(),
    phoneNumber: v.string(),
  }),
);

const templateButtonsValidator = v.array(templateButtonValidator);

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

function normalizeTemplateButtons(
  buttons?: TemplateButton[],
): TemplateButton[] | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  if (buttons.length > 3) {
    throw new ConvexError({
      code: "TOO_MANY_BUTTONS",
      message: "Meta template buttons are limited to 3 in this builder.",
    });
  }

  return buttons.map((button) => {
    const text = button.text.trim();
    if (text.length === 0 || text.length > 25) {
      throw new ConvexError({
        code: "INVALID_BUTTON_TEXT",
        message: "Button text must be 1-25 characters.",
      });
    }

    if (button.type === "quick_reply") {
      return { type: "quick_reply", text };
    }
    if (button.type === "url") {
      const url = button.url.trim();
      if (!/^https:\/\/\S+$/i.test(url)) {
        throw new ConvexError({
          code: "INVALID_BUTTON_URL",
          message: "URL buttons must use a public https:// URL.",
        });
      }
      return { type: "url", text, url };
    }

    const phoneNumber = button.phoneNumber.trim();
    if (!/^\+?[1-9]\d{6,19}$/.test(phoneNumber)) {
      throw new ConvexError({
        code: "INVALID_BUTTON_PHONE",
        message: "Phone buttons require an E.164-like number.",
      });
    }
    return { type: "phone_number", text, phoneNumber };
  });
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
      parameterCount: v.number(),
      bodyText: v.optional(v.string()),
      buttons: v.optional(templateButtonsValidator),
      parameterSchema: v.array(
        v.object({
          index: v.number(),
          name: v.string(),
          example: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("templates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .collect();
    const out = [];
    for (const t of rows) {
      const ver = await ctx.db
        .query("templateVersions")
        .withIndex("by_template_version", (q) =>
          q.eq("templateId", t._id).eq("version", t.currentVersion),
        )
        .unique();
      out.push({
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
        parameterCount: ver?.parameterSchema.length ?? 0,
        bodyText: ver?.bodyText,
        buttons: ver?.buttons,
        parameterSchema: ver?.parameterSchema ?? [],
      });
    }
    return out;
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
          buttons: v.optional(templateButtonsValidator),
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
          buttons: v.buttons,
          parameterSchema: v.parameterSchema,
          isLocked: v.isLocked,
          submittedAt: v.submittedAt,
          approvedAt: v.approvedAt,
          rejectedAt: v.rejectedAt,
        })),
    };
  },
});

// ---------- Create draft (BODY + optional Meta template buttons) ----------

const NAME_REGEX = /^[a-z0-9_]{3,40}$/;

type DraftTemplateArgs = {
  whatsappAccountId: Id<"whatsappAccounts">;
  name: string;
  language: string;
  category: "marketing" | "utility" | "authentication";
  bodyText: string;
  buttons?: TemplateButton[];
  parameterSchema: Array<{ index: number; name: string; example: string }>;
};

async function createDraftRow(
  ctx: {
    db: any;
    tenantId: Id<"tenants">;
    memberId: Id<"members">;
  },
  args: DraftTemplateArgs,
): Promise<Id<"templates">> {
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
  const buttons = normalizeTemplateButtons(args.buttons);

  await loadByIdInTenant(
    ctx as Parameters<typeof loadByIdInTenant>[0],
    "whatsappAccounts",
    args.whatsappAccountId,
  );

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

  const existing = await ctx.db
    .query("templates")
    .withIndex("by_tenant_name_lang", (q: any) =>
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

  const now = Date.now();
  const templateId = await ctx.db.insert("templates", {
    tenantId: ctx.tenantId,
    whatsappAccountId: args.whatsappAccountId,
    name: args.name,
    language: args.language,
    category: args.category,
    currentVersion: 1,
    status: "draft",
    createdAt: now,
    createdBy: ctx.memberId,
  });
  await ctx.db.insert("templateVersions", {
    templateId,
    tenantId: ctx.tenantId,
    version: 1,
    bodyText: args.bodyText,
    buttons,
    parameterSchema: args.parameterSchema,
    isLocked: false,
    createdBy: ctx.memberId,
    createdAt: now,
  });
  return templateId;
}

export const createDraft = tenantMutation({
  args: {
    whatsappAccountId: v.id("whatsappAccounts"),
    name: v.string(),
    language: v.string(),
    category: categoryValidator,
    bodyText: v.string(),
    buttons: v.optional(templateButtonsValidator),
    parameterSchema: parameterSchemaValidator,
  },
  returns: v.id("templates"),
  handler: async (ctx, args): Promise<Id<"templates">> => {
    return await createDraftRow(ctx, args);
  },
});

export const _createDraftForAction = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
    whatsappAccountId: v.id("whatsappAccounts"),
    name: v.string(),
    language: v.string(),
    category: categoryValidator,
    bodyText: v.string(),
    buttons: v.optional(templateButtonsValidator),
    parameterSchema: parameterSchemaValidator,
  },
  returns: v.id("templates"),
  handler: async (ctx, args): Promise<Id<"templates">> => {
    return await createDraftRow(
      {
        db: ctx.db,
        tenantId: args.tenantId,
        memberId: args.memberId,
      },
      args,
    );
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
      buttons: v.optional(templateButtonsValidator),
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
      buttons: ver.buttons,
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
    v.object({
      tenantId: v.id("tenants"),
      memberId: v.id("members"),
      role: v.string(),
    }),
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
    return {
      tenantId: session.activeTenantId,
      memberId: member._id,
      role: member.role,
    };
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
      buttons: data.buttons,
      exampleVariables: data.parameterSchema
        .sort(
          (
            a: { index: number; example: string },
            b: { index: number; example: string },
          ) => a.index - b.index,
        )
        .map((p: { index: number; example: string }) => p.example),
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

export const createAndSubmitForApproval = action({
  args: {
    whatsappAccountId: v.id("whatsappAccounts"),
    name: v.string(),
    language: v.string(),
    category: categoryValidator,
    bodyText: v.string(),
    buttons: v.optional(templateButtonsValidator),
    parameterSchema: parameterSchemaValidator,
  },
  returns: v.object({
    templateId: v.id("templates"),
    submissionState: v.union(
      v.literal("submitted"),
      v.literal("draft_saved"),
    ),
    metaTemplateId: v.optional(v.string()),
    metaStatus: v.optional(v.string()),
    submissionError: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    templateId: Id<"templates">;
    submissionState: "submitted" | "draft_saved";
    metaTemplateId?: string;
    metaStatus?: string;
    submissionError?: string;
  }> => {
    const me: {
      tenantId: Id<"tenants">;
      memberId: Id<"members">;
      role: string;
    } | null = await ctx.runQuery(internal.templates._meTenantWithRole, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    if (me.role !== "owner" && me.role !== "admin" && me.role !== "marketing") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }

    const templateId: Id<"templates"> = await ctx.runMutation(
      internal.templates._createDraftForAction,
      {
        tenantId: me.tenantId,
        memberId: me.memberId,
        ...args,
      },
    );

    const data = await ctx.runQuery(internal.templates._loadForSubmit, {
      templateId,
      tenantId: me.tenantId,
    });
    if (!data) {
      return {
        templateId,
        submissionState: "draft_saved",
        submissionError: "Template draft saved, but it could not be loaded for Meta submission.",
      };
    }

    const token: string | null = await ctx.runAction(
      internal.whatsappAccounts.decryptWabaToken,
      { whatsappAccountId: data.whatsappAccountId },
    );
    if (!token) {
      return {
        templateId,
        submissionState: "draft_saved",
        submissionError:
          "Template draft saved, but this WABA has no usable access token.",
      };
    }

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
      buttons: data.buttons,
      exampleVariables: data.parameterSchema
        .sort(
          (
            a: { index: number; example: string },
            b: { index: number; example: string },
          ) => a.index - b.index,
        )
        .map((p: { index: number; example: string }) => p.example),
    });

    if (!result.ok) {
      return {
        templateId,
        submissionState: "draft_saved",
        submissionError: result.reason,
      };
    }

    await ctx.runMutation(internal.templates._markSubmitted, {
      templateId,
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
      templateId,
      submissionState: "submitted",
      metaTemplateId: result.metaTemplateId,
      metaStatus: result.status.toLowerCase(),
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

// ---------- Webhook-driven template status sync ----------

const META_TEMPLATE_EVENT_TO_STATUS: Record<
  string,
  "approved" | "rejected" | "paused" | "disabled" | "pending"
> = {
  APPROVED: "approved",
  REJECTED: "rejected",
  PAUSED: "paused",
  DISABLED: "disabled",
  PENDING_DELETION: "disabled",
  FLAGGED: "paused",
  IN_APPEAL: "pending",
  PENDING: "pending",
};

/**
 * Apply a `message_template_status_update` webhook. Resolves the template
 * by metaTemplateId (fallback: WABA tenant + name + language), maps the
 * Meta event to the local status, and pauses running campaigns that use a
 * template which is no longer sendable.
 */
export const applyMetaStatusUpdate = internalMutation({
  args: {
    wabaId: v.string(),
    metaTemplateId: v.string(),
    name: v.string(),
    language: v.string(),
    event: v.string(),
    reason: v.optional(v.string()),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event.toUpperCase();
    const mapped = META_TEMPLATE_EVENT_TO_STATUS[event];
    if (!mapped) return null;

    let template = await ctx.db
      .query("templates")
      .withIndex("by_meta_template_id", (q) =>
        q.eq("metaTemplateId", args.metaTemplateId),
      )
      .first();
    if (!template && args.name && args.language) {
      const account = await ctx.db
        .query("whatsappAccounts")
        .withIndex("by_waba", (q) => q.eq("wabaId", args.wabaId))
        .first();
      if (account) {
        template = await ctx.db
          .query("templates")
          .withIndex("by_tenant_name_lang", (q) =>
            q
              .eq("tenantId", account.tenantId)
              .eq("name", args.name)
              .eq("language", args.language),
          )
          .first();
        // Link the Meta id when we matched by name+language.
        if (template && !template.metaTemplateId) {
          await ctx.db.patch(template._id, {
            metaTemplateId: args.metaTemplateId,
          });
        }
      }
    }
    if (!template) return null;

    await ctx.db.patch(template._id, {
      status: mapped,
      rejectionReason: mapped === "rejected" ? args.reason : template.rejectionReason,
      syncedAt: args.updatedAt,
    });
    const version = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", template._id).eq("version", template.currentVersion),
      )
      .unique();
    if (version) {
      if (mapped === "approved" && !version.approvedAt) {
        await ctx.db.patch(version._id, { approvedAt: args.updatedAt });
      }
      if (mapped === "rejected") {
        await ctx.db.patch(version._id, {
          rejectedAt: args.updatedAt,
          rejectionReason: args.reason,
        });
      }
    }

    // Cascade: a template that is no longer sendable pauses running
    // campaigns that reference it.
    if (mapped === "rejected" || mapped === "paused" || mapped === "disabled") {
      const running = await ctx.db
        .query("campaigns")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", template.tenantId).eq("status", "running"),
        )
        .collect();
      const now = Date.now();
      for (const campaign of running) {
        if (campaign.templateId !== template._id) continue;
        await ctx.db.patch(campaign._id, {
          status: "paused",
          pausedAt: now,
          pauseReason: `template_status:${event}`,
          updatedAt: now,
        });
        await ctx.db.insert("campaignEvents", {
          tenantId: template.tenantId,
          campaignId: campaign._id,
          type: "campaign.auto_paused.template_status",
          payload: { templateId: template._id, event, reason: args.reason },
          createdAt: now,
        });
      }
    }
    return null;
  },
});

// ---------- Template import (pull existing WABA templates into local DB) ----------

type RemoteTemplateForImport = {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  parameterFormat?: string;
  components?: unknown[];
  qualityScore?: string;
  rejectionReason?: string;
};

function metaStatusToLocal(
  status: string,
):
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "paused"
  | "disabled" {
  const lower = status.toLowerCase();
  if (lower === "approved") return "approved";
  if (lower === "rejected") return "rejected";
  if (lower === "paused") return "paused";
  if (lower === "disabled" || lower === "pending_deletion") return "disabled";
  return "pending";
}

function metaCategoryToLocal(
  category?: string,
): "marketing" | "utility" | "authentication" {
  const lower = category?.toLowerCase();
  if (lower === "marketing") return "marketing";
  if (lower === "authentication") return "authentication";
  return "utility";
}

/**
 * Upsert one remote template. Dedupe order:
 *   1. metaTemplateId hit → refresh status/quality ("updated")
 *   2. (name, language) hit without metaTemplateId → link + refresh ("linked")
 *   3. else insert templates + locked templateVersions row ("created")
 * Inserts directly (NOT via createDraft) — imported names/bodies may not
 * satisfy the local builder limits, and that must not block a full sync.
 */
export const _importOne = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
    whatsappAccountId: v.id("whatsappAccounts"),
    remote: v.any(),
  },
  returns: v.union(
    v.literal("created"),
    v.literal("linked"),
    v.literal("updated"),
    v.literal("skipped_no_body"),
  ),
  handler: async (ctx, args) => {
    const remote = args.remote as RemoteTemplateForImport;
    const now = Date.now();
    const status = metaStatusToLocal(remote.status);

    const byMetaId = await ctx.db
      .query("templates")
      .withIndex("by_meta_template_id", (q) =>
        q.eq("metaTemplateId", remote.id),
      )
      .first();
    if (byMetaId && byMetaId.tenantId === args.tenantId) {
      await ctx.db.patch(byMetaId._id, {
        status,
        qualityScore: remote.qualityScore,
        rejectionReason: remote.rejectionReason,
        syncedAt: now,
      });
      return "updated";
    }

    const byNameLang = await ctx.db
      .query("templates")
      .withIndex("by_tenant_name_lang", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("name", remote.name)
          .eq("language", remote.language),
      )
      .first();
    if (byNameLang) {
      await ctx.db.patch(byNameLang._id, {
        metaTemplateId: byNameLang.metaTemplateId ?? remote.id,
        status,
        qualityScore: remote.qualityScore,
        rejectionReason: remote.rejectionReason,
        syncedAt: now,
      });
      return "linked";
    }

    const components = Array.isArray(remote.components)
      ? (remote.components as Array<Record<string, unknown>>)
      : [];
    const body = components.find(
      (c) => String(c.type).toUpperCase() === "BODY",
    );
    const bodyText = body?.text ? String(body.text) : "";
    if (!bodyText) return "skipped_no_body";

    const example = body?.example as
      | { body_text?: string[][] }
      | undefined;
    const exampleValues = example?.body_text?.[0] ?? [];
    const indices = extractParameterIndices(bodyText);
    const parameterSchema = indices.map((index, i) => ({
      index,
      name: `param${index}`,
      example: exampleValues[i] ?? "",
    }));

    const buttonsComponent = components.find(
      (c) => String(c.type).toUpperCase() === "BUTTONS",
    );
    const rawButtons = Array.isArray(buttonsComponent?.buttons)
      ? (buttonsComponent.buttons as Array<Record<string, unknown>>)
      : [];
    const buttons: Array<
      | { type: "quick_reply"; text: string }
      | { type: "url"; text: string; url: string }
      | { type: "phone_number"; text: string; phoneNumber: string }
    > = [];
    for (const b of rawButtons) {
      const t = String(b.type ?? "").toUpperCase();
      const text = String(b.text ?? "");
      if (t === "QUICK_REPLY" && text) buttons.push({ type: "quick_reply", text });
      else if (t === "URL" && text && b.url)
        buttons.push({ type: "url", text, url: String(b.url) });
      else if (t === "PHONE_NUMBER" && text && b.phone_number)
        buttons.push({
          type: "phone_number",
          text,
          phoneNumber: String(b.phone_number),
        });
      // FLOW / OTP / COPY_CODE buttons: kept only in metaComponents.
    }

    const templateId = await ctx.db.insert("templates", {
      tenantId: args.tenantId,
      whatsappAccountId: args.whatsappAccountId,
      name: remote.name,
      language: remote.language,
      category: metaCategoryToLocal(remote.category),
      currentVersion: 1,
      status,
      metaTemplateId: remote.id,
      qualityScore: remote.qualityScore,
      rejectionReason: remote.rejectionReason,
      syncedAt: now,
      source: "imported",
      parameterFormat:
        remote.parameterFormat?.toUpperCase() === "NAMED"
          ? "named"
          : "positional",
      createdAt: now,
      createdBy: args.memberId,
    });
    await ctx.db.insert("templateVersions", {
      templateId,
      tenantId: args.tenantId,
      version: 1,
      bodyText,
      buttons: buttons.length > 0 ? buttons : undefined,
      parameterSchema,
      submittedAt: now,
      approvedAt: status === "approved" ? now : undefined,
      metaComponents: remote.components,
      isLocked: true,
      createdBy: args.memberId,
      createdAt: now,
    });
    return "created";
  },
});

/**
 * Pull every template of a connected WABA into the local DB (paginated,
 * full components). Idempotent: re-runs refresh instead of duplicating.
 */
export const importFromMeta = action({
  args: { whatsappAccountId: v.id("whatsappAccounts") },
  returns: v.object({
    created: v.number(),
    linked: v.number(),
    updated: v.number(),
    skipped: v.number(),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const me: {
      tenantId: Id<"tenants">;
      memberId: Id<"members">;
      role: string;
    } | null = await ctx.runQuery(internal.templates._meTenantWithRole, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    if (!["owner", "admin", "marketing"].includes(me.role)) {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    const account: { metaAppId: string; wabaId: string } | null =
      await ctx.runQuery(internal.whatsappAccounts._getAccountBasics, {
        whatsappAccountId: args.whatsappAccountId,
      });
    if (!account) throw new ConvexError({ code: "NOT_FOUND" });

    const token: string | null = await ctx.runAction(
      internal.whatsappAccounts.decryptWabaToken,
      { whatsappAccountId: args.whatsappAccountId },
    );
    if (!token) throw new ConvexError({ code: "TOKEN_UNAVAILABLE" });

    const res = await listMetaTemplatesFull({
      token,
      wabaId: account.wabaId,
    });
    if (!res.ok) {
      throw new ConvexError({ code: "META_LIST_FAILED", message: res.message });
    }

    const counts = { created: 0, linked: 0, updated: 0, skipped: 0 };
    for (const remote of res.data) {
      const outcome: "created" | "linked" | "updated" | "skipped_no_body" =
        await ctx.runMutation(internal.templates._importOne, {
          tenantId: me.tenantId,
          memberId: me.memberId,
          whatsappAccountId: args.whatsappAccountId,
          remote,
        });
      if (outcome === "created") counts.created += 1;
      else if (outcome === "linked") counts.linked += 1;
      else if (outcome === "updated") counts.updated += 1;
      else counts.skipped += 1;
    }
    return { ...counts, truncated: res.truncated };
  },
});

/**
 * Cron sweep: refresh template statuses for every account. Never creates
 * rows (creation needs a member) — webhook + importFromMeta handle that.
 */
export const sweepTemplateStatuses = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const ids: Id<"whatsappAccounts">[] = await ctx.runQuery(
      internal.whatsappAccounts._listAccountIdsForSweep,
      {},
    );
    for (const accountId of ids) {
      const account: { metaAppId: string; wabaId: string } | null =
        await ctx.runQuery(internal.whatsappAccounts._getAccountBasics, {
          whatsappAccountId: accountId,
        });
      if (!account) continue;
      const token: string | null = await ctx.runAction(
        internal.whatsappAccounts.decryptWabaToken,
        { whatsappAccountId: accountId },
      );
      if (!token) continue;
      const res = await listMetaTemplatesFull({
        token,
        wabaId: account.wabaId,
      });
      if (!res.ok) continue;
      for (const remote of res.data) {
        await ctx.runMutation(internal.templates._refreshStatusFromRemote, {
          wabaId: account.wabaId,
          metaTemplateId: remote.id,
          name: remote.name,
          language: remote.language,
          status: remote.status,
          qualityScore: remote.qualityScore,
          rejectionReason: remote.rejectionReason,
        });
      }
    }
    return null;
  },
});

export const _refreshStatusFromRemote = internalMutation({
  args: {
    wabaId: v.string(),
    metaTemplateId: v.string(),
    name: v.string(),
    language: v.string(),
    status: v.string(),
    qualityScore: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let template = await ctx.db
      .query("templates")
      .withIndex("by_meta_template_id", (q) =>
        q.eq("metaTemplateId", args.metaTemplateId),
      )
      .first();
    if (!template) {
      const account = await ctx.db
        .query("whatsappAccounts")
        .withIndex("by_waba", (q) => q.eq("wabaId", args.wabaId))
        .first();
      if (!account) return null;
      template = await ctx.db
        .query("templates")
        .withIndex("by_tenant_name_lang", (q) =>
          q
            .eq("tenantId", account.tenantId)
            .eq("name", args.name)
            .eq("language", args.language),
        )
        .first();
    }
    if (!template) return null;
    await ctx.db.patch(template._id, {
      metaTemplateId: template.metaTemplateId ?? args.metaTemplateId,
      status: metaStatusToLocal(args.status),
      qualityScore: args.qualityScore,
      rejectionReason: args.rejectionReason,
      syncedAt: Date.now(),
    });
    return null;
  },
});
