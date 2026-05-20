import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.META_EMBEDDED_SIGNUP_APP_ID;
  delete process.env.META_EMBEDDED_SIGNUP_APP_SECRET;
  delete process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI;
});

async function seedSignupSession(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Coex Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Coex Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-BR",
        timezone: "America/Sao_Paulo",
        retentionDays: 730,
      },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    const sessionId = await ctx.db.insert("embeddedSignupSessions", {
      tenantId,
      createdBy: memberId,
      state: "state-coex-1",
      status: "created",
      createdAt: Date.now(),
    });
    return { sessionId };
  });
}

describe("embedded signup", () => {
  it("persists v4 returned business, WABA, and phone assets", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seedSignupSession(t);

    const result = await t.action((api as any).embeddedSignup.completeCallback, {
      state: "state-coex-1",
      code: "oauth-code",
      business_id: "BM_123",
      waba_id: "WABA_456",
      phone_number_id: "PHONE_789",
      phone_e164: "+5511999999999",
      phone_display_name: "WT Connect",
    });

    expect(result).toEqual({ ok: true, status: "assets_received" });
    const row = await t.run(async (ctx) => {
      return await ctx.db.get(sessionId);
    });
    expect(row).toMatchObject({
      status: "assets_received",
      callbackCode: "oauth-code",
      businessId: "BM_123",
      wabaId: "WABA_456",
      phoneNumberId: "PHONE_789",
      phoneE164: "+5511999999999",
      phoneDisplayName: "WT Connect",
    });
    expect(row?.completedAt).toEqual(expect.any(Number));
  });

  it("records embedded signup ownership metadata on connected WABAs", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seedSignupSession(t);
    const tenantId = await t.run(async (ctx) => {
      const session = await ctx.db.get(sessionId);
      return session!.tenantId;
    });

    const result = await t.mutation(internal.whatsappAccounts.insertConnection, {
      tenantId,
      metaAppId: "APP_1",
      businessPortfolioId: "BM_123",
      onboardingSource: "embedded_signup",
      embeddedSignupSessionId: sessionId,
      wabaId: "WABA_456",
      validatedScopes: ["whatsapp_business_messaging"],
      accessToken: "token",
      phoneNumberId: "PHONE_789",
      phoneE164: "+5511999999999",
      phoneDisplayName: "WT Connect",
    });

    const account = await t.run(async (ctx) => {
      return await ctx.db.get(result.whatsappAccountId);
    });
    expect(account).toMatchObject({
      businessPortfolioId: "BM_123",
      onboardingSource: "embedded_signup",
      embeddedSignupSessionId: sessionId,
    });
  });

  it("exchanges a callback code and creates the WABA connection when Meta env is configured", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seedSignupSession(t);
    process.env.META_EMBEDDED_SIGNUP_APP_ID = "APP_1";
    process.env.META_EMBEDDED_SIGNUP_APP_SECRET = "APP_SECRET";
    process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI =
      "https://cxcast.example/embedded-signup/callback";
    const calls: string[] = [];

    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request) => {
        const url = input.toString();
        calls.push(url);
        if (url.includes("/oauth/access_token")) {
          const parsed = new URL(url);
          expect(parsed.searchParams.get("client_id")).toBe("APP_1");
          expect(parsed.searchParams.get("client_secret")).toBe("APP_SECRET");
          expect(parsed.searchParams.get("redirect_uri")).toBe(
            "https://cxcast.example/embedded-signup/callback",
          );
          expect(parsed.searchParams.get("code")).toBe("oauth-code");
          return Response.json({ access_token: "business-token" });
        }
        if (url.endsWith("/me")) {
          return Response.json({ id: "system-user-1", type: "SYSTEM_USER" });
        }
        if (url.includes("/me/permissions")) {
          return Response.json({
            data: [
              {
                permission: "whatsapp_business_messaging",
                status: "granted",
              },
              {
                permission: "whatsapp_business_management",
                status: "granted",
              },
              { permission: "business_management", status: "granted" },
            ],
          });
        }
        if (url.includes("/WABA_456/subscribed_apps")) {
          return Response.json({ success: true });
        }
        return Response.json(
          { error: { message: `unexpected URL ${url}` } },
          { status: 500 },
        );
      },
    );

    const result = await t.action((api as any).embeddedSignup.completeCallback, {
      state: "state-coex-1",
      code: "oauth-code",
      business_id: "BM_123",
      waba_id: "WABA_456",
      phone_number_id: "PHONE_789",
      phone_e164: "+5511999999999",
      phone_display_name: "WT Connect",
    });

    expect(result).toEqual({ ok: true, status: "connected" });
    expect(calls.some((url) => url.includes("/oauth/access_token"))).toBe(true);
    expect(calls.some((url) => url.includes("/WABA_456/subscribed_apps"))).toBe(
      true,
    );
    const rows = await t.run(async (ctx) => {
      return {
        session: await ctx.db.get(sessionId),
        accounts: await ctx.db.query("whatsappAccounts").collect(),
        phones: await ctx.db.query("phoneNumbers").collect(),
      };
    });
    expect(rows.session?.status).toBe("connected");
    expect(rows.accounts[0]).toMatchObject({
      businessPortfolioId: "BM_123",
      wabaId: "WABA_456",
      accessToken: "business-token",
      onboardingSource: "embedded_signup",
      embeddedSignupSessionId: sessionId,
    });
    expect(rows.phones[0]).toMatchObject({
      phoneNumberId: "PHONE_789",
      e164: "+5511999999999",
      displayName: "WT Connect",
    });
  });
});
