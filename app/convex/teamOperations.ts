import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import {
  loadByIdInTenant,
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";

const responsibilityValidator = v.union(
  v.literal("sales_calls"),
  v.literal("support_calls"),
  v.literal("appointment_calls"),
  v.literal("follow_up_calls"),
  v.literal("owner_updates"),
);

const RESPONSIBILITIES = [
  "sales_calls",
  "support_calls",
  "appointment_calls",
  "follow_up_calls",
  "owner_updates",
] as const;

function normalizedPhone(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return undefined;
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new ConvexError({ code: "INVALID_PHONE" });
  }
  return `+${digits}`;
}

function maskPhone(value?: string): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "••••";
  return `+${digits.slice(0, 3)} •••• ${digits.slice(-4)}`;
}

export const list = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      memberId: v.id("members"),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      role: v.string(),
      responsibilities: v.array(responsibilityValidator),
      receivesWhatsappBriefings: v.boolean(),
      phoneConfigured: v.boolean(),
      phoneMasked: v.optional(v.string()),
      priority: v.number(),
      active: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    requireCapability(ctx.role, "presence.view");
    const members = (await ctx.db
      .query("members")
      .withIndex("by_tenant_user", (q) => q.eq("tenantId", ctx.tenantId))
      .take(100)) as Doc<"members">[];
    const rows = [];
    for (const member of members) {
      if (member.status !== "active") continue;
      const [user, profile] = await Promise.all([
        ctx.db.get(member.userId),
        ctx.db
          .query("memberOperationalProfiles")
          .withIndex("by_tenant_member", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("memberId", member._id),
          )
          .unique(),
      ]);
      rows.push({
        memberId: member._id,
        name: user?.name,
        email: user?.email,
        role: member.role,
        responsibilities: profile?.responsibilities ?? [],
        receivesWhatsappBriefings: profile?.receivesWhatsappBriefings ?? false,
        phoneConfigured: !!profile?.phoneE164,
        phoneMasked: maskPhone(profile?.phoneE164),
        priority: profile?.priority ?? 50,
        active: profile?.active ?? true,
      });
    }
    return rows.sort((a, b) => a.priority - b.priority || (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));
  },
});

export const save = tenantMutation({
  args: {
    memberId: v.id("members"),
    phoneE164: v.optional(v.string()),
    clearPhone: v.optional(v.boolean()),
    responsibilities: v.array(responsibilityValidator),
    receivesWhatsappBriefings: v.boolean(),
    priority: v.number(),
    active: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "teams.manage");
    const member = await loadByIdInTenant(ctx, "members", args.memberId);
    if (member.status !== "active") throw new ConvexError({ code: "MEMBER_NOT_ACTIVE" });
    const existing = await ctx.db
      .query("memberOperationalProfiles")
      .withIndex("by_tenant_member", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("memberId", member._id),
      )
      .unique();
    const requested = Array.from(
      new Set(args.responsibilities.filter((row) => RESPONSIBILITIES.includes(row))),
    );
    const phoneE164 = args.clearPhone
      ? undefined
      : args.phoneE164 !== undefined
        ? normalizedPhone(args.phoneE164)
        : existing?.phoneE164;
    if (args.receivesWhatsappBriefings && !phoneE164) {
      throw new ConvexError({ code: "STAFF_PHONE_REQUIRED" });
    }
    const now = Date.now();
    const values = {
      phoneE164,
      responsibilities: requested,
      receivesWhatsappBriefings: args.receivesWhatsappBriefings,
      priority: Math.min(100, Math.max(1, Math.round(args.priority))),
      active: args.active,
      updatedBy: ctx.memberId,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, values);
    } else {
      await ctx.db.insert("memberOperationalProfiles", {
        tenantId: ctx.tenantId,
        memberId: member._id,
        ...values,
        createdAt: now,
      });
    }
    await writeAudit(ctx, {
      action: "team.operational_profile.updated",
      targetType: "member",
      targetId: member._id,
      payload: {
        responsibilities: requested,
        receivesWhatsappBriefings: args.receivesWhatsappBriefings,
        phoneConfigured: !!phoneE164,
        priority: values.priority,
        active: args.active,
      },
    });
    return null;
  },
});
