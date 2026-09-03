import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import { appendAuditInTx, canonicalJson, hashAuditRow, writeAudit } from "../lib/audit";
import schema from "../schema";

async function seedOwner(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Audit",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    return { userId, tenantId, memberId };
  });
}

describe("hash-chained audit log", () => {
  it("canonicalizes JSON deterministically", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
  });

  it("links every row to the previous one and detects tampering", async () => {
    const t = convexTest(schema);
    const owner = await seedOwner(t);
    await t.run(async (ctx) => {
      const scoped = { db: ctx.db, tenantId: owner.tenantId, memberId: owner.memberId, role: "owner" };
      for (let index = 0; index < 5; index += 1) {
        await writeAudit(scoped, {
          action: `test.action.${index}`,
          targetType: "thing",
          targetId: `thing-${index}`,
          payload: { index },
          now: 1_700_000_000_000 + index,
        });
      }
    });
    const asOwner = t.withIdentity({ subject: owner.userId });
    const rows = await t.run(async (ctx) =>
      await ctx.db
        .query("auditLog")
        .withIndex("by_tenant_created", (q) => q.eq("tenantId", owner.tenantId))
        .collect(),
    );
    expect(rows).toHaveLength(5);
    expect(rows[0].prevHash).toBe("genesis");
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index].prevHash).toBe(rows[index - 1].selfHash);
    }
    const { _id, _creationTime, selfHash, ...content } = rows[2];
    void _id;
    void _creationTime;
    expect(await hashAuditRow(content as never)).toBe(selfHash);

    const intact = await asOwner.query(api.audit.verifyChain, {});
    expect(intact).toMatchObject({ checked: 5, ok: true });
    const events = await t.run(async (ctx) => await ctx.db.query("clinicAuditEvents").collect());
    expect(events).toHaveLength(5);

    // Tamper with a row: the chain breaks at that row.
    await t.run(async (ctx) => {
      await ctx.db.patch(rows[2]._id, { action: "test.action.rewritten" });
    });
    const tampered = await asOwner.query(api.audit.verifyChain, {});
    expect(tampered.ok).toBe(false);
    expect(tampered.firstBrokenId).toBe(rows[2]._id);

    // Deleting a row breaks the link of the next one.
    await t.run(async (ctx) => {
      await ctx.db.patch(rows[2]._id, { action: "test.action.2" });
      await ctx.db.delete(rows[3]._id);
    });
    const deleted = await asOwner.query(api.audit.verifyChain, {});
    expect(deleted.ok).toBe(false);
    expect(deleted.firstBrokenId).toBe(rows[4]._id);
  });

  it("only lets audit.export roles read the chain", async () => {
    const t = convexTest(schema);
    const owner = await seedOwner(t);
    const agent = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "agent" });
      await ctx.db.insert("members", { tenantId: owner.tenantId, userId, role: "agent", status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: owner.tenantId, updatedAt: Date.now() });
      return { userId };
    });
    await t.run(async (ctx) => {
      await appendAuditInTx(ctx, {
        tenantId: owner.tenantId,
        actorType: "system",
        actorId: "cron",
        action: "sweep.ran",
      });
    });
    await expect(
      t.withIdentity({ subject: agent.userId }).query(api.audit.listPaginated, {
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    const page = await t.withIdentity({ subject: owner.userId }).query(api.audit.listPaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page[0]).toMatchObject({ action: "sweep.ran", actorType: "system" });
  });
});
