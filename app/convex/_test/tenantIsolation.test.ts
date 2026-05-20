import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

describe("tenant isolation", () => {
  it("user without membership cannot read another tenant's data", async () => {
    const t = convexTest(schema);

    // Seed: create user1 + tenant1
    const user1 = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "Alice" });
    });
    const tenant1 = await t.run(async (ctx) => {
      const tid = await ctx.db.insert("tenants", {
        name: "Clinic Alice",
        vertical: "clinic",
        plan: "starter",
        settings: { defaultLocale: "pt-PT", timezone: "Europe/Lisbon", retentionDays: 730 },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
        tenantId: tid,
        userId: user1,
        role: "owner",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("sessions", {
        userId: user1,
        activeTenantId: tid,
        updatedAt: Date.now(),
      });
      return tid;
    });

    // Seed: create user2 + tenant2 (separate)
    const user2 = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "Bob" });
    });
    await t.run(async (ctx) => {
      const tid = await ctx.db.insert("tenants", {
        name: "Clinic Bob",
        vertical: "clinic",
        plan: "starter",
        settings: { defaultLocale: "pt-PT", timezone: "Europe/Lisbon", retentionDays: 730 },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
        tenantId: tid,
        userId: user2,
        role: "owner",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("sessions", {
        userId: user2,
        activeTenantId: tid,
        updatedAt: Date.now(),
      });
      return tid;
    });

    // user1 reads getActive → returns Clinic Alice
    const aliceCtx = t.withIdentity({ subject: user1 });
    const aliceResult = await aliceCtx.query(api.tenantsQueries.getActive, {});
    expect(aliceResult.name).toBe("Clinic Alice");
    expect(aliceResult.tenantId).toBe(tenant1);

    // user2 reads getActive → returns Clinic Bob (own tenant), NOT Alice's
    const bobCtx = t.withIdentity({ subject: user2 });
    const bobResult = await bobCtx.query(api.tenantsQueries.getActive, {});
    expect(bobResult.name).toBe("Clinic Bob");
    expect(bobResult.tenantId).not.toBe(tenant1);

    // unauthenticated request throws UNAUTHENTICATED
    await expect(
      t.query(api.tenantsQueries.getActive, {}),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it("user with no session throws NO_ACTIVE_TENANT", async () => {
    const t = convexTest(schema);
    const user = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "Carol" });
    });
    const carolCtx = t.withIdentity({ subject: user });
    await expect(
      carolCtx.query(api.tenantsQueries.getActive, {}),
    ).rejects.toThrow(/NO_ACTIVE_TENANT/);
  });

  it("user with session but suspended membership is FORBIDDEN", async () => {
    const t = convexTest(schema);
    const user = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "Dave" });
    });
    await t.run(async (ctx) => {
      const tid = await ctx.db.insert("tenants", {
        name: "Suspended Clinic",
        vertical: "clinic",
        plan: "starter",
        settings: { defaultLocale: "pt-PT", timezone: "Europe/Lisbon", retentionDays: 730 },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
        tenantId: tid,
        userId: user,
        role: "owner",
        status: "suspended",
        createdAt: Date.now(),
      });
      await ctx.db.insert("sessions", {
        userId: user,
        activeTenantId: tid,
        updatedAt: Date.now(),
      });
    });
    const daveCtx = t.withIdentity({ subject: user });
    await expect(
      daveCtx.query(api.tenantsQueries.getActive, {}),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("lists all companies for the current user and marks the active workspace", async () => {
    const t = convexTest(schema);
    const user = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "Multi Owner" });
    });
    const seeded = await t.run(async (ctx) => {
      const tenantA = await ctx.db.insert("tenants", {
        name: "Marisa Clinic",
        vertical: "clinic",
        plan: "growth",
        settings: { defaultLocale: "pt-PT", timezone: "Africa/Maputo", retentionDays: 730 },
        createdAt: Date.now(),
      });
      const tenantB = await ctx.db.insert("tenants", {
        name: "Smart Business",
        vertical: "services",
        plan: "starter",
        settings: { defaultLocale: "pt-PT", timezone: "Africa/Maputo", retentionDays: 730 },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
        tenantId: tenantA,
        userId: user,
        role: "owner",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
        tenantId: tenantB,
        userId: user,
        role: "admin",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("sessions", {
        userId: user,
        activeTenantId: tenantA,
        updatedAt: Date.now(),
      });
      return { tenantA, tenantB };
    });
    const authed = t.withIdentity({ subject: user });

    const before = await authed.query((api as any).tenantsQueries.listMine, {});
    expect(before.map((tenant: { name: string }) => tenant.name)).toEqual([
      "Marisa Clinic",
      "Smart Business",
    ]);
    expect(before.find((tenant: { tenantId: string }) => tenant.tenantId === seeded.tenantA)?.active).toBe(true);
    expect(before.find((tenant: { tenantId: string }) => tenant.tenantId === seeded.tenantB)?.role).toBe("admin");

    await authed.mutation(api.tenants.switchActive, { tenantId: seeded.tenantB });

    const after = await authed.query((api as any).tenantsQueries.listMine, {});
    expect(after.find((tenant: { tenantId: string }) => tenant.tenantId === seeded.tenantA)?.active).toBe(false);
    expect(after.find((tenant: { tenantId: string }) => tenant.tenantId === seeded.tenantB)?.active).toBe(true);
  });
});
