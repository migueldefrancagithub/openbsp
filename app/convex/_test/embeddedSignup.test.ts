import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.META_EMBEDDED_SIGNUP_APP_ID;
  delete process.env.META_EMBEDDED_SIGNUP_APP_SECRET;
  delete process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI;
  delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
});

async function seedSignupSession(
  t: ReturnType<typeof convexTest>,
  opts?: { signedCompliance?: boolean },
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Coex Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Coex Clinic",
      vertical: "clinic",
      healthcareMode: true,
      plan: "growth",
      settings: {
        defaultLocale: "pt-BR",
        timezone: "America/Sao_Paulo",
        retentionDays: 730,
      },
      rgpd: opts?.signedCompliance === false
        ? {
            controllerName: "Coex Clinic",
            controllerEmail: "privacy@example.test",
          }
        : {
            controllerName: "Coex Clinic",
            controllerEmail: "privacy@example.test",
            dpaSignedAt: Date.now(),
            dpiaCompletedAt: Date.now(),
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
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: Date.now(),
    });
    const sessionId = await ctx.db.insert("embeddedSignupSessions", {
      tenantId,
      createdBy: memberId,
      state: "state-coex-1",
      status: "created",
      createdAt: Date.now(),
    });
    return { userId, tenantId, memberId, sessionId };
  });
}

describe("embedded signup", () => {
  it("records URL hints without trusting them when Meta env is not configured", async () => {
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

    // URL params are hints only — without the server-side token exchange +
    // debug_token verification no connection is created and the session
    // stays at callback_received.
    expect(result).toEqual({ ok: true, status: "callback_received" });
    const row = await t.run(async (ctx) => {
      return await ctx.db.get(sessionId);
    });
    expect(row).toMatchObject({
      status: "callback_received",
      callbackCode: "oauth-code",
      businessId: "BM_123",
      wabaId: "WABA_456",
      phoneNumberId: "PHONE_789",
    });
    expect(row?.completedAt).toEqual(expect.any(Number));
    const accounts = await t.run(async (ctx) =>
      ctx.db.query("whatsappAccounts").collect(),
    );
    expect(accounts).toHaveLength(0);
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
        if (url.includes("/debug_token")) {
          return Response.json({
            data: {
              app_id: "APP_1",
              is_valid: true,
              expires_at: 0,
              type: "SYSTEM_USER",
              scopes: [
                "whatsapp_business_messaging",
                "whatsapp_business_management",
                "business_management",
              ],
              granular_scopes: [
                {
                  scope: "whatsapp_business_management",
                  target_ids: ["WABA_456"],
                },
              ],
            },
          });
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
        if (url.includes("/WABA_456/phone_numbers")) {
          return Response.json({
            data: [
              {
                id: "PHONE_789",
                display_phone_number: "+55 11 99999-9999",
                verified_name: "WT Connect",
              },
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

  it("fails before Meta token exchange when DPA/DPIA gates are incomplete", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seedSignupSession(t, {
      signedCompliance: false,
    });
    process.env.META_EMBEDDED_SIGNUP_APP_ID = "APP_1";
    process.env.META_EMBEDDED_SIGNUP_APP_SECRET = "APP_SECRET";
    process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI =
      "https://cxcast.example/embedded-signup/callback";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      calls.push(input.toString());
      return Response.json({ access_token: "should-not-be-used" });
    });

    const result = await t.action((api as any).embeddedSignup.completeCallback, {
      state: "state-coex-1",
      code: "oauth-code",
      business_id: "BM_123",
      waba_id: "WABA_456",
      phone_number_id: "PHONE_789",
      phone_e164: "+5511999999999",
      phone_display_name: "WT Connect",
    });

    expect(result).toEqual({ ok: false, status: "failed" });
    expect(calls).toHaveLength(0);
    const rows = await t.run(async (ctx) => ({
      session: await ctx.db.get(sessionId),
      accounts: await ctx.db.query("whatsappAccounts").collect(),
    }));
    expect(rows.session?.error).toContain("DPA_REQUIRED");
    expect(rows.accounts).toHaveLength(0);
  });

  it("creates a hashed client launcher and starts a tenant-scoped signup session", async () => {
    const t = convexTest(schema);
    const seeded = await seedSignupSession(t);
    process.env.META_EMBEDDED_SIGNUP_APP_ID = "APP_1";
    process.env.META_EMBEDDED_SIGNUP_APP_SECRET = "APP_SECRET";
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "CONFIG_1";
    process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI =
      "https://cxcast.example/embedded-signup/callback";

    const owner = t.withIdentity({ subject: seeded.userId });
    const link = await owner.mutation(api.embeddedSignup.createLaunchLink, {
      label: "Client connect",
      expiresInHours: 24,
    });

    expect(link.token).toHaveLength(64);
    expect(link.path).toBe(`/connect/whatsapp/${link.token}`);

    const stored = await t.run(async (ctx) => {
      return await ctx.db.get(link.launcherId);
    });
    expect(stored?.tokenHash).not.toBe(link.token);
    expect(stored?.starts).toBe(0);

    const begin = await t.mutation(api.embeddedSignup.beginFromLaunchToken, {
      token: link.token,
    });

    expect(begin).toMatchObject({
      configured: true,
      appId: "APP_1",
      configId: "CONFIG_1",
      tenantName: "Coex Clinic",
    });
    expect(begin.url).toContain("https://www.facebook.com/");
    expect(begin.url).toContain(`state=${begin.state}`);
    expect(begin.url).not.toContain(link.token);

    const rows = await t.run(async (ctx) => ({
      launcher: await ctx.db.get(link.launcherId),
      session: await ctx.db.get(begin.sessionId),
    }));
    expect(rows.launcher?.starts).toBe(1);
    expect(rows.launcher?.lastSessionId).toBe(begin.sessionId);
    expect(rows.session).toMatchObject({
      tenantId: seeded.tenantId,
      createdBy: seeded.memberId,
      launchTokenId: link.launcherId,
      state: begin.state,
      status: "created",
    });
  });

  it("blocks launcher signup before session creation when compliance is missing", async () => {
    const t = convexTest(schema);
    const seeded = await seedSignupSession(t, { signedCompliance: false });
    const owner = t.withIdentity({ subject: seeded.userId });
    const link = await owner.mutation(api.embeddedSignup.createLaunchLink, {
      label: "Blocked client connect",
    });
    const before = await t.run(async (ctx) => {
      return await ctx.db.query("embeddedSignupSessions").collect();
    });

    await expect(
      t.mutation(api.embeddedSignup.beginFromLaunchToken, {
        token: link.token,
      }),
    ).rejects.toThrow(/DPA_REQUIRED/);

    const after = await t.run(async (ctx) => {
      return await ctx.db.query("embeddedSignupSessions").collect();
    });
    expect(after).toHaveLength(before.length);
  });
});
