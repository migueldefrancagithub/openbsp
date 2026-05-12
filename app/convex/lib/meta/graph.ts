/**
 * Meta Graph API client. Centralized so version and base URL are easy to
 * upgrade (PLAN section 13.4.10).
 */

export const META_GRAPH_VERSION = "v21.0";
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export type GraphError = {
  ok: false;
  status: number;
  code?: number;
  message: string;
  raw?: unknown;
};
export type GraphSuccess<T> = { ok: true; data: T };
export type GraphResult<T> = GraphSuccess<T> | GraphError;

export async function graphGet<T>(
  path: string,
  token: string,
  query?: Record<string, string>,
): Promise<GraphResult<T>> {
  const url = new URL(`${META_GRAPH_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return await parseResult<T>(res);
}

export async function graphPost<T>(
  path: string,
  token: string,
  body: unknown,
): Promise<GraphResult<T>> {
  const url = `${META_GRAPH_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return await parseResult<T>(res);
}

async function parseResult<T>(res: Response): Promise<GraphResult<T>> {
  const status = res.status;
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    return { ok: false, status, message: `non-JSON response (${status})` };
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: number; message?: string } })?.error;
    return {
      ok: false,
      status,
      code: err?.code,
      message: err?.message ?? `HTTP ${status}`,
      raw: json,
    };
  }
  return { ok: true, data: json as T };
}

// ---------- Token validation ----------

const REQUIRED_SCOPES = [
  "whatsapp_business_messaging",
  "whatsapp_business_management",
  "business_management",
] as const;

export type TokenValidation =
  | {
      ok: true;
      userId: string;
      userType: "system_user" | "user" | "page" | "unknown";
      scopes: string[];
    }
  | { ok: false; reason: string };

/**
 * Validate a Meta system user token via Graph API. Per PLAN section 7.1
 * step 8 (Codex round2 #6).
 *  1. /me — confirm token live + extract user id
 *  2. /me/permissions — assert required scopes
 *  3. reject if user.type === "USER" (personal token, not system user)
 */
export async function validateMetaToken(
  token: string,
): Promise<TokenValidation> {
  const meRes = await graphGet<{
    id: string;
    name?: string;
    type?: string;
  }>("/me", token);
  if (!meRes.ok) return { ok: false, reason: `/me failed: ${meRes.message}` };

  const userType = normalizeUserType(meRes.data.type);
  if (userType === "user") {
    return {
      ok: false,
      reason:
        "personal user token detected — please use a system user token",
    };
  }

  const permsRes = await graphGet<{
    data: Array<{ permission: string; status: string }>;
  }>("/me/permissions", token);
  if (!permsRes.ok)
    return { ok: false, reason: `/me/permissions failed: ${permsRes.message}` };

  const granted = new Set(
    (permsRes.data.data ?? [])
      .filter((p) => p.status === "granted")
      .map((p) => p.permission),
  );
  const missing = REQUIRED_SCOPES.filter((s) => !granted.has(s));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `missing required scopes: ${missing.join(", ")}`,
    };
  }

  return {
    ok: true,
    userId: meRes.data.id,
    userType,
    scopes: Array.from(granted),
  };
}

function normalizeUserType(
  t?: string,
): "system_user" | "user" | "page" | "unknown" {
  switch (t) {
    case "user":
    case "USER":
      return "user";
    case "system_user":
    case "SYSTEM_USER":
      return "system_user";
    case "page":
    case "PAGE":
      return "page";
    default:
      return "unknown";
  }
}

// ---------- Send WhatsApp message ----------

export type SendTextResult =
  | { ok: true; wamid: string }
  | { ok: false; reason: string; statusCode?: number; metaCode?: number };

export async function sendWhatsAppText(args: {
  token: string;
  phoneNumberId: string;
  toE164WithoutPlus: string;
  text: string;
}): Promise<SendTextResult> {
  const res = await graphPost<{
    messages?: Array<{ id: string }>;
  }>(
    `/${args.phoneNumberId}/messages`,
    args.token,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: args.toE164WithoutPlus,
      type: "text",
      text: { preview_url: false, body: args.text },
    },
  );
  if (!res.ok) {
    return {
      ok: false,
      reason: res.message,
      statusCode: res.status,
      metaCode: res.code,
    };
  }
  const wamid = res.data.messages?.[0]?.id;
  if (!wamid) return { ok: false, reason: "no wamid returned" };
  return { ok: true, wamid };
}
