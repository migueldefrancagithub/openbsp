import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedOwner(
  t: ReturnType<typeof convexTest>,
  rgpd?: {
    dpaSignedAt?: number;
    dpiaCompletedAt?: number;
  },
) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Compliance Owner" });
  });
  await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Compliance Clinic",
      vertical: "clinic",
      healthcareMode: true,
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Europe/Lisbon",
        retentionDays: 730,
      },
      rgpd: {
        controllerName: "Compliance Clinic",
        controllerEmail: "privacy@example.test",
        ...rgpd,
      },
      createdAt: Date.now(),
    });
    await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: Date.now(),
    });
  });
  return t.withIdentity({ subject: userId });
}

const connectArgs = {
  metaAppId: "APP_1",
  wabaId: "WABA_1",
  phoneNumberId: "PHONE_1",
  phoneE164: "+351910000000",
  phoneDisplayName: "Compliance Clinic",
  systemUserToken: "token-should-not-be-validated",
};

describe("WhatsApp account compliance gate", () => {
  it("blocks manual WABA connection before DPA is signed", async () => {
    const t = convexTest(schema);
    const owner = await seedOwner(t);
    vi.stubGlobal("fetch", async () => {
      throw new Error("Meta token validation should not run before DPA gate.");
    });

    await expect(
      owner.action((api as any).whatsappAccounts.connectManual, connectArgs),
    ).rejects.toThrow(/DPA_REQUIRED/);
  });

  it("blocks manual WABA connection before DPIA is completed", async () => {
    const t = convexTest(schema);
    const owner = await seedOwner(t, { dpaSignedAt: Date.now() });
    vi.stubGlobal("fetch", async () => {
      throw new Error("Meta token validation should not run before DPIA gate.");
    });

    await expect(
      owner.action((api as any).whatsappAccounts.connectManual, connectArgs),
    ).rejects.toThrow(/DPIA_REQUIRED/);
  });
});
