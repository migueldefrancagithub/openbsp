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
      nodeCount: 7,
    });
    expect(studio.bots[0].flowValidationIssues).toEqual([]);
    expect(studio.stats).toMatchObject({ total: 1, draft: 1, active: 0 });
    expect(
      JSON.stringify(studio.bots[0].flowNodes).toLowerCase(),
    ).not.toContain("budget");
    expect(JSON.stringify(studio.bots[0].flowNodes)).not.toContain("MT");

    await owner.mutation(chatbotsApi.updateStatus, {
      chatbotId: botId,
      status: "active",
    });

    studio = await owner.query(chatbotsApi.list, {});
    expect(studio.bots[0].status).toBe("active");
    expect(studio.stats).toMatchObject({ total: 1, draft: 0, active: 1 });
  });

  it("blocks activation when the flow builder has invalid edges", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t);
    const chatbotsApi = (api as any).chatbots;

    const botId = await owner.mutation(chatbotsApi.createBot, {
      name: "Broken flow",
      triggerKind: "keyword",
      triggerKeywords: ["menu"],
      templateSlug: "welcome_menu",
    });

    const issues = await owner.mutation(chatbotsApi.updateFlow, {
      chatbotId: botId,
      triggerKind: "keyword",
      triggerKeywords: ["menu"],
      entryNodeKey: "start",
      nodes: [
        {
          key: "start",
          type: "start",
          title: "Start",
          nextKey: "missing",
        },
      ],
    });

    expect(issues.some((issue: { severity: string }) => issue.severity === "error")).toBe(true);
    await expect(
      owner.mutation(chatbotsApi.updateStatus, {
        chatbotId: botId,
        status: "active",
      }),
    ).rejects.toThrow(/FLOW_INVALID|Fix the flow builder issues/);
  });

  it("persists canvas node positions while old nodes remain valid", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t);
    const chatbotsApi = (api as any).chatbots;

    const botId = await owner.mutation(chatbotsApi.createBot, {
      name: "Canvas flow",
      triggerKind: "inbound",
      templateSlug: "faq_handoff",
    });

    const issues = await owner.mutation(chatbotsApi.updateFlow, {
      chatbotId: botId,
      triggerKind: "inbound",
      entryNodeKey: "start",
      nodes: [
        {
          key: "start",
          type: "start",
          title: "Start",
          nextKey: "hello",
          position: { x: 12.4, y: 22.6 },
        },
        {
          key: "hello",
          type: "send_message",
          title: "Hello",
          body: "Olá! Vamos continuar.",
          nextKey: "end",
          position: { x: 360, y: 24 },
        },
        {
          key: "end",
          type: "end",
          title: "End",
        },
      ],
    });

    expect(issues).toEqual([]);
    const studio = await owner.query(chatbotsApi.list, {});
    const bot = studio.bots.find((item: { _id: string }) => item._id === botId);
    expect(bot?.flowNodes[0].position).toEqual({ x: 12, y: 23 });
    expect(bot?.flowNodes[2].position).toBeUndefined();
  });
});
