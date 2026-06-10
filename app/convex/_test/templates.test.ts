import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedTemplateWorkspace(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Template Owner" });
  });
  const seeded = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Template Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
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
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: Date.now(),
    });
    const whatsappAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "APP_1",
      wabaId: "WABA_1",
      accessToken: "waba-token",
      status: "active",
      tokenStatus: "ok",
      createdAt: Date.now(),
    });
    return { tenantId, memberId, whatsappAccountId };
  });
  return {
    ...seeded,
    userId,
    owner: t.withIdentity({ subject: userId }),
  };
}

describe("template create and submit", () => {
  it("creates a local template and submits it to Meta in one action", async () => {
    const t = convexTest(schema);
    const { owner, whatsappAccountId } = await seedTemplateWorkspace(t);
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();
        calls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.includes("/WABA_1/message_templates")) {
          return Response.json({ id: "META_TPL_1", status: "PENDING" });
        }
        return Response.json(
          { error: { message: `unexpected URL ${url}` } },
          { status: 500 },
        );
      },
    );

    const result = await owner.action((api as any).templates.createAndSubmitForApproval, {
      whatsappAccountId,
      name: "appointment_followup",
      language: "pt_PT",
      category: "utility",
      bodyText: "Ola {{1}}, confirma a consulta de {{2}}?",
      buttons: [
        { type: "quick_reply", text: "Confirmar" },
        { type: "url", text: "Detalhes", url: "https://clinic.example/consulta" },
      ],
      parameterSchema: [
        { index: 1, name: "first_name", example: "Maria" },
        { index: 2, name: "service", example: "limpeza facial" },
      ],
    });

    expect(result).toMatchObject({
      submissionState: "submitted",
      metaTemplateId: "META_TPL_1",
      metaStatus: "pending",
    });
    expect(calls[0].url).toContain("/WABA_1/message_templates");
    expect(calls[0].body).toMatchObject({
      name: "appointment_followup",
      language: "pt_PT",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Ola {{1}}, confirma a consulta de {{2}}?",
          example: { body_text: [["Maria", "limpeza facial"]] },
        },
        {
          type: "BUTTONS",
          buttons: [
            { type: "QUICK_REPLY", text: "Confirmar" },
            {
              type: "URL",
              text: "Detalhes",
              url: "https://clinic.example/consulta",
            },
          ],
        },
      ],
    });

    const rows = await t.run(async (ctx) => ({
      template: await ctx.db.get(result.templateId),
      versions: await ctx.db.query("templateVersions").collect(),
    }));
    expect(rows.template).toMatchObject({
      status: "pending",
      metaTemplateId: "META_TPL_1",
    });
    expect(rows.versions[0]).toMatchObject({
      isLocked: true,
      submittedAt: expect.any(Number),
      buttons: [
        { type: "quick_reply", text: "Confirmar" },
        { type: "url", text: "Detalhes", url: "https://clinic.example/consulta" },
      ],
    });
  });

  it("keeps the draft when Meta submission fails after local validation", async () => {
    const t = convexTest(schema);
    const { owner, whatsappAccountId } = await seedTemplateWorkspace(t);
    vi.stubGlobal("fetch", async () => {
      return Response.json(
        { error: { message: "Template body violates policy", code: 132000 } },
        { status: 400 },
      );
    });

    const result = await owner.action((api as any).templates.createAndSubmitForApproval, {
      whatsappAccountId,
      name: "policy_review_needed",
      language: "pt_PT",
      category: "marketing",
      bodyText: "Ola {{1}}, temos uma campanha nova.",
      parameterSchema: [{ index: 1, name: "first_name", example: "Maria" }],
    });

    expect(result).toMatchObject({
      submissionState: "draft_saved",
      submissionError: "Template body violates policy",
    });
    const template = await t.run(async (ctx) =>
      ctx.db.get(result.templateId as Id<"templates">),
    );
    expect(template?.status).toBe("draft");
    expect(template?.metaTemplateId).toBeUndefined();
  });
});
