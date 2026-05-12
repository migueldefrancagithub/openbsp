import { v, ConvexError } from "convex/values";
import { tenantQuery } from "./lib/customFunctions";

export const getActive = tenantQuery({
  args: {},
  returns: v.object({
    tenantId: v.id("tenants"),
    name: v.string(),
    vertical: v.string(),
    healthcareMode: v.boolean(),
    role: v.string(),
  }),
  handler: async (ctx) => {
    const tenant = await ctx.db.get(ctx.tenantId);
    if (!tenant) throw new ConvexError({ code: "NOT_FOUND" });
    return {
      tenantId: ctx.tenantId,
      name: tenant.name,
      vertical: tenant.vertical,
      healthcareMode: tenant.healthcareMode,
      role: ctx.role,
    };
  },
});
