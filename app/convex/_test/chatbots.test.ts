import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

async function seedTenant(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Bot Owner" });
  });
  await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "CXCast Studio",
      vertical: "services",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
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

describe("chatbot studio", () => {
  it("creates folders and bots inside the active tenant", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t);
    const chatbotsApi = (api as any).chatbots;

    const folderId = await owner.mutation(chatbotsApi.createFolder, {
      name: "Campanhas",
    });
    const botId = await owner.mutation(chatbotsApi.createBot, {
      name: "CTWA qualifier",
      description: "Qualifies ad leads and pauses for human takeover.",
      folderId,
      triggerKind: "ctwa",
      model: "CXCast guardrail bot",
    });

    let studio = await owner.query(chatbotsApi.list, {});
    expect(studio.folders[0]).toMatchObject({
      name: "Campanhas",
      botCount: 1,
    });
    expect(studio.bots[0]).toMatchObject({
      _id: botId,
      name: "CTWA qualifier",
      status: "draft",
      triggerKind: "ctwa",
      folderName: "Campanhas",
    });
    expect(studio.stats).toMatchObject({ total: 1, draft: 1, active: 0 });

    await owner.mutation(chatbotsApi.updateStatus, {
      chatbotId: botId,
      status: "active",
    });

    studio = await owner.query(chatbotsApi.list, {});
    expect(studio.bots[0].status).toBe("active");
    expect(studio.stats).toMatchObject({ total: 1, draft: 0, active: 1 });
  });
});
