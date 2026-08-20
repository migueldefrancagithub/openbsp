import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifyMetaHmac } from "./lib/meta/verify";
import { normalizeWebhook as normalizeLeoHubWebhook } from "./integrations/leoHub/webhook";
import { normalizeWebhook as normalizeIaSolutionHubWebhook } from "./integrations/iaSolutionHub/webhook";
import {
  authenticateRequest,
  badRequestJson,
  forbiddenJson,
  jsonOk,
  unauthorizedJson,
} from "./lib/apiAuth";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Meta webhook verification handshake.
 * Meta calls GET with hub.challenge once when subscribing — we echo it back
 * if hub.verify_token matches our PLATFORM_META_VERIFY_TOKEN env var.
 */
http.route({
  path: "/whatsapp-webhook",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = process.env.PLATFORM_META_VERIFY_TOKEN;

    if (mode === "subscribe" && token && expected && token === expected) {
      return new Response(challenge ?? "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response("forbidden", { status: 403 });
  }),
});

/**
 * Meta webhook delivery.
 *  - Reads raw body bytes (HMAC must be computed on raw body)
 *  - Validates X-Hub-Signature-256 against PLATFORM_META_APP_SECRET
 *  - Schedules enqueue mutation to dedup + persist + dispatch processing
 *  - Returns 200 within 5s (Meta requirement) regardless of downstream outcome
 */
http.route({
  path: "/whatsapp-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const appSecret = process.env.PLATFORM_META_APP_SECRET;
    if (!appSecret) {
      // Fail closed — without a secret we cannot trust any payload.
      return new Response("server not configured", { status: 503 });
    }

    const buf = await request.arrayBuffer();
    const rawBodyBytes = new Uint8Array(buf);
    const sigHeader = request.headers.get("x-hub-signature-256");

    const verify = await verifyMetaHmac(rawBodyBytes, sigHeader, appSecret);
    if (!verify.ok) {
      return new Response("invalid signature", { status: 401 });
    }

    const rawPayload = new TextDecoder().decode(rawBodyBytes);

    // Schedule rather than await — keep response fast.
    await ctx.runMutation(internal.webhooks.enqueue, {
      rawPayload,
      rawBodySha256: verify.bodySha256,
    });

    return new Response("ok", { status: 200 });
  }),
});

/**
 * Temporary Hub laboratory webhook. It has a distinct URL, per-connection
 * HMAC secret and neutral event store, so it cannot enter the official Meta
 * webhook pipeline or affect an existing WhatsApp connection.
 */
http.route({
  pathPrefix: "/provider-webhook/leo-hub/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const prefix = "/provider-webhook/leo-hub/";
    const pathname = new URL(request.url).pathname;
    const publicId = pathname.slice(prefix.length);
    if (!/^lab_[A-Za-z0-9_-]{24}$/.test(publicId)) {
      return new Response("not found", { status: 404 });
    }

    const target = (await ctx.runAction(
      internal.leoHubLab.loadWebhookContext,
      { publicId },
    )) as {
      channelId: Id<"channels">;
      status: string;
      webhookSecret: string;
    } | null;
    if (!target) return new Response("not found", { status: 404 });
    if (target.status === "revoked" || target.status === "disconnected") {
      return new Response("channel disconnected", { status: 410 });
    }

    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > 1_000_000) {
      return new Response("payload too large", { status: 413 });
    }
    const rawBodyBytes = new Uint8Array(buffer);
    const signature = request.headers.get("x-hub-signature-256");
    const verification = await verifyMetaHmac(
      rawBodyBytes,
      signature,
      target.webhookSecret,
    );
    if (!verification.ok) {
      return new Response("invalid signature", { status: 401 });
    }

    const rawPayload = new TextDecoder().decode(rawBodyBytes);
    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      return new Response("invalid json", { status: 400 });
    }
    const events = normalizeLeoHubWebhook(
      payload,
      verification.bodySha256,
    );
    if (events.length === 0) {
      return new Response("unsupported payload", { status: 400 });
    }

    const result = await ctx.runMutation(
      internal.leoHubLab.ingestWebhookEvents,
      {
        channelId: target.channelId,
        rawPayload,
        rawBodySha256: verification.bodySha256,
        events,
      },
    );
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

/**
 * Production iaSolution Hub webhook.
 *
 * The opaque public channel key resolves tenant + channel before the payload
 * is trusted. Each channel then verifies the raw request with its own HMAC
 * secret. There is deliberately no default channel or Alfapay fallback.
 */
http.route({
  pathPrefix: "/provider-webhook/iasolution-hub/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const prefix = "/provider-webhook/iasolution-hub/";
    const pathname = new URL(request.url).pathname;
    const publicId = pathname.slice(prefix.length);
    if (!/^hub_[A-Za-z0-9_-]{24}$/.test(publicId)) {
      return new Response("not found", { status: 404 });
    }

    const target = (await ctx.runAction(
      internal.iaSolutionHub.loadWebhookContext,
      { publicId },
    )) as {
      channelId: Id<"channels">;
      status: string;
      webhookStatus?: string;
      webhookSecret: string;
    } | null;
    if (!target) return new Response("not found", { status: 404 });
    if (target.status === "revoked" || target.status === "disconnected") {
      return new Response("channel disconnected", { status: 410 });
    }
    if (target.status !== "active" || target.webhookStatus === "disabled") {
      return new Response("channel not ready", { status: 409 });
    }

    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > 1_000_000) {
      return new Response("payload too large", { status: 413 });
    }
    const rawBodyBytes = new Uint8Array(buffer);
    const signature = request.headers.get("x-hub-signature-256");
    const verification = await verifyMetaHmac(
      rawBodyBytes,
      signature,
      target.webhookSecret,
    );
    if (!verification.ok) {
      return new Response("invalid signature", { status: 401 });
    }

    const rawPayload = new TextDecoder().decode(rawBodyBytes);
    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      return new Response("invalid json", { status: 400 });
    }
    const events = normalizeIaSolutionHubWebhook(
      payload,
      verification.bodySha256,
    );
    if (events.length === 0) {
      return new Response("unsupported payload", { status: 400 });
    }

    const result = await ctx.runMutation(
      internal.iaSolutionHub.ingestWebhookEvents,
      {
        channelId: target.channelId,
        rawPayload,
        rawBodySha256: verification.bodySha256,
        events,
      },
    );
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ===== External REST API (Bearer obsp_*) =====
// All routes return JSON. Auth via `Authorization: Bearer <token>` header.

/** Read JSON body; returns null on parse failure. */
async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function convexErrorToResponse(err: unknown): Response {
  if (err instanceof ConvexError) {
    const data = err.data as Record<string, unknown> | undefined;
    const code =
      data && typeof data === "object" && typeof data.code === "string"
        ? data.code
        : "INTERNAL";
    const message =
      data && typeof data === "object" && typeof data.message === "string"
        ? data.message
        : err.message;
    const status =
      code === "INVALID_E164" ||
      code === "EMPTY_TEXT" ||
      code === "TEXT_TOO_LONG" ||
      code === "MISSING_TEMPLATE_VARIABLE"
        ? 400
        : code === "CONSENT_REQUIRED"
          ? 403
          : code === "CONVERSATION_NOT_FOUND" ||
              code === "TEMPLATE_NOT_FOUND" ||
              code === "PHONE_NUMBER_NOT_FOUND" ||
              code === "NO_PHONE_NUMBER_CONNECTED"
            ? 404
            : code === "TEMPLATE_NOT_APPROVED" || code === "SERVICE_WINDOW_EXPIRED"
              ? 409
              : 400;
    return new Response(JSON.stringify({ error: code, message, ...data }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ error: "INTERNAL" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /api/v1/contacts — list tenant contacts (most recent first). */
http.route({
  path: "/api/v1/contacts",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const caller = await authenticateRequest(ctx, request);
    if (!caller) return unauthorizedJson();
    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Math.min(Number(limitRaw), 500) : 100;
    const rows = await ctx.runQuery(internal.api.listContacts, {
      tenantId: caller.tenantId,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return jsonOk({ data: rows });
  }),
});

/** POST /api/v1/contacts — upsert contact by phone. */
http.route({
  path: "/api/v1/contacts",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const caller = await authenticateRequest(ctx, request);
    if (!caller) return unauthorizedJson();
    const body = (await parseJsonBody(request)) as
      | { phone?: string; bsuid?: string; name?: string }
      | null;
    if (!body || (typeof body.phone !== "string" && typeof body.bsuid !== "string")) {
      return badRequestJson("missing 'phone' or 'bsuid'");
    }
    try {
      const r = await ctx.runMutation(internal.api.upsertContact, {
        tenantId: caller.tenantId,
        e164: typeof body.phone === "string" ? body.phone : undefined,
        bsuid: typeof body.bsuid === "string" ? body.bsuid : undefined,
        name: typeof body.name === "string" ? body.name : undefined,
      });
      return jsonOk(
        { contact_id: r.contactId, created: r.created },
        r.created ? 201 : 200,
      );
    } catch (err) {
      return convexErrorToResponse(err);
    }
  }),
});

/** GET /api/v1/templates — list approved templates. */
http.route({
  path: "/api/v1/templates",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const caller = await authenticateRequest(ctx, request);
    if (!caller) return unauthorizedJson();
    const rows = await ctx.runQuery(internal.api.listApprovedTemplates, {
      tenantId: caller.tenantId,
    });
    return jsonOk({ data: rows });
  }),
});

/**
 * POST /api/v1/messages — unified send endpoint.
 *
 * Body shape (one of):
 *   { phone: "+351...", text: "...", client_nonce?: "..." }
 *   { phone: "+351...", template: { name, language, variables }, client_nonce?: "..." }
 *
 * Optional `phone_number_id` (string) selects the sending number when the
 * tenant has more than one connected. Optional `conversation_id` overrides
 * phone lookup if you already have a conversation id.
 */
http.route({
  path: "/api/v1/messages",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const caller = await authenticateRequest(ctx, request);
    if (!caller) return unauthorizedJson();
    if (
      caller.role !== "owner" &&
      caller.role !== "admin" &&
      caller.role !== "agent" &&
      caller.role !== "marketing"
    ) {
      return forbiddenJson();
    }

    const body = (await parseJsonBody(request)) as
      | {
          phone?: string;
          bsuid?: string;
          conversation_id?: string;
          phone_number_id?: string;
          text?: string;
          template?: {
            name?: string;
            language?: string;
            variables?: Record<string, string>;
          };
          client_nonce?: string;
        }
      | null;
    if (!body) return badRequestJson("invalid JSON body");

    const clientNonce =
      typeof body.client_nonce === "string"
        ? body.client_nonce
        : crypto.randomUUID();

    let conversationId: Id<"conversations">;
    try {
      if (body.conversation_id) {
        conversationId = body.conversation_id as Id<"conversations">;
      } else {
        if (
          typeof body.phone !== "string" &&
          typeof body.bsuid !== "string"
        ) {
          return badRequestJson(
            "missing 'phone' or 'bsuid' (or 'conversation_id')",
          );
        }
        const r = await ctx.runMutation(internal.api.findOrCreateConversation, {
          tenantId: caller.tenantId,
          e164: typeof body.phone === "string" ? body.phone : undefined,
          bsuid: typeof body.bsuid === "string" ? body.bsuid : undefined,
          phoneNumberId: body.phone_number_id
            ? (body.phone_number_id as Id<"phoneNumbers">)
            : undefined,
        });
        conversationId = r.conversationId;
      }
    } catch (err) {
      return convexErrorToResponse(err);
    }

    try {
      if (body.template && typeof body.template === "object") {
        const tpl = body.template;
        if (!tpl.name || !tpl.language) {
          return badRequestJson(
            "template requires 'name' and 'language'",
          );
        }
        const result = await ctx.runMutation(internal.api.sendTemplateAsApi, {
          tenantId: caller.tenantId,
          conversationId,
          templateName: tpl.name,
          language: tpl.language,
          variables: tpl.variables ?? {},
          clientNonce,
          apiKeyId: caller.apiKeyId,
        });
        return jsonOk(
          {
            message_id: result.messageId,
            conversation_id: conversationId,
            status: result.status,
          },
          202,
        );
      }
      if (typeof body.text === "string") {
        const result = await ctx.runMutation(internal.api.sendTextAsApi, {
          tenantId: caller.tenantId,
          conversationId,
          text: body.text,
          clientNonce,
          apiKeyId: caller.apiKeyId,
        });
        return jsonOk(
          {
            message_id: result.messageId,
            conversation_id: conversationId,
            status: result.status,
          },
          202,
        );
      }
      return badRequestJson("provide 'text' or 'template'");
    } catch (err) {
      return convexErrorToResponse(err);
    }
  }),
});

export default http;
