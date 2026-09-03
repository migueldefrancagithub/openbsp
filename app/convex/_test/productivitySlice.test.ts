import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Clínica",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const channelId = await ctx.db.insert("channels", {
      tenantId,
      publicId: "hub_prodslicexxxxxxxxxxxxxxxx".slice(0, 28),
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: "c-prod",
      displayName: "Piloto",
      status: "active",
      sendMode: "allowlist",
      outboundAllowlist: ["258840000090"],
      connectionState: "allowlist_only",
      webhookStatus: "verified",
      createdBy: memberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { userId, tenantId, memberId, channelId };
  });
}

describe("clearing the alert list", () => {
  it("clears the noise and leaves the critical ones standing", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const [kind, severity] of [
        ["followup.sent", "info"],
        ["snooze.expired", "warn"],
        ["outbox.stuck", "critical"],
      ] as const) {
        await ctx.db.insert("opsAlerts", {
          tenantId: s.tenantId,
          kind,
          businessKey: `k:${kind}`,
          severity,
          title: kind,
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const asOwner = t.withIdentity({ subject: s.userId });
    expect(await asOwner.mutation(api.ops.acknowledgeAll, {})).toEqual({ acknowledged: 2, remaining: 1 });
    const open = await asOwner.query(api.ops.listAlerts, {});
    // A critical alert must never disappear in a bulk gesture.
    expect(open.map((row) => row.kind)).toEqual(["outbox.stuck"]);
    // And the bulk clear is itself auditable.
    const audits = await t.run(async (ctx) => await ctx.db.query("clinicAuditEvents").collect());
    expect(audits.map((row) => row.action)).toContain("ops.alert.acknowledged_bulk");
  });

  it("clears one severity when asked, including critical, since that is explicit", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("opsAlerts", {
        tenantId: s.tenantId,
        kind: "outbox.stuck",
        businessKey: "k:crit",
        severity: "critical",
        title: "x",
        status: "open",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const asOwner = t.withIdentity({ subject: s.userId });
    expect(await asOwner.mutation(api.ops.acknowledgeAll, { severity: "critical" })).toMatchObject({ acknowledged: 1 });
  });
});

describe("the audit trail filters without losing the chain", () => {
  it("narrows by author and by area, and keeps the newest-first order", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const other = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Colega" });
      return await ctx.db.insert("members", { tenantId: s.tenantId, userId, role: "admin", status: "active", createdAt: Date.now() });
    });
    await t.run(async (ctx) => {
      const rows: Array<[string, Id<"members">, number]> = [
        ["ai.agent.mode_changed", s.memberId, 1],
        ["inbox.thread.updated", other, 2],
        ["ai.proposal.approved", other, 3],
      ];
      let prevHash = "";
      for (const [action, actorId, index] of rows) {
        const selfHash = `hash${index}`;
        await ctx.db.insert("auditLog", {
          tenantId: s.tenantId,
          actorType: "member",
          actorId,
          action,
          targetType: "thread",
          targetId: "t1",
          prevHash,
          selfHash,
          createdAt: Date.now() + index,
        } as never);
        prevHash = selfHash;
      }
    });
    const asOwner = t.withIdentity({ subject: s.userId });
    const page = { numItems: 40, cursor: null };
    const all = await asOwner.query(api.audit.listPaginated, { paginationOpts: page });
    expect(all.page).toHaveLength(3);
    // Newest first, so the chain reads the way it was written.
    expect(all.page[0].action).toBe("ai.proposal.approved");

    const byAuthor = await asOwner.query(api.audit.listPaginated, { paginationOpts: page, actorId: other });
    expect(byAuthor.page.map((row) => row.action)).toEqual(["ai.proposal.approved", "inbox.thread.updated"]);

    const byArea = await asOwner.query(api.audit.listPaginated, { paginationOpts: page, actionPrefix: "ai." });
    expect(byArea.page.map((row) => row.action)).toEqual(["ai.proposal.approved", "ai.agent.mode_changed"]);

    const both = await asOwner.query(api.audit.listPaginated, { paginationOpts: page, actorId: other, actionPrefix: "ai." });
    expect(both.page).toHaveLength(1);
  });
});

describe("the one-click diagnostic", () => {
  it("names the broken link and where to fix it", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const result = await t.withIdentity({ subject: s.userId }).action(api.diagnostics.run, {});
    const byKey = Object.fromEntries(result.checks.map((check) => [check.key, check]));
    expect(byKey.database.status).toBe("ok");
    // Pilot mode is a warning, not a pass: someone has to know that most
    // numbers get no automatic reply.
    expect(byKey.channel.status).toBe("warn");
    expect(byKey.channel.detail).toMatch(/piloto/i);
    // No key configured in the test environment ⇒ the AI checks say so, and the
    // provider test is skipped rather than pretending to have run.
    expect(byKey.ai_key.status).toBe("fail");
    expect(byKey.ai_key.href).toBe("/app/settings?tab=ai");
    expect(byKey.ai_provider.status).toBe("skipped");
    expect(byKey.automation.status).toBe("warn");
    expect(byKey.outbox.status).toBe("ok");
  });

  it("flags a reply that got stuck on the way out", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("channelOutbox", {
        tenantId: s.tenantId,
        channelId: s.channelId,
        businessKey: "hub:text:stuck-diag",
        recipient: "258840000090",
        threadKey: "258840000090",
        messageKind: "text",
        payload: { text: "x" },
        status: "queued",
        dispatchAttempts: 0,
        createdBy: s.memberId,
        createdAt: Date.now() - 30 * 60_000,
        updatedAt: Date.now() - 30 * 60_000,
      });
    });
    const result = await t.withIdentity({ subject: s.userId }).action(api.diagnostics.run, {});
    const outbox = result.checks.find((check) => check.key === "outbox")!;
    expect(outbox.status).toBe("fail");
    expect(outbox.detail).toMatch(/presa/i);
  });
});

describe("the kanban filters by campaign", () => {
  it("counts and lists only the leads that campaign produced", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const campaignId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("campaigns", {
        tenantId: s.tenantId,
        name: "Setembro",
        kind: "channel_template",
        status: "completed",
        channelId: s.channelId,
        createdBy: s.memberId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as never);
      for (const [key, origin] of [["258840000091", id], ["258840000092", undefined]] as const) {
        const identityId = await ctx.db.insert("channelIdentities", {
          tenantId: s.tenantId,
          channelId: s.channelId,
          providerScopedId: key,
          displayName: key,
          phone: key,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const threadId = await ctx.db.insert("channelThreads", {
          tenantId: s.tenantId,
          channelId: s.channelId,
          threadKey: key,
          identityId,
          leadStatus: "interested",
          originCampaignId: origin,
          lastEventAt: Date.now(),
          lastEventKind: "message.text",
          unreadCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        // The kanban only shows conversations that carry a real message.
        await ctx.db.insert("channelEvents", {
          tenantId: s.tenantId,
          channelId: s.channelId,
          eventKey: `evt-${key}`,
          eventKind: "message.text",
          direction: "incoming",
          threadKey: key,
          payload: { text: "olá" },
          rawPayload: "{}",
          rawBodySha256: "x",
          status: "processed",
          attempts: 1,
          receivedAt: Date.now(),
        } as never);
        void threadId;
      }
      return id;
    });
    const asOwner = t.withIdentity({ subject: s.userId });
    const page = { numItems: 20, cursor: null };
    const all = await asOwner.query(api.leads.listByStatus, { leadStatus: "interested", paginationOpts: page });
    expect(all.page).toHaveLength(2);
    const filtered = await asOwner.query(api.leads.listByStatus, {
      leadStatus: "interested",
      originCampaignId: campaignId,
      paginationOpts: page,
    });
    expect(filtered.page.map((row) => row.threadKey)).toEqual(["258840000091"]);
    const counts = await asOwner.query(api.leads.counts, { originCampaignId: campaignId });
    expect(counts.find((row) => row.status === "interested")?.count).toBe(1);
  });
});
