import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  tenants: defineTable({
    name: v.string(),
    vertical: v.union(
      v.literal("clinic"),
      v.literal("services"),
      v.literal("ecommerce"),
      v.literal("other"),
    ),
    healthcareMode: v.boolean(),
    plan: v.union(
      v.literal("starter"),
      v.literal("growth"),
      v.literal("enterprise"),
    ),
    settings: v.object({
      defaultLocale: v.string(),
      timezone: v.string(),
      retentionDays: v.number(),
    }),
    rgpd: v.object({
      controllerName: v.string(),
      controllerEmail: v.string(),
      dpaSignedAt: v.optional(v.number()),
      dpiaCompletedAt: v.optional(v.number()),
    }),
    createdAt: v.number(),
  }),

  members: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("agent"),
      v.literal("marketing"),
    ),
    healthcareProfessional: v.optional(v.boolean()),
    status: v.union(v.literal("active"), v.literal("suspended")),
    createdAt: v.number(),
  })
    .index("by_tenant_user", ["tenantId", "userId"])
    .index("by_user", ["userId"]),

  sessions: defineTable({
    userId: v.id("users"),
    activeTenantId: v.id("tenants"),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
