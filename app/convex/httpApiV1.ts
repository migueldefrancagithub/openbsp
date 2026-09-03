import { ConvexError, v } from "convex/values";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { HttpRouter } from "convex/server";
import { deriveCampaignRates, readCampaignStats } from "./lib/campaignStats";
import { reserveSlotInternal } from "./lib/clinicAgenda";
import { localTimeToTimestamp, addDays, parseDate } from "./lib/clinicTime";
import { tenantTimeZone } from "./lib/clinicAgenda";

/**
 * Channel-neutral REST v1. `registerApiV1Routes(http)` is exported but NOT
 * called from `http.ts` (guarded file): the owner adds that single line.
 * The router itself is pure so it can be unit-tested without HTTP.
 */
export type ApiCaller = { apiKeyId: Id<"apiKeys">; tenantId: Id<"tenants">; role: string };

export type ApiDeps = {
  authenticate: (request: Request) => Promise<ApiCaller | null>;
  runQuery: <T>(ref: unknown, args: unknown) => Promise<T>;
  runMutation: <T>(ref: unknown, args: unknown) => Promise<T>;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string } | undefined;
    const code = data?.code ?? "ERROR";
    const status = code === "FORBIDDEN_CAPABILITY" || code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" || code === "THREAD_NOT_FOUND" ? 404 : code === "APPOINTMENT_SLOT_UNAVAILABLE" ? 409 : 400;
    return json({ error: code }, status);
  }
  return json({ error: "INTERNAL" }, 500);
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const WRITE_ROLES = new Set(["owner", "admin", "agent"]);

export async function routeApiV1(request: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.startsWith("/api/v1/")) return json({ error: "NOT_FOUND" }, 404);
  const caller = await deps.authenticate(request);
  if (!caller) return json({ error: "API_KEY_INVALID" }, 401);
  const segments = path.slice("/api/v1/".length).split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  try {
    if (segments[0] === "threads") {
      if (segments.length === 1 && method === "GET") {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
        const result = await deps.runQuery<{ page: unknown[]; isDone: boolean; continueCursor: string }>(internal.httpApiV1._listThreads, {
          tenantId: caller.tenantId,
          cursor: url.searchParams.get("cursor") ?? undefined,
          limit,
        });
        return json({ data: result.page, next_cursor: result.isDone ? null : result.continueCursor });
      }
      if (segments.length === 2 && method === "GET") {
        const row = await deps.runQuery<unknown | null>(internal.httpApiV1._getThread, { tenantId: caller.tenantId, threadKey: decodeURIComponent(segments[1]) });
        return row ? json({ data: row }) : json({ error: "NOT_FOUND" }, 404);
      }
      if (segments.length === 3 && segments[2] === "tags" && method === "POST") {
        if (!WRITE_ROLES.has(caller.role)) return json({ error: "FORBIDDEN" }, 403);
        const body = await parseBody(request);
        const tag = typeof body?.tag === "string" ? body.tag.trim().toLowerCase().slice(0, 40) : "";
        if (!tag) return json({ error: "INVALID_TEXT" }, 400);
        const result = await deps.runMutation<{ tags: string[] }>(internal.httpApiV1._addTag, { tenantId: caller.tenantId, threadKey: decodeURIComponent(segments[1]), tag });
        return json({ data: result });
      }
    }
    if (segments[0] === "appointments") {
      if (segments.length === 1 && method === "GET") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to") ?? from;
        if (!from || !to) return json({ error: "INVALID_RANGE" }, 400);
        const rows = await deps.runQuery<unknown[]>(internal.httpApiV1._listAppointments, { tenantId: caller.tenantId, from, to });
        return json({ data: rows });
      }
      if (segments.length === 1 && method === "POST") {
        if (!WRITE_ROLES.has(caller.role)) return json({ error: "FORBIDDEN" }, 403);
        const body = await parseBody(request);
        if (!body || typeof body.serviceId !== "string" || typeof body.startAt !== "number" || typeof body.businessKey !== "string") {
          return json({ error: "INVALID_REQUEST" }, 400);
        }
        const result = await deps.runMutation<{ appointmentId: string; created: boolean }>(internal.httpApiV1._createAppointment, {
          tenantId: caller.tenantId,
          apiKeyId: caller.apiKeyId,
          serviceId: body.serviceId,
          startAt: body.startAt,
          threadKey: typeof body.threadKey === "string" ? body.threadKey : undefined,
          patientName: typeof body.patientName === "string" ? body.patientName : undefined,
          businessKey: body.businessKey,
        });
        return json({ data: result }, result.created ? 201 : 200);
      }
    }
    if (segments[0] === "campaigns" && segments.length === 3 && segments[2] === "stats" && method === "GET") {
      const stats = await deps.runQuery<unknown | null>(internal.httpApiV1._campaignStats, { tenantId: caller.tenantId, campaignId: segments[1] });
      return stats ? json({ data: stats }) : json({ error: "NOT_FOUND" }, 404);
    }
    return json({ error: "NOT_FOUND" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

export const _listThreads = internalQuery({
  args: { tenantId: v.id("tenants"), cursor: v.optional(v.string()), limit: v.number() },
  returns: v.object({ page: v.array(v.any()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("channelThreads")
      .withIndex("by_tenant_last_event", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });
    const page = [];
    for (const thread of result.page) {
      const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
      page.push({
        id: thread._id,
        channel_id: thread.channelId,
        thread_key: thread.threadKey,
        display_name: identity?.displayName,
        lead_status: thread.leadStatus ?? "new",
        intent: thread.intent,
        tags: thread.tags ?? [],
        responsible_member_id: thread.responsibleMemberId,
        last_event_at: thread.lastEventAt,
        last_preview: thread.lastPreview,
        automation_mode: thread.automationMode,
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

async function findThread(ctx: { db: any }, tenantId: Id<"tenants">, threadKey: string): Promise<Doc<"channelThreads"> | null> {
  const channels = (await ctx.db
    .query("channels")
    .withIndex("by_tenant", (q: any) => q.eq("tenantId", tenantId))
    .take(20)) as Doc<"channels">[];
  for (const channel of channels) {
    const thread = (await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_thread", (q: any) => q.eq("channelId", channel._id).eq("threadKey", threadKey))
      .unique()) as Doc<"channelThreads"> | null;
    if (thread && thread.tenantId === tenantId) return thread;
  }
  return null;
}

export const _getThread = internalQuery({
  args: { tenantId: v.id("tenants"), threadKey: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const thread = await findThread(ctx, args.tenantId, args.threadKey);
    if (!thread) return null;
    const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
    return { id: thread._id, channel_id: thread.channelId, thread_key: thread.threadKey, display_name: identity?.displayName, lead_status: thread.leadStatus ?? "new", intent: thread.intent, tags: thread.tags ?? [], responsible_member_id: thread.responsibleMemberId, last_event_at: thread.lastEventAt, last_preview: thread.lastPreview, automation_mode: thread.automationMode, next_step: thread.nextStep };
  },
});

export const _addTag = internalMutation({
  args: { tenantId: v.id("tenants"), threadKey: v.string(), tag: v.string() },
  returns: v.object({ tags: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const thread = await findThread(ctx, args.tenantId, args.threadKey);
    if (!thread) throw new ConvexError({ code: "THREAD_NOT_FOUND" });
    const tags = Array.from(new Set([...(thread.tags ?? []), args.tag])).slice(0, 30);
    await ctx.db.patch(thread._id, { tags, updatedAt: Date.now() });
    return { tags };
  },
});

export const _listAppointments = internalQuery({
  args: { tenantId: v.id("tenants"), from: v.string(), to: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    parseDate(args.from);
    parseDate(args.to);
    const timeZone = await tenantTimeZone(ctx, args.tenantId);
    const start = localTimeToTimestamp(args.from, "00:00", timeZone);
    const end = localTimeToTimestamp(addDays(args.to, 1), "00:00", timeZone);
    if (end <= start || end - start > 31 * 24 * 60 * 60_000) throw new ConvexError({ code: "INVALID_RANGE" });
    const rows = await ctx.db
      .query("clinicAppointments")
      .withIndex("by_tenant_start", (q) => q.eq("tenantId", args.tenantId).gte("startAt", start).lt("startAt", end))
      .take(500);
    const out = [];
    for (const row of rows) {
      const service = await ctx.db.get(row.serviceId);
      out.push({ id: row._id, service_id: row.serviceId, service_name: service?.name, professional_id: row.professionalId, thread_id: row.threadId, patient_name: row.patientName, start_at: row.startAt, end_at: row.endAt, status: row.status, source: row.source });
    }
    return out;
  },
});

export const _createAppointment = internalMutation({
  args: { tenantId: v.id("tenants"), apiKeyId: v.id("apiKeys"), serviceId: v.string(), startAt: v.number(), threadKey: v.optional(v.string()), patientName: v.optional(v.string()), businessKey: v.string() },
  returns: v.object({ appointmentId: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.apiKeyId);
    if (!apiKey || apiKey.tenantId !== args.tenantId || apiKey.revokedAt) throw new ConvexError({ code: "API_KEY_INVALID" });
    const service = await ctx.db.get(args.serviceId as Id<"clinicServices">);
    if (!service || service.tenantId !== args.tenantId) throw new ConvexError({ code: "NOT_FOUND" });
    const thread = args.threadKey ? await findThread(ctx, args.tenantId, args.threadKey) : null;
    const result = await reserveSlotInternal(
      { db: ctx.db, tenantId: args.tenantId, memberId: apiKey.createdBy, role: apiKey.role },
      { serviceId: service._id, threadId: thread?._id, patientName: args.patientName, startAt: args.startAt, businessKey: `api:${args.businessKey.slice(0, 120)}`, source: "operation" },
    );
    return { appointmentId: result.appointmentId, created: result.created };
  },
});

export const _campaignStats = internalQuery({
  args: { tenantId: v.id("tenants"), campaignId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId as Id<"campaigns">);
    if (!campaign || campaign.tenantId !== args.tenantId) return null;
    return { id: campaign._id, name: campaign.name, status: campaign.status ?? "draft", kind: campaign.kind, rates: deriveCampaignRates(readCampaignStats(campaign.stats)) };
  },
});

/** Bearer API key → caller (touches lastUsedAt). */
export async function authenticateApiRequest(ctx: { runAction: any; runMutation: any }, request: Request): Promise<ApiCaller | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const caller = (await ctx.runAction(internal.apiKeys.resolveToken, { plaintextToken: token })) as ApiCaller | null;
  if (caller) await ctx.runMutation(internal.apiKeys._touchLastUsed, { apiKeyId: caller.apiKeyId });
  return caller;
}

export const handleApiV1 = httpAction(async (ctx, request) => {
  return await routeApiV1(request, {
    authenticate: (req) => authenticateApiRequest(ctx, req),
    runQuery: (ref, args) => ctx.runQuery(ref as never, args as never) as Promise<never>,
    runMutation: (ref, args) => ctx.runMutation(ref as never, args as never) as Promise<never>,
  });
});

/**
 * Owner-only step (http.ts is a guarded file): `registerApiV1Routes(http)`.
 * Registers the neutral routes under /api/v1/threads, /appointments and
 * /campaigns without touching the existing contacts/templates routes.
 */
export function registerApiV1Routes(http: HttpRouter) {
  for (const method of ["GET", "POST"] as const) {
    http.route({ pathPrefix: "/api/v1/threads/", method, handler: handleApiV1 });
    http.route({ pathPrefix: "/api/v1/appointments", method, handler: handleApiV1 });
    http.route({ pathPrefix: "/api/v1/campaigns/", method, handler: handleApiV1 });
  }
  http.route({ path: "/api/v1/threads", method: "GET", handler: handleApiV1 });
}
