import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

afterEach(() => {
  delete process.env.PLATFORM_META_APP_SECRET;
  vi.unstubAllGlobals();
});

async function seedEvidenceWorkspace(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Evidence Owner" });
  });
  const seeded = await t.run(async (ctx) => {
    const now = Date.now();
    const tenantId = await ctx.db.insert("tenants", {
      name: "Evidence Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: now,
    });
    await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
    });
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: now,
    });
    const whatsappAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "APP_EVIDENCE",
      wabaId: "WABA_EVIDENCE",
      accessToken: "EAA_TEST_SECRET_TOKEN_1234567890",
      status: "active",
      tokenStatus: "ok",
      createdAt: now,
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "PHONE_EVIDENCE",
      e164: "+258840000000",
      displayName: "Evidence Clinic",
      createdAt: now,
    });
    return { tenantId, whatsappAccountId, phoneNumberId };
  });
  return {
    ...seeded,
    userId,
    owner: t.withIdentity({ subject: userId }),
  };
}

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "x-fb-trace-id": "TRACE_EVIDENCE",
      "x-fb-request-id": "REQ_EVIDENCE",
    },
  });
}

describe("Meta evidence runner", () => {
  it("runs read-only WhatsApp evidence checks and redacts secrets", async () => {
    const t = convexTest(schema);
    const { owner, whatsappAccountId, phoneNumberId } =
      await seedEvidenceWorkspace(t);
    process.env.PLATFORM_META_APP_SECRET = "APP_SECRET_EVIDENCE";
    const calls: Array<{ url: string; method: string }> = [];

    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        calls.push({ url, method });
        if (url.includes("/debug_token")) {
          return response({
            data: {
              app_id: "APP_EVIDENCE",
              is_valid: true,
              scopes: ["whatsapp_business_management"],
              granular_scopes: [
                {
                  scope: "whatsapp_business_management",
                  target_ids: ["WABA_EVIDENCE"],
                },
              ],
            },
          });
        }
        if (url.includes("/me/permissions")) {
          return response({
            data: [
              {
                permission: "whatsapp_business_management",
                status: "granted",
              },
            ],
          });
        }
        if (url.includes("/WABA_EVIDENCE/phone_numbers")) {
          return response({
            data: [
              {
                id: "PHONE_EVIDENCE",
                display_phone_number: "+258 84 000 0000",
                verified_name: "Evidence Clinic",
                quality_rating: "GREEN",
              },
            ],
          });
        }
        if (url.includes("/WABA_EVIDENCE/message_templates")) {
          return response({
            data: [{ id: "TPL_1", name: "hello_world", status: "APPROVED" }],
          });
        }
        if (url.includes("/PHONE_EVIDENCE/whatsapp_business_profile")) {
          return response({ data: [{ vertical: "HEALTH" }] });
        }
        if (url.includes("/WABA_EVIDENCE/subscribed_apps")) {
          return response({ data: [{ id: "APP_EVIDENCE" }] });
        }
        return response({ id: "ok", name: "Evidence" });
      },
    );

    const result = await owner.action((api as any).metaEvidence.runWhatsAppEvidence, {
      whatsappAccountId,
      phoneNumberId,
    });

    expect(result.summary.writesEnabled).toBe(false);
    expect(result.summary.skipped).toBe(2);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.some((call) => call.url.includes("/debug_token"))).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("EAA_TEST_SECRET_TOKEN_1234567890");
    expect(serialized).not.toContain("APP_SECRET_EVIDENCE");
    expect(result.doc).toContain("OPENBSP META APP REVIEW EVIDENCE");
    expect(result.doc).toContain("TRACE_EVIDENCE");
    expect(result.records.some((record: { skipped?: boolean }) => record.skipped)).toBe(
      true,
    );
  });

  it("rejects channels outside the active tenant", async () => {
    const t = convexTest(schema);
    const { owner } = await seedEvidenceWorkspace(t);
    const foreignAccountId = await t.run(async (ctx) => {
      const now = Date.now();
      const tenantId = await ctx.db.insert("tenants", {
        name: "Other Clinic",
        vertical: "clinic",
        plan: "growth",
        settings: {
          defaultLocale: "pt-PT",
          timezone: "Africa/Maputo",
          retentionDays: 730,
        },
        createdAt: now,
      });
      return await ctx.db.insert("whatsappAccounts", {
        tenantId,
        metaAppId: "APP_OTHER",
        wabaId: "WABA_OTHER",
        accessToken: "foreign-token",
        status: "active",
        tokenStatus: "ok",
        createdAt: now,
      });
    });

    await expect(
      owner.action((api as any).metaEvidence.runWhatsAppEvidence, {
        whatsappAccountId: foreignAccountId as Id<"whatsappAccounts">,
      }),
    ).rejects.toThrow(/NOT_FOUND|WhatsApp channel/);
  });
});
