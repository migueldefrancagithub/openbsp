import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import {
  loadByIdInTenant,
  requireRoleAtLeast,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";

export const MAX_ACTIVE_FIELDS = 20;

export const customFieldTypeValidator = v.union(
  v.literal("text"),
  v.literal("number"),
  v.literal("date"),
  v.literal("select"),
  v.literal("boolean"),
);

const definitionValidator = v.object({
  _id: v.id("customFieldDefinitions"),
  key: v.string(),
  label: v.string(),
  type: customFieldTypeValidator,
  options: v.optional(v.array(v.string())),
  order: v.number(),
  active: v.boolean(),
});

export function slugifyFieldKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export async function listActiveDefinitions(
  ctx: { db: any; tenantId: Id<"tenants"> },
): Promise<Doc<"customFieldDefinitions">[]> {
  return (await ctx.db
    .query("customFieldDefinitions")
    .withIndex("by_tenant", (q: any) => q.eq("tenantId", ctx.tenantId).eq("active", true))
    .take(MAX_ACTIVE_FIELDS + 5)) as Doc<"customFieldDefinitions">[];
}

/**
 * Validate a partial values map against the tenant's active definitions.
 * Empty string / null-ish values clear a field. Returns the merged map.
 */
export function mergeCustomFieldValues(
  definitions: Doc<"customFieldDefinitions">[],
  current: Record<string, string | number | boolean> | undefined,
  patch: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const next: Record<string, string | number | boolean> = { ...(current ?? {}) };
  for (const [key, rawValue] of Object.entries(patch)) {
    const definition = byKey.get(key);
    if (!definition) throw new ConvexError({ code: "CUSTOM_FIELD_UNKNOWN", key });
    if (rawValue === "" || rawValue === undefined) {
      delete next[key];
      continue;
    }
    switch (definition.type) {
      case "text":
        if (typeof rawValue !== "string" || rawValue.length > 500) {
          throw new ConvexError({ code: "CUSTOM_FIELD_INVALID", key });
        }
        next[key] = rawValue.trim();
        break;
      case "number": {
        const numeric = typeof rawValue === "number" ? rawValue : Number(rawValue);
        if (!Number.isFinite(numeric)) throw new ConvexError({ code: "CUSTOM_FIELD_INVALID", key });
        next[key] = numeric;
        break;
      }
      case "date":
        if (typeof rawValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
          throw new ConvexError({ code: "CUSTOM_FIELD_INVALID", key });
        }
        next[key] = rawValue;
        break;
      case "select":
        if (typeof rawValue !== "string" || !(definition.options ?? []).includes(rawValue)) {
          throw new ConvexError({ code: "CUSTOM_FIELD_INVALID", key });
        }
        next[key] = rawValue;
        break;
      case "boolean":
        next[key] = rawValue === true || rawValue === "true";
        break;
    }
  }
  return next;
}

export const listDefinitions = tenantQuery({
  args: { includeArchived: v.optional(v.boolean()) },
  returns: v.array(definitionValidator),
  handler: async (ctx, args) => {
    const rows = args.includeArchived
      ? ((await ctx.db
          .query("customFieldDefinitions")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .take(100)) as Doc<"customFieldDefinitions">[])
      : await listActiveDefinitions(ctx);
    return rows
      .sort((a, b) => a.order - b.order)
      .map((row) => ({
        _id: row._id,
        key: row.key,
        label: row.label,
        type: row.type,
        options: row.options,
        order: row.order,
        active: row.active,
      }));
  },
});

export const saveDefinition = tenantMutation({
  args: {
    definitionId: v.optional(v.id("customFieldDefinitions")),
    label: v.string(),
    type: customFieldTypeValidator,
    options: v.optional(v.array(v.string())),
    order: v.optional(v.number()),
  },
  returns: v.id("customFieldDefinitions"),
  handler: async (ctx, args) => {
    requireRoleAtLeast(ctx.role, "admin");
    const label = args.label.trim().replace(/\s+/g, " ");
    if (label.length < 2 || label.length > 40) {
      throw new ConvexError({ code: "INVALID_FIELD_LABEL" });
    }
    const options =
      args.type === "select"
        ? Array.from(new Set((args.options ?? []).map((option) => option.trim()).filter(Boolean))).slice(0, 20)
        : undefined;
    if (args.type === "select" && (!options || options.length === 0)) {
      throw new ConvexError({ code: "CUSTOM_FIELD_INVALID", key: "options" });
    }
    const now = Date.now();
    if (args.definitionId) {
      const existing = await loadByIdInTenant(ctx, "customFieldDefinitions", args.definitionId);
      await ctx.db.patch(existing._id, {
        label,
        type: args.type,
        options,
        order: args.order ?? existing.order,
        updatedAt: now,
      });
      await writeAudit(ctx, {
        action: "settings.custom_field.updated",
        targetType: "customFieldDefinition",
        targetId: existing._id,
        payload: { label, type: args.type },
      });
      return existing._id;
    }
    const key = slugifyFieldKey(label);
    if (!key) throw new ConvexError({ code: "INVALID_FIELD_KEY" });
    const active = await listActiveDefinitions(ctx);
    if (active.length >= MAX_ACTIVE_FIELDS) {
      throw new ConvexError({ code: "CUSTOM_FIELD_LIMIT", limit: MAX_ACTIVE_FIELDS });
    }
    const clash = (await ctx.db
      .query("customFieldDefinitions")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", ctx.tenantId).eq("key", key))
      .unique()) as Doc<"customFieldDefinitions"> | null;
    if (clash) {
      if (!clash.active) {
        await ctx.db.patch(clash._id, { active: true, label, type: args.type, options, updatedAt: now });
        return clash._id;
      }
      throw new ConvexError({ code: "CUSTOM_FIELD_EXISTS", key });
    }
    const definitionId = await ctx.db.insert("customFieldDefinitions", {
      tenantId: ctx.tenantId,
      key,
      label,
      type: args.type,
      options,
      order: args.order ?? active.length,
      active: true,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      action: "settings.custom_field.created",
      targetType: "customFieldDefinition",
      targetId: definitionId,
      payload: { key, label, type: args.type },
    });
    return definitionId;
  },
});

export const archiveDefinition = tenantMutation({
  args: { definitionId: v.id("customFieldDefinitions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireRoleAtLeast(ctx.role, "admin");
    const existing = await loadByIdInTenant(ctx, "customFieldDefinitions", args.definitionId);
    await ctx.db.patch(existing._id, { active: false, updatedAt: Date.now() });
    await writeAudit(ctx, {
      action: "settings.custom_field.archived",
      targetType: "customFieldDefinition",
      targetId: existing._id,
    });
    return null;
  },
});
