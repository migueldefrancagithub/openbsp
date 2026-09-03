import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { backoffMsForAttempt, isValidWebhookUrl, signWebhookBody } from "../lib/webhooks";
import { bytesToHex } from "../lib/idempotency";

const previous = process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "9".repeat(64);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(() => {
  if (previous === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1; else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous;
});

async function verify(secret: string, header: string, body: string): Promise<boolean> {
  const [t, v1] = header.split(",").map((part) => part.split("=")[1]);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`))));
  return expected === v1;
}

async function seed(t: ReturnType<typeof convexTest>) {
  const base = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Clínica", vertical: "clinic", plan: "starter", settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 }, createdAt: Date.now() });
    const make = async (role: "owner" | "agent") => {
      const userId = await ctx.db.insert("users", { name: role });
      const memberId = await ctx.db.insert("members", { tenantId, userId, role, status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
      return { userId, memberId };
    };
    const owner = await make("owner");
    const agent = await make("agent");
    const now = Date.now();
    const serviceId = await ctx.db.insert("clinicServices", { tenantId, name: "Consulta", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, availability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "00:00", end: "23:59" })), status: "active", createdBy: owner.memberId, createdAt: now, updatedAt: now });
    return { tenantId, owner, agent, serviceId };
  });
  return { ...base, asOwner: t.withIdentity({ subject: base.owner.userId }), asAgent: t.withIdentity({ subject: base.agent.userId }) };
}

describe("outbound webhooks", () => {
  it("validates urls and computes the backoff ladder", async () => {
    expect(isValidWebhookUrl("https://hooks.example.com/x")).toBe(true);
    expect(isValidWebhookUrl("http://hooks.example.com/x")).toBe(false);
    expect(isValidWebhookUrl("https://localhost/x")).toBe(false);
    expect(isValidWebhookUrl("https://192.168.1.4/x")).toBe(false);
    expect(backoffMsForAttempt(1)).toBe(60_000);
    expect(backoffMsForAttempt(8)).toBe(24 * 60 * 60_000);
    expect(backoffMsForAttempt(99)).toBe(24 * 60 * 60_000);
    const header = await signWebhookBody("whsec_test", 1700000000, '{"a":1}');
    expect(header.startsWith("t=1700000000,v1=")).toBe(true);
    expect(await verify("whsec_test", header, '{"a":1}')).toBe(true);
    expect(await verify("whsec_other", header, '{"a":1}')).toBe(false);
  });

  it("creates a webhook (secret shown once), emits signed deliveries on real events, retries, dead-letters and pauses", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await expect(s.asAgent.mutation(api.outboundWebhooks.create, { name: "n8n", url: "https://hooks.example.com/a", events: ["appointment.booked"] })).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    await expect(s.asOwner.mutation(api.outboundWebhooks.create, { name: "n8n", url: "http://hooks.example.com/a", events: ["appointment.booked"] })).rejects.toThrow(/WEBHOOK_URL_INVALID/);
    const created = await s.asOwner.mutation(api.outboundWebhooks.create, { name: "n8n", url: "https://hooks.example.com/a", events: ["appointment.booked", "appointment.cancelled", "bogus"] });
    expect(created.secret.startsWith("whsec_")).toBe(true);
    const listed = await s.asOwner.query(api.outboundWebhooks.list, {});
    expect(listed[0]).toMatchObject({ name: "n8n", events: ["appointment.booked", "appointment.cancelled"], secretLast4: created.secret.slice(-4) });
    expect(JSON.stringify(listed)).not.toContain(created.secret);

    // A real booking emits exactly one delivery (idempotent per event).
    const startAt = Date.now() + 2 * 24 * 60 * 60_000;
    const booking = await s.asOwner.mutation(api.clinic.reserveSlot, { serviceId: s.serviceId, startAt, patientName: "Ana", businessKey: "manual:test:1" });
    await s.asOwner.mutation(api.clinic.reserveSlot, { serviceId: s.serviceId, startAt, patientName: "Ana", businessKey: "manual:test:1" });
    let deliveries = await t.run(async (ctx) => await ctx.db.query("webhookDeliveries").collect());
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ eventType: "appointment.booked", status: "pending", attempts: 0 });
    expect((deliveries[0].payload as { data: { appointmentId: string } }).data.appointmentId).toBe(booking.appointmentId);

    // Deliver: signature verifies against the secret the clinic copied.
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let respondWith = 200;
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: url.toString(), headers: init?.headers as Record<string, string>, body: String(init?.body) });
      return new Response("", { status: respondWith });
    });
    expect(await t.mutation(internal.outboundWebhooks.deliverDue, {})).toEqual({ claimed: 1, released: 0 });
    await t.action(internal.outboundWebhooks.deliverOne, { deliveryId: deliveries[0]._id });
    expect(seen).toHaveLength(1);
    expect(seen[0].headers["x-openbsp-event"]).toBe("appointment.booked");
    expect(await verify(created.secret, seen[0].headers["x-openbsp-signature"], seen[0].body)).toBe(true);
    deliveries = await t.run(async (ctx) => await ctx.db.query("webhookDeliveries").collect());
    expect(deliveries[0]).toMatchObject({ status: "delivered", attempts: 1, lastStatus: 200 });
    expect((await s.asOwner.query(api.outboundWebhooks.list, {}))[0].consecutiveFailures).toBe(0);

    // Failure → retry with backoff; 8 failures → dead; 20 consecutive → paused + alert.
    respondWith = 503;
    await s.asOwner.mutation(api.clinic.cancelAppointment, { appointmentId: booking.appointmentId });
    let cancel = (await t.run(async (ctx) => await ctx.db.query("webhookDeliveries").collect())).find((d) => d.eventType === "appointment.cancelled")!;
    await t.mutation(internal.outboundWebhooks.deliverDue, {});
    await t.action(internal.outboundWebhooks.deliverOne, { deliveryId: cancel._id });
    cancel = (await t.run(async (ctx) => (await ctx.db.get(cancel._id)) as Doc<"webhookDeliveries">));
    expect(cancel).toMatchObject({ status: "pending", attempts: 1, lastStatus: 503 });
    expect(cancel.nextAttemptAt - Date.now()).toBe(60_000);
    for (let i = 0; i < 7; i += 1) {
      await t.run(async (ctx) => { await ctx.db.patch(cancel._id, { nextAttemptAt: Date.now() - 1 }); });
      await t.mutation(internal.outboundWebhooks.deliverDue, {});
      await t.action(internal.outboundWebhooks.deliverOne, { deliveryId: cancel._id });
    }
    cancel = (await t.run(async (ctx) => (await ctx.db.get(cancel._id)) as Doc<"webhookDeliveries">));
    expect(cancel).toMatchObject({ status: "dead", attempts: 8 });
    await t.run(async (ctx) => {
      const hook = (await ctx.db.query("outboundWebhooks").collect())[0];
      await ctx.db.patch(hook._id, { consecutiveFailures: 19 });
      await ctx.db.patch(cancel._id, { status: "pending", attempts: 0, nextAttemptAt: Date.now() - 1 });
    });
    await t.mutation(internal.outboundWebhooks.deliverDue, {});
    await t.action(internal.outboundWebhooks.deliverOne, { deliveryId: cancel._id });
    const hook = (await s.asOwner.query(api.outboundWebhooks.list, {}))[0];
    expect(hook.pausedReason).toBe("consecutive_failures");
    expect((await s.asOwner.query(api.ops.listAlerts, {})).some((a) => a.kind === "webhook.paused")).toBe(true);
    // Reactivate clears the failure streak; rotate returns a new secret once.
    await s.asOwner.mutation(api.outboundWebhooks.update, { webhookId: hook._id, active: true });
    const reactivated = (await s.asOwner.query(api.outboundWebhooks.list, {}))[0];
    expect(reactivated.consecutiveFailures).toBe(0);
    expect(reactivated.pausedAt).toBeUndefined();
    const rotated = await s.asOwner.mutation(api.outboundWebhooks.rotateSecret, { webhookId: hook._id });
    expect(rotated.secret).not.toBe(created.secret);
  });
});
