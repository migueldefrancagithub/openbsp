import { ConvexError, v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { META_GRAPH_BASE } from "./lib/meta/graph";

type EvidenceStep = {
  group: string;
  label: string;
  method: "GET" | "POST";
  path: string;
  tokenKind: "channel" | "app";
  write?: boolean;
  body?: unknown;
};

type EvidenceRecord = {
  group: string;
  label: string;
  method: "GET" | "POST";
  endpoint: string;
  status: number;
  traceId: string;
  requestId: string;
  ok: boolean;
  skipped?: boolean;
  curl: string;
  response: unknown;
};

const READ_STEPS: EvidenceStep[] = [
  {
    group: "identity",
    label: "GET /me",
    method: "GET",
    path: "/me?fields=id,name,type",
    tokenKind: "channel",
  },
  {
    group: "identity",
    label: "GET /me/permissions",
    method: "GET",
    path: "/me/permissions",
    tokenKind: "channel",
  },
  {
    group: "identity",
    label: "GET /debug_token",
    method: "GET",
    path: "/debug_token?input_token={self}",
    tokenKind: "app",
  },
  {
    group: "whatsapp_business_management",
    label: "GET /{waba}",
    method: "GET",
    path:
      "/{waba}?fields=id,name,currency,timezone_id,message_template_namespace,account_review_status,business_verification_status,ownership_type",
    tokenKind: "channel",
  },
  {
    group: "whatsapp_business_management",
    label: "GET /{waba}/phone_numbers",
    method: "GET",
    path:
      "/{waba}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,name_status,messaging_limit_tier",
    tokenKind: "channel",
  },
  {
    group: "whatsapp_business_management",
    label: "GET /{phone}",
    method: "GET",
    path:
      "/{phone}?fields=id,verified_name,display_phone_number,quality_rating,messaging_limit_tier,platform_type,throughput,code_verification_status,name_status",
    tokenKind: "channel",
  },
  {
    group: "whatsapp_business_management",
    label: "GET /{waba}/message_templates",
    method: "GET",
    path: "/{waba}/message_templates?fields=id,name,status,category,language&limit=10",
    tokenKind: "channel",
  },
  {
    group: "whatsapp_business_management",
    label: "GET /{phone}/whatsapp_business_profile",
    method: "GET",
    path:
      "/{phone}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical",
    tokenKind: "channel",
  },
  {
    group: "whatsapp_business_management",
    label: "GET /{waba}/subscribed_apps",
    method: "GET",
    path: "/{waba}/subscribed_apps",
    tokenKind: "channel",
  },
];

const WRITE_STEPS: EvidenceStep[] = [
  {
    group: "whatsapp_business_management",
    label: "POST /{waba}/message_templates",
    method: "POST",
    path: "/{waba}/message_templates",
    tokenKind: "channel",
    write: true,
    body: {
      name: "openbsp_evidence_{ts}",
      language: "pt_BR",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Ola {{1}}, seu atendimento {{2}} foi registrado.",
          example: { body_text: [["Maria", "#1234"]] },
        },
      ],
    },
  },
  {
    group: "whatsapp_business_messaging",
    label: "POST /{phone}/messages (template hello_world)",
    method: "POST",
    path: "/{phone}/messages",
    tokenKind: "channel",
    write: true,
    body: {
      messaging_product: "whatsapp",
      to: "{recipient}",
      type: "template",
      template: { name: "hello_world", language: { code: "en_US" } },
    },
  },
];

const evidenceRecordValidator = v.object({
  group: v.string(),
  label: v.string(),
  method: v.union(v.literal("GET"), v.literal("POST")),
  endpoint: v.string(),
  status: v.number(),
  traceId: v.string(),
  requestId: v.string(),
  ok: v.boolean(),
  skipped: v.optional(v.boolean()),
  curl: v.string(),
  response: v.any(),
});

function metaAppSecret(metaAppId: string): string | undefined {
  if (
    process.env.META_EMBEDDED_SIGNUP_APP_ID &&
    metaAppId === process.env.META_EMBEDDED_SIGNUP_APP_ID
  ) {
    return process.env.META_EMBEDDED_SIGNUP_APP_SECRET;
  }
  return process.env.PLATFORM_META_APP_SECRET;
}

function redact(value: string, secrets: string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[REDACTED]");
  }
  out = out.replace(/(access_token=)[A-Za-z0-9_.-]+/g, "$1[REDACTED]");
  out = out.replace(/(input_token=)[A-Za-z0-9_.-]+/g, "$1[REDACTED]");
  out = out.replace(/("access_token"\s*:\s*")[^"]+(")/g, "$1[REDACTED]$2");
  out = out.replace(/(Bearer )[A-Za-z0-9_.-]{16,}/g, "$1[REDACTED]");
  out = out.replace(/\b(EAA|EAAG|IGAA)[A-Za-z0-9_.-]{20,}\b/g, "[REDACTED]");
  return out;
}

function safeJson(value: unknown, secrets: string[]): unknown {
  if (value === undefined) return null;
  return JSON.parse(redact(JSON.stringify(value), secrets));
}

function interpolate(input: string, vars: Record<string, string>): string {
  return input.replace(/\{([a-zA-Z_]+)\}/g, (_match, key: string) => vars[key] ?? "");
}

function interpolateJson(value: unknown, vars: Record<string, string>): unknown {
  return JSON.parse(interpolate(JSON.stringify(value), vars));
}

function buildDoc(args: {
  target: EvidenceTarget;
  records: EvidenceRecord[];
  generatedAt: number;
}): string {
  const lines: string[] = [];
  lines.push("==============================================================");
  lines.push("OPENBSP META APP REVIEW EVIDENCE — WHATSAPP");
  lines.push("==============================================================");
  lines.push("");
  lines.push(`Generated:       ${new Date(args.generatedAt).toISOString()}`);
  lines.push(`Meta app ID:     ${args.target.metaAppId}`);
  lines.push(`WABA ID:         ${args.target.wabaId}`);
  lines.push(`Phone number ID: ${args.target.phoneNumberId}`);
  lines.push(`Phone:           ${args.target.phoneE164}`);
  lines.push("");
  lines.push(
    "Every HTTP status, x-fb-trace-id, x-fb-request-id, and response below came from a live Graph API call.",
  );
  lines.push("Tokens and bearer credentials are redacted.");
  lines.push("");

  for (const record of args.records) {
    lines.push("--------------------------------------------------------------");
    lines.push(`[${record.group}] ${record.label}`);
    if (record.skipped) {
      lines.push("SKIPPED");
      lines.push(String(record.response ?? ""));
      lines.push("");
      continue;
    }
    lines.push(`${record.method} ${record.endpoint}`);
    lines.push(
      `HTTP ${record.status}    x-fb-trace-id: ${record.traceId || "-"}    x-fb-request-id: ${record.requestId || "-"}`,
    );
    lines.push("");
    lines.push("Request:");
    lines.push(record.curl);
    lines.push("");
    lines.push("Response:");
    lines.push(
      typeof record.response === "string"
        ? record.response
        : JSON.stringify(record.response, null, 2),
    );
    lines.push("");
  }

  lines.push("==============================================================");
  lines.push("SUMMARY");
  lines.push("==============================================================");
  const groups = Array.from(new Set(args.records.map((record) => record.group)));
  for (const group of groups) {
    const groupRecords = args.records.filter((record) => record.group === group);
    const ok = groupRecords.filter((record) => record.ok).length;
    const skipped = groupRecords.filter((record) => record.skipped).length;
    lines.push(`${group}: ${ok}/${groupRecords.length} ok, ${skipped} skipped`);
  }
  lines.push("--------------------------------------------------------------");
  lines.push("END");
  return lines.join("\n");
}

async function runStep(args: {
  step: EvidenceStep;
  target: EvidenceTarget;
  channelToken: string;
  appToken?: string;
  secrets: string[];
  allowWrites: boolean;
  recipient?: string;
  ts: string;
}): Promise<EvidenceRecord> {
  if (args.step.write && !args.allowWrites) {
    return {
      group: args.step.group,
      label: args.step.label,
      method: args.step.method,
      endpoint: interpolate(args.step.path, {
        waba: args.target.wabaId,
        phone: args.target.phoneNumberId,
        recipient: args.recipient ?? "",
        ts: args.ts,
      }).split("?")[0],
      status: 0,
      traceId: "",
      requestId: "",
      ok: false,
      skipped: true,
      curl: "",
      response: "Skipped because writes are disabled.",
    };
  }
  if (args.step.write && args.step.path.includes("/messages") && !args.recipient) {
    return {
      group: args.step.group,
      label: args.step.label,
      method: args.step.method,
      endpoint: interpolate(args.step.path, {
        waba: args.target.wabaId,
        phone: args.target.phoneNumberId,
        recipient: "",
        ts: args.ts,
      }),
      status: 0,
      traceId: "",
      requestId: "",
      ok: false,
      skipped: true,
      curl: "",
      response: "Skipped because a recipient is required for message evidence.",
    };
  }

  const token = args.step.tokenKind === "app" ? args.appToken : args.channelToken;
  if (!token) {
    return {
      group: args.step.group,
      label: args.step.label,
      method: args.step.method,
      endpoint: args.step.path.split("?")[0],
      status: 0,
      traceId: "",
      requestId: "",
      ok: false,
      skipped: true,
      curl: "",
      response: "Skipped because the required Meta token is not configured.",
    };
  }

  const vars = {
    self: args.channelToken,
    waba: args.target.wabaId,
    phone: args.target.phoneNumberId,
    recipient: args.recipient ?? "",
    ts: args.ts,
  };
  const path = interpolate(args.step.path, vars);
  const url = `${META_GRAPH_BASE}${path}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const init: RequestInit = { method: args.step.method, headers };
  let body: unknown;
  if (args.step.method === "POST") {
    body = interpolateJson(args.step.body ?? {}, vars);
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let status = 0;
  let traceId = "";
  let requestId = "";
  let response: unknown = null;
  try {
    const res = await fetch(url, init);
    status = res.status;
    traceId = res.headers.get("x-fb-trace-id") ?? "";
    requestId = res.headers.get("x-fb-request-id") ?? "";
    const text = await res.text();
    try {
      response = JSON.parse(text);
    } catch {
      response = text;
    }
  } catch (error) {
    response = {
      error: error instanceof Error ? error.message : "fetch failed",
    };
  }

  const endpoint = url.split("?")[0];
  const redactedUrl = redact(url, args.secrets);
  const curl =
    args.step.method === "POST"
      ? `curl -X POST "${redactedUrl}" \\\n  -H "Authorization: Bearer [REDACTED]" \\\n  -H "Content-Type: application/json" \\\n  -d '${redact(JSON.stringify(body ?? {}), args.secrets)}'`
      : `curl -X GET "${redactedUrl}" \\\n  -H "Authorization: Bearer [REDACTED]"`;
  return {
    group: args.step.group,
    label: args.step.label,
    method: args.step.method,
    endpoint,
    status,
    traceId,
    requestId,
    ok: status >= 200 && status < 300,
    curl,
    response: safeJson(response, args.secrets),
  };
}

type EvidenceTarget = {
  tenantId: Id<"tenants">;
  metaAppId: string;
  wabaId: string;
  whatsappAccountId: Id<"whatsappAccounts">;
  phoneNumberId: string;
  phoneE164: string;
  phoneDisplayName: string;
};

type EvidenceRunResult = {
  ok: boolean;
  generatedAt: number;
  filename: string;
  summary: {
    total: number;
    ok: number;
    failed: number;
    skipped: number;
    writesEnabled: boolean;
  };
  target: Omit<EvidenceTarget, "tenantId">;
  records: EvidenceRecord[];
  doc: string;
};

export const runWhatsAppEvidence = action({
  args: {
    whatsappAccountId: v.id("whatsappAccounts"),
    phoneNumberId: v.optional(v.id("phoneNumbers")),
    allowWrites: v.optional(v.boolean()),
    recipient: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    generatedAt: v.number(),
    filename: v.string(),
    summary: v.object({
      total: v.number(),
      ok: v.number(),
      failed: v.number(),
      skipped: v.number(),
      writesEnabled: v.boolean(),
    }),
    target: v.object({
      metaAppId: v.string(),
      wabaId: v.string(),
      whatsappAccountId: v.id("whatsappAccounts"),
      phoneNumberId: v.string(),
      phoneE164: v.string(),
      phoneDisplayName: v.string(),
    }),
    records: v.array(evidenceRecordValidator),
    doc: v.string(),
  }),
  handler: async (ctx, args): Promise<EvidenceRunResult> => {
    const me: { tenantId: Id<"tenants">; role: string } | null =
      await ctx.runQuery(internal.whatsappAccounts._meTenant, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    if (me.role !== "owner" && me.role !== "admin") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only owner or admin can run Meta evidence checks.",
      });
    }

    const target: EvidenceTarget | null = await ctx.runQuery(
      internal.metaEvidence._getWhatsAppEvidenceTarget,
      {
        tenantId: me.tenantId,
        whatsappAccountId: args.whatsappAccountId,
        phoneNumberId: args.phoneNumberId,
      },
    );
    if (!target) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "WhatsApp channel does not belong to this workspace.",
      });
    }

    const channelToken: string | null = await ctx.runAction(
      internal.whatsappAccounts.decryptWabaToken,
      { whatsappAccountId: target.whatsappAccountId },
    );
    if (!channelToken) {
      throw new ConvexError({
        code: "NO_WABA_TOKEN",
        message: "This WABA has no decryptable token.",
      });
    }

    const appSecret = metaAppSecret(target.metaAppId);
    const appToken =
      appSecret && target.metaAppId ? `${target.metaAppId}|${appSecret}` : undefined;
    const generatedAt = Date.now();
    const ts = new Date(generatedAt).toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const allowWrites = args.allowWrites === true;
    const steps = [...READ_STEPS, ...WRITE_STEPS];
    const secrets = [channelToken, appToken ?? "", appSecret ?? ""];
    const records: EvidenceRecord[] = [];
    for (const step of steps) {
      records.push(
        await runStep({
          step,
          target,
          channelToken,
          appToken,
          secrets,
          allowWrites,
          recipient: args.recipient?.trim(),
          ts,
        }),
      );
    }
    const safeRecords = safeJson(records, secrets) as EvidenceRecord[];
    const doc = redact(
      buildDoc({ target, records: safeRecords, generatedAt }),
      secrets,
    );
    const okCount = safeRecords.filter((record) => record.ok).length;
    const skipped = safeRecords.filter((record) => record.skipped).length;
    const failed = safeRecords.length - okCount - skipped;
    return {
      ok: failed === 0,
      generatedAt,
      filename: `openbsp-meta-evidence-${target.wabaId}-${ts}.txt`,
      summary: {
        total: safeRecords.length,
        ok: okCount,
        failed,
        skipped,
        writesEnabled: allowWrites,
      },
      target: {
        metaAppId: target.metaAppId,
        wabaId: target.wabaId,
        whatsappAccountId: target.whatsappAccountId,
        phoneNumberId: target.phoneNumberId,
        phoneE164: target.phoneE164,
        phoneDisplayName: target.phoneDisplayName,
      },
      records: safeRecords,
      doc,
    };
  },
});

export const _getWhatsAppEvidenceTarget = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    whatsappAccountId: v.id("whatsappAccounts"),
    phoneNumberId: v.optional(v.id("phoneNumbers")),
  },
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      metaAppId: v.string(),
      wabaId: v.string(),
      whatsappAccountId: v.id("whatsappAccounts"),
      phoneNumberId: v.string(),
      phoneE164: v.string(),
      phoneDisplayName: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.whatsappAccountId);
    if (!account || account.tenantId !== args.tenantId) return null;
    const phones = args.phoneNumberId
      ? [await ctx.db.get(args.phoneNumberId)]
      : await ctx.db
          .query("phoneNumbers")
          .withIndex("by_account", (q) => q.eq("whatsappAccountId", account._id))
          .collect();
    const phone = phones.find(
      (p) => p && p.tenantId === args.tenantId && p.whatsappAccountId === account._id,
    );
    if (!phone) return null;
    return {
      tenantId: account.tenantId,
      metaAppId: account.metaAppId,
      wabaId: account.wabaId,
      whatsappAccountId: account._id,
      phoneNumberId: phone.phoneNumberId,
      phoneE164: phone.e164,
      phoneDisplayName: phone.displayName,
    };
  },
});
