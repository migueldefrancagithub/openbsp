import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mergeCustomFieldValues, slugifyFieldKey } from "../customFields";
import schema from "../schema";

async function seedTenant(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${name} owner` });
    const tenantId = await ctx.db.insert("tenants", {
      name,
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const channelId = await ctx.db.insert("channels", {
      tenantId,
      publicId: `hub_${name.padEnd(24, "x").slice(0, 24)}`,
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: `channel-${name}`,
      displayName: name,
      status: "active",
      sendMode: "allowlist",
      outboundAllowlist: [],
      connectionState: "allowlist_only",
      webhookStatus: "verified",
      createdBy: memberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const threadId = await ctx.db.insert("channelThreads", {
      tenantId,
      channelId,
      threadKey: "258841000000",
      lastEventAt: Date.now(),
      lastEventKind: "message.text",
      unreadCount: 0,
      leadStatus: "new",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { userId, tenantId, memberId, channelId, threadId };
  });
}

async function addMember(t: ReturnType<typeof convexTest>, tenantId: Id<"tenants">, role: "agent" | "marketing") {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: role });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role, status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    return { userId, memberId };
  });
}

describe("custom fields", () => {
  it("slugifies keys and merges values by type", () => {
    expect(slugifyFieldKey("Médico de família")).toBe("medico_de_familia");
    const definitions = [
      { key: "seguro", type: "select", options: ["A", "B"] },
      { key: "idade", type: "number" },
      { key: "vip", type: "boolean" },
      { key: "nasc", type: "date" },
    ] as never;
    const merged = mergeCustomFieldValues(definitions, { idade: 30 }, { seguro: "A", vip: "true", nasc: "1990-01-02" });
    expect(merged).toEqual({ idade: 30, seguro: "A", vip: true, nasc: "1990-01-02" });
    expect(mergeCustomFieldValues(definitions, merged, { idade: "" })).not.toHaveProperty("idade");
    expect(() => mergeCustomFieldValues(definitions, {}, { seguro: "C" })).toThrow(/CUSTOM_FIELD_INVALID/);
    expect(() => mergeCustomFieldValues(definitions, {}, { outro: "x" })).toThrow(/CUSTOM_FIELD_UNKNOWN/);
  });

  it("lets admins define fields and agents fill them on threads", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "fields-a");
    const agent = await addMember(t, owner.tenantId, "agent");
    const marketing = await addMember(t, owner.tenantId, "marketing");
    const asOwner = t.withIdentity({ subject: owner.userId });
    const asAgent = t.withIdentity({ subject: agent.userId });

    await expect(
      asAgent.mutation(api.customFields.saveDefinition, { label: "Seguro", type: "text" }),
    ).rejects.toThrow(/FORBIDDEN/);
    const insurerId = await asOwner.mutation(api.customFields.saveDefinition, {
      label: "Seguro de saúde",
      type: "select",
      options: ["Nenhum", "Medis", "Multicare"],
    });
    await asOwner.mutation(api.customFields.saveDefinition, { label: "Nº utente", type: "text" });
    await expect(
      asOwner.mutation(api.customFields.saveDefinition, { label: "Seguro de saúde", type: "text" }),
    ).rejects.toThrow(/CUSTOM_FIELD_EXISTS/);
    const definitions = await asOwner.query(api.customFields.listDefinitions, {});
    expect(definitions.map((row) => row.key)).toEqual(["seguro_de_saude", "n_utente"]);

    await asAgent.mutation(api.inboxOperations.updateThread, {
      threadId: owner.threadId,
      customFields: { seguro_de_saude: "Medis", n_utente: "12345" },
    });
    await expect(
      asAgent.mutation(api.inboxOperations.updateThread, {
        threadId: owner.threadId,
        customFields: { seguro_de_saude: "Outro" },
      }),
    ).rejects.toThrow(/CUSTOM_FIELD_INVALID/);
    await expect(
      t.withIdentity({ subject: marketing.userId }).mutation(api.inboxOperations.updateThread, {
        threadId: owner.threadId,
        customFields: { n_utente: "x" },
      }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);

    const summary = await asOwner.query(api.channels.getThread, {
      channelId: owner.channelId,
      threadKey: "258841000000",
    });
    expect(summary?.customFields).toEqual({ seguro_de_saude: "Medis", n_utente: "12345" });

    await asOwner.mutation(api.customFields.archiveDefinition, { definitionId: insurerId });
    const active = await asOwner.query(api.customFields.listDefinitions, {});
    expect(active.map((row) => row.key)).toEqual(["n_utente"]);
    await expect(
      asAgent.mutation(api.inboxOperations.updateThread, {
        threadId: owner.threadId,
        customFields: { seguro_de_saude: "Medis" },
      }),
    ).rejects.toThrow(/CUSTOM_FIELD_UNKNOWN/);
  });
});
