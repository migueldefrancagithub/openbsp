/**
 * Meta Graph API client. Centralized so version and base URL are easy to
 * upgrade (PLAN section 13.4.10).
 */

export const DEFAULT_META_GRAPH_VERSION = "v21.0";
export const META_GRAPH_VERSION =
  process.env.META_GRAPH_VERSION ?? DEFAULT_META_GRAPH_VERSION;
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

export type EmbeddedSignupCodeExchange =
  | { ok: true; accessToken: string }
  | { ok: false; reason: string; statusCode?: number; metaCode?: number };

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

// ---------- Embedded Signup ----------

export async function exchangeEmbeddedSignupCode(args: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<EmbeddedSignupCodeExchange> {
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", args.appId);
  url.searchParams.set("client_secret", args.appSecret);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("code", args.code);
  const res = await fetch(url.toString(), { method: "GET" });
  const parsed = await parseResult<{ access_token?: string }>(res);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.message,
      statusCode: parsed.status,
      metaCode: parsed.code,
    };
  }
  if (!parsed.data.access_token) {
    return { ok: false, reason: "no access_token returned" };
  }
  return { ok: true, accessToken: parsed.data.access_token };
}

export async function subscribeAppToWaba(args: {
  token: string;
  wabaId: string;
}): Promise<
  { ok: true } | { ok: false; reason: string; statusCode?: number; metaCode?: number }
> {
  const res = await graphPost<{ success?: boolean }>(
    `/${args.wabaId}/subscribed_apps`,
    args.token,
    {},
  );
  if (!res.ok) {
    return {
      ok: false,
      reason: res.message,
      statusCode: res.status,
      metaCode: res.code,
    };
  }
  if (res.data.success === false) {
    return { ok: false, reason: "Meta returned success=false" };
  }
  return { ok: true };
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
  buttons?: TemplateButton[];
};

export type TemplateButton =
  | { type: "quick_reply"; text: string }
  | { type: "url"; text: string; url: string }
  | { type: "phone_number"; text: string; phoneNumber: string };

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
  const buttons = buildTemplateButtonComponent(args.buttons);
  if (!buttons.ok) {
    return { ok: false, reason: buttons.reason };
  }
  if (buttons.component) components.push(buttons.component);

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

function buildTemplateButtonComponent(
  buttons?: TemplateButton[],
):
  | { ok: true; component?: Record<string, unknown> }
  | { ok: false; reason: string } {
  if (!buttons || buttons.length === 0) return { ok: true };
  if (buttons.length > 3) {
    return {
      ok: false,
      reason: "WhatsApp templates support up to 3 buttons in this builder.",
    };
  }

  const mapped = [];
  for (const button of buttons) {
    const text = button.text.trim();
    if (text.length === 0 || text.length > 25) {
      return {
        ok: false,
        reason: "Template button text must be 1-25 characters.",
      };
    }
    if (button.type === "quick_reply") {
      mapped.push({ type: "QUICK_REPLY", text });
    } else if (button.type === "url") {
      const url = button.url.trim();
      if (!/^https:\/\/\S+$/i.test(url)) {
        return {
          ok: false,
          reason: "Template URL buttons must use a public https:// URL.",
        };
      }
      mapped.push({ type: "URL", text, url });
    } else {
      const phoneNumber = button.phoneNumber.trim();
      if (!/^\+?[1-9]\d{6,19}$/.test(phoneNumber)) {
        return {
          ok: false,
          reason: "Template phone buttons require a valid E.164-like number.",
        };
      }
      mapped.push({
        type: "PHONE_NUMBER",
        text,
        phone_number: phoneNumber,
      });
    }
  }

  return { ok: true, component: { type: "BUTTONS", buttons: mapped } };
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

/**
 * Recipient address for Meta Cloud API sends. Per Meta docs:
 *   - Phone send: include `to: "<USER_PHONE_NUMBER>"` (digits, no leading `+`).
 *   - BSUID send: include `recipient: "<BSUID>"` (e.g. `US.13491208655302741918`).
 * `to` and `recipient` are DISTINCT fields. Caller picks one. Prefer BSUID
 * when available — it survives the user enabling WhatsApp usernames
 * (June 2026 GA per Meta) and stays stable across phone changes.
 *
 * Spec: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
 */
export type WhatsAppRecipient =
  | { kind: "phone"; e164WithoutPlus: string }
  | { kind: "bsuid"; bsuid: string };

function recipientFields(
  r: WhatsAppRecipient,
): { to: string } | { recipient: string } {
  return r.kind === "phone"
    ? { to: r.e164WithoutPlus }
    : { recipient: r.bsuid };
}

export async function sendWhatsAppTemplate(args: {
  token: string;
  phoneNumberId: string;
  recipient: WhatsAppRecipient;
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
    ...recipientFields(args.recipient),
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

/**
 * Marketing-category templates moved to a dedicated endpoint per Meta's
 * Marketing Messages API: `/<PHONE_NUMBER_ID>/marketing_messages`. Same
 * request shape as `/messages` but Meta applies marketing-specific pacing
 * (response includes `messages[].message_status` with the pacing state).
 *
 * Spec: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
 */
export async function sendWhatsAppMarketingTemplate(args: {
  token: string;
  phoneNumberId: string;
  recipient: WhatsAppRecipient;
  templateName: string;
  languageCode: string;
  bodyVariables: string[];
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
    messages?: Array<{ id: string; message_status?: string }>;
  }>(`/${args.phoneNumberId}/marketing_messages`, args.token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...recipientFields(args.recipient),
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

// ---------- Request contact info (BSUID-era phone discovery) ----------

/**
 * Send an interactive `contact_request` prompt — used to ask a BSUID-only
 * user to share their phone number. When they tap Share, Meta delivers an
 * inbound message that includes `wa_id` for them.
 */
export async function sendContactRequest(args: {
  token: string;
  phoneNumberId: string;
  recipient: WhatsAppRecipient;
  bodyText: string;
}): Promise<SendTextResult> {
  const res = await graphPost<{
    messages?: Array<{ id: string }>;
  }>(`/${args.phoneNumberId}/messages`, args.token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...recipientFields(args.recipient),
    type: "interactive",
    interactive: {
      type: "contact_request",
      body: { text: args.bodyText },
      action: { name: "request_contact_info" },
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

// ---------- Parent BSUID accounts ----------

export type ParentBsuidAccount = {
  parentBsuidAccountId: string;
  enrolledBusinessPortfolios: string[];
};

/**
 * GET /{business_id}/parent-bsuid-accounts — list the parent BSUID account
 * for a business plus every business portfolio enrolled in it. Used at WABA
 * onboarding to discover whether the business uses parent BSUIDs.
 */
export async function getParentBsuidAccounts(args: {
  token: string;
  businessId: string;
}): Promise<
  | { ok: true; data: ParentBsuidAccount }
  | { ok: false; reason: string; statusCode?: number; metaCode?: number }
> {
  const res = await graphGet<{
    parent_bsuid_account_id?: string;
    enrolled_business_portfolios?: string[];
  }>(`/${args.businessId}/parent-bsuid-accounts`, args.token);
  if (!res.ok) {
    return {
      ok: false,
      reason: res.message,
      statusCode: res.status,
      metaCode: res.code,
    };
  }
  return {
    ok: true,
    data: {
      parentBsuidAccountId: res.data.parent_bsuid_account_id ?? "",
      enrolledBusinessPortfolios: res.data.enrolled_business_portfolios ?? [],
    },
  };
}

// ---------- Send WhatsApp message ----------

export type SendTextResult =
  | { ok: true; wamid: string }
  | { ok: false; reason: string; statusCode?: number; metaCode?: number };

export async function sendWhatsAppText(args: {
  token: string;
  phoneNumberId: string;
  recipient: WhatsAppRecipient;
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
      ...recipientFields(args.recipient),
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
