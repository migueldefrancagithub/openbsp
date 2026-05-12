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

// ---------- Templates ----------

export type SubmitTemplateArgs = {
  token: string;
  wabaId: string;
  name: string;
  language: string;            // e.g. pt_PT
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  bodyText: string;            // with {{1}}, {{2}}, ...
  exampleVariables: string[];  // one per placeholder, in order
};

export type SubmitTemplateResult =
  | {
      ok: true;
      metaTemplateId: string;
      status: "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED";
    }
  | { ok: false; reason: string; statusCode?: number; metaCode?: number };

export async function submitTemplateToMeta(
  args: SubmitTemplateArgs,
): Promise<SubmitTemplateResult> {
  const components: Array<Record<string, unknown>> = [
    {
      type: "BODY",
      text: args.bodyText,
      ...(args.exampleVariables.length > 0
        ? { example: { body_text: [args.exampleVariables] } }
        : {}),
    },
  ];
  const res = await graphPost<{
    id: string;
    status: string;
    category?: string;
  }>(`/${args.wabaId}/message_templates`, args.token, {
    name: args.name,
    language: args.language,
    category: args.category,
    components,
  });
  if (!res.ok) {
    return {
      ok: false,
      reason: res.message,
      statusCode: res.status,
      metaCode: res.code,
    };
  }
  const metaStatus = String(res.data.status ?? "PENDING").toUpperCase();
  return {
    ok: true,
    metaTemplateId: String(res.data.id),
    status:
      metaStatus === "APPROVED"
        ? "APPROVED"
        : metaStatus === "REJECTED"
          ? "REJECTED"
          : metaStatus === "PAUSED"
            ? "PAUSED"
            : metaStatus === "DISABLED"
              ? "DISABLED"
              : "PENDING",
  };
}

export type SyncedTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  qualityScore?: string;
  rejectionReason?: string;
};

export async function listMetaTemplates(args: {
  token: string;
  wabaId: string;
}): Promise<{ ok: true; data: SyncedTemplate[] } | GraphError> {
  const res = await graphGet<{
    data: Array<{
      id: string;
      name: string;
      language: string;
      status: string;
      quality_score?: { score?: string };
      rejected_reason?: string;
    }>;
  }>(`/${args.wabaId}/message_templates`, args.token, {
    fields: "id,name,language,status,quality_score,rejected_reason",
    limit: "200",
  });
  if (!res.ok) return res;
  return {
    ok: true,
    data: (res.data.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      status: t.status,
      qualityScore: t.quality_score?.score,
      rejectionReason: t.rejected_reason,
    })),
  };
}

// ---------- Send template message ----------

export async function sendWhatsAppTemplate(args: {
  token: string;
  phoneNumberId: string;
  toE164WithoutPlus: string;
  templateName: string;
  languageCode: string;
  bodyVariables: string[]; // ordered variables for {{1}}, {{2}}, ...
}): Promise<SendTextResult> {
  const components =
    args.bodyVariables.length > 0
      ? [
          {
            type: "body",
            parameters: args.bodyVariables.map((v) => ({
              type: "text",
              text: v,
            })),
          },
        ]
      : [];
  const res = await graphPost<{
    messages?: Array<{ id: string }>;
  }>(`/${args.phoneNumberId}/messages`, args.token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: args.toE164WithoutPlus,
    type: "template",
    template: {
      name: args.templateName,
      language: { code: args.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  });
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
