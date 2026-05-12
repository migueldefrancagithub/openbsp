import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifyMetaHmac } from "./lib/meta/verify";

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

export default http;
