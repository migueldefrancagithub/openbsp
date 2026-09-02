import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import { normalizeQuickReplyName } from "../quickReplies";
import schema from "../schema";

async function seedOwner(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Clínica",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    return { userId, tenantId };
  });
}

describe("quick reply names", () => {
  it("normalizes human shortcuts", () => {
    expect(normalizeQuickReplyName("Bom dia!")).toBe("bom_dia");
    expect(normalizeQuickReplyName("/Marcação de consulta")).toBe("marcacao_de_consulta");
    expect(normalizeQuickReplyName("  preço-2024 ")).toBe("preco-2024");
    expect(normalizeQuickReplyName("!!!")).toBe("");
    expect(normalizeQuickReplyName("a".repeat(60))).toHaveLength(40);
  });

  it("stores the normalized name and rejects duplicates and empty names", async () => {
    const t = convexTest(schema);
    const owner = await seedOwner(t);
    const asOwner = t.withIdentity({ subject: owner.userId });
    const id = await asOwner.mutation(api.quickReplies.create, {
      name: "Bom dia!",
      content: "Bom dia! Como podemos ajudar?",
    });
    const rows = await asOwner.query(api.quickReplies.list, {});
    expect(rows.find((row) => row._id === id)?.name).toBe("bom_dia");
    await expect(
      asOwner.mutation(api.quickReplies.create, { name: "bom dia", content: "x" }),
    ).rejects.toThrow(/NAME_TAKEN/);
    await expect(
      asOwner.mutation(api.quickReplies.create, { name: "???", content: "x" }),
    ).rejects.toThrow(/INVALID_NAME/);
  });
});
