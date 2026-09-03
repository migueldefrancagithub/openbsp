import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { MAX_STALE_RELEASES } from "../lib/followUpEngine";

async function tenantWithContact(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name });
    const tenantId = await ctx.db.insert("tenants", {
      name,
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const contactId = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000077",
      bsuid: "MZ.123456789",
      name: "Paciente",
      tags: [],
      createdAt: Date.now(),
    });
    return { userId, tenantId, memberId, contactId };
  });
}

describe("the contact-request send is fenced", () => {
  it("refuses an anonymous caller", async () => {
    const t = convexTest(schema);
    const a = await tenantWithContact(t, "Clínica A");
    // Before the fix this was a plain `action`: no session at all, and the
    // tenant came from the contactId the caller passed in.
    await expect(
      t.action(api.contactRequest.send, { contactId: a.contactId, bodyText: "Olá" }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it("refuses a signed-in caller pointing at another workspace's contact", async () => {
    const t = convexTest(schema);
    const a = await tenantWithContact(t, "Clínica A");
    const b = await tenantWithContact(t, "Clínica B");
    await expect(
      t.withIdentity({ subject: b.userId }).action(api.contactRequest.send, {
        contactId: a.contactId,
        bodyText: "Olá",
      }),
    ).rejects.toThrow(/CONTACT_NOT_FOUND|FORBIDDEN/);
  });

  it("fences the loader on the session tenant, not on the row", async () => {
    const t = convexTest(schema);
    const a = await tenantWithContact(t, "Clínica A");
    const b = await tenantWithContact(t, "Clínica B");
    expect(
      await t.query(internal.contactRequest._loadContext, { contactId: a.contactId, tenantId: b.tenantId }),
    ).toBeNull();
  });
});

describe("a stale follow-up claim never sends twice", () => {
  async function seedTask(t: ReturnType<typeof convexTest>, attempts: number, staleReleases?: number) {
    return await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        name: "Clínica",
        vertical: "clinic",
        plan: "starter",
        settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
        createdAt: Date.now(),
      });
      const taskId = await ctx.db.insert("followUpTasks", {
        tenantId,
        kind: "rule",
        businessKey: `followup:test:${attempts}:${staleReleases ?? 0}`,
        dueAt: Date.now() - 60_000,
        status: "claimed",
        attempts,
        staleReleases,
        lastAttemptAt: Date.now() - 60 * 60_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as never);
      return { taskId, tenantId };
    });
  }

  it("rolls the attempt back so the retry reuses the same business key", async () => {
    const t = convexTest(schema);
    const { taskId } = await seedTask(t, 1);
    expect(await t.mutation(internal.followUps.sweepStaleClaims, {})).toMatchObject({ released: 1 });
    const task = await t.run(async (ctx) => (await ctx.db.get(taskId)) as Doc<"followUpTasks">);
    // Same attempt number ⇒ same nonce ⇒ the outbox dedupe decides, instead of
    // the patient receiving a second copy.
    expect(task).toMatchObject({ status: "scheduled", attempts: 0, staleReleases: 1 });
  });

  it("gives up instead of looping forever on a permanently stuck task", async () => {
    const t = convexTest(schema);
    const { taskId } = await seedTask(t, 1, MAX_STALE_RELEASES);
    await t.mutation(internal.followUps.sweepStaleClaims, {});
    const task = await t.run(async (ctx) => (await ctx.db.get(taskId)) as Doc<"followUpTasks">);
    expect(task).toMatchObject({ status: "failed", failureCode: "STALE_CLAIM" });
  });
});
