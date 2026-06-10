import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

afterEach(() => {
  delete process.env.META_EMBEDDED_SIGNUP_APP_ID;
  delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
  delete process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI;
  delete process.env.META_EMBEDDED_SIGNUP_APP_SECRET;
  delete process.env.PLATFORM_META_APP_SECRET;
  delete process.env.PLATFORM_META_VERIFY_TOKEN;
  delete process.env.CONVEX_SITE_URL;
  delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
});

async function seedOwner(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Admission Owner" });
  });
  const tenantId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("tenants", {
      name: "Admission Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: Date.now(),
    });
    await ctx.db.insert("members", {
      tenantId: id,
      userId,
      role: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: id,
      updatedAt: Date.now(),
    });
    return id;
  });
  return { tenantId, owner: t.withIdentity({ subject: userId }) };
}

describe("Meta admission readiness", () => {
  it("combines automatic provider checks with manual admission state", async () => {
    const t = convexTest(schema);
    const { tenantId, owner } = await seedOwner(t);
    process.env.META_EMBEDDED_SIGNUP_APP_ID = "APP_1";
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "CONFIG_1";
    process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI =
      "https://openbsp.example/embedded-signup/callback";
    process.env.META_EMBEDDED_SIGNUP_APP_SECRET = "APP_SECRET";
    process.env.PLATFORM_META_APP_SECRET = "WEBHOOK_SECRET";
    process.env.PLATFORM_META_VERIFY_TOKEN = "VERIFY";
    process.env.CONVEX_SITE_URL = "https://openbsp.example";
    process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 =
      "0000000000000000000000000000000000000000000000000000000000000000";

    await t.run(async (ctx) => {
      await ctx.db.insert("whatsappAccounts", {
        tenantId,
        metaAppId: "APP_1",
        wabaId: "WABA_1",
        accessTokenCiphertext: "aes256gcm:v1:iv:ciphertext",
        accessTokenKeyVersion: 1,
        accessTokenEncryption: "aes-256-gcm",
        status: "active",
        tokenStatus: "ok",
        createdAt: Date.now(),
      });
    });

    const first = await owner.query((api as any).metaAdmission.readiness, {});
    expect(first.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "embedded_signup_configured",
          status: "done",
        }),
        expect.objectContaining({
          key: "webhook_hmac_configured",
          status: "done",
        }),
        expect.objectContaining({
          key: "waba_connected",
          status: "done",
        }),
        expect.objectContaining({
          key: "token_encryption_enabled",
          status: "done",
        }),
      ]),
    );

    await owner.mutation((api as any).metaAdmission.setManualCheck, {
      key: "business_verified",
      status: "done",
    });

    const second = await owner.query((api as any).metaAdmission.readiness, {});
    expect(second.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "business_verified",
          status: "done",
        }),
      ]),
    );
  });
});
