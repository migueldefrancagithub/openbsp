import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export type ApiCaller = {
  apiKeyId: Id<"apiKeys">;
  tenantId: Id<"tenants">;
  role: "owner" | "admin" | "agent" | "marketing";
};

/**
 * Resolve a Bearer token from an incoming HTTP request to an ApiCaller.
 * Returns null if the header is missing/malformed or the token is unknown.
 * On success, kicks off a fire-and-forget patch to bump `lastUsedAt`.
 */
export async function authenticateRequest(
  ctx: ActionCtx,
  request: Request,
): Promise<ApiCaller | null> {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  const token = match[1];

  const resolved = await ctx.runAction(internal.apiKeys.resolveToken, {
    plaintextToken: token,
  });
  if (!resolved) return null;

  // Touch lastUsedAt without awaiting — best-effort.
  void ctx.runMutation(internal.apiKeys._touchLastUsed, {
    apiKeyId: resolved.apiKeyId,
  });

  return {
    apiKeyId: resolved.apiKeyId,
    tenantId: resolved.tenantId,
    role: resolved.role as ApiCaller["role"],
  };
}

export function unauthorizedJson(message = "invalid api key"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function badRequestJson(
  message: string,
  details?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({ error: message, ...(details ?? {}) }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function forbiddenJson(message = "insufficient role"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
