import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { CAPABILITIES, hasCapability, ROLES } from "../lib/roles";
import schema from "../schema";

async function seedTenant(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name,
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const users: Record<string, { userId: Id<"users">; memberId: Id<"members"> }> = {};
    for (const role of ["owner", "admin", "agent", "marketing"] as const) {
      const userId = await ctx.db.insert("users", { name: role });
      const memberId = await ctx.db.insert("members", { tenantId, userId, role, status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
      users[role] = { userId, memberId };
    }
    return { tenantId, users };
  });
}

describe("capability matrix", () => {
  it("is explicit for every role/capability pair", () => {
    for (const role of ROLES) {
      for (const capability of CAPABILITIES) {
        expect(typeof hasCapability(role, capability)).toBe("boolean");
      }
    }
    expect(hasCapability("owner", "feature_flag.set")).toBe(true);
    expect(hasCapability("admin", "feature_flag.set")).toBe(false);
    expect(hasCapability("agent", "teams.manage")).toBe(false);
    expect(hasCapability("agent", "quick_replies.manage")).toBe(true);
    expect(hasCapability("marketing", "messages.send")).toBe(false);
    expect(hasCapability("marketing", "analytics.read")).toBe(true);
  });

  it("is enforced on quick replies, imports, teams and clinic settings", async () => {
    const t = convexTest(schema);
    const { users } = await seedTenant(t, "RBAC");
    const asMarketing = t.withIdentity({ subject: users.marketing.userId });
    const asAgent = t.withIdentity({ subject: users.agent.userId });
    const asAdmin = t.withIdentity({ subject: users.admin.userId });

    await expect(
      asMarketing.mutation(api.quickReplies.create, { name: "ola", content: "Olá" }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    await asAgent.mutation(api.quickReplies.create, { name: "ola", content: "Olá" });

    await expect(
      asAgent.mutation(api.contacts.bulkImport, { rows: [{ phone: "+258840000001" }] }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);

    await expect(
      asAgent.mutation(api.teams.create, { name: "Recepção", members: [] }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    const teamId = await asAdmin.mutation(api.teams.create, { name: "Recepção", members: [] });
    expect(teamId).toBeDefined();

    await expect(
      asAgent.mutation(api.clinic.createService, { name: "Consulta", durationMinutes: 30 }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    const serviceId = await asAdmin.mutation(api.clinic.createService, { name: "Consulta", durationMinutes: 30 });
    await expect(
      asMarketing.mutation(api.clinic.createAppointment, { serviceId, startAt: Date.now() }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
  });
});
