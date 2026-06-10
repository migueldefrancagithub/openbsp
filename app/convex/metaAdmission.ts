import { ConvexError, v } from "convex/values";
import { tenantMutation, tenantQuery, requireRoleAtLeast } from "./lib/customFunctions";
import {
  getSecretEncryptionStatus,
  isSecretEncryptionConfigured,
} from "./lib/secrets";

type AdmissionStatus =
  | "todo"
  | "in_progress"
  | "done"
  | "blocked"
  | "waived";

type AdmissionGroup =
  | "business"
  | "meta_app"
  | "embedded_signup"
  | "webhook"
  | "coexistence"
  | "security"
  | "support";

type AdmissionSource = "manual" | "auto" | "hybrid";
type ReadinessLabel = "blocked" | "setup" | "review_ready" | "live_ready";

type AdmissionDefinition = {
  key: string;
  title: string;
  group: AdmissionGroup;
  source: AdmissionSource;
  blocking: boolean;
  description: string;
  action: string;
};

type ManualRow = {
  key: string;
  status: AdmissionStatus;
  notes?: string;
  updatedAt: number;
};

const statusValidator = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("blocked"),
  v.literal("waived"),
);

const sourceValidator = v.union(
  v.literal("manual"),
  v.literal("auto"),
  v.literal("hybrid"),
);

const groupValidator = v.union(
  v.literal("business"),
  v.literal("meta_app"),
  v.literal("embedded_signup"),
  v.literal("webhook"),
  v.literal("coexistence"),
  v.literal("security"),
  v.literal("support"),
);

const ADMISSION_DEFINITIONS: AdmissionDefinition[] = [
  {
    key: "business_verified",
    title: "Business verified",
    group: "business",
    source: "manual",
    blocking: true,
    description: "Legal business, website, docs, and Business Portfolio are aligned.",
    action: "Confirm Business Manager verification and document match.",
  },
  {
    key: "legal_site_ready",
    title: "Legal site ready",
    group: "business",
    source: "manual",
    blocking: true,
    description: "Public website, privacy policy, terms, support, and app review URLs are live.",
    action: "Publish privacy, terms, support, and product pages before review.",
  },
  {
    key: "app_review_started",
    title: "Meta app review started",
    group: "meta_app",
    source: "manual",
    blocking: true,
    description: "The provider app has review evidence for WhatsApp and business management use.",
    action: "Prepare screen recordings, use-case text, and review notes.",
  },
  {
    key: "advanced_access_requested",
    title: "Advanced access requested",
    group: "meta_app",
    source: "manual",
    blocking: true,
    description: "business_management and whatsapp_business_management are requested at Advanced Access.",
    action: "Request Advanced Access for the Meta permissions used by Embedded Signup.",
  },
  {
    key: "embedded_signup_configured",
    title: "Embedded Signup configured",
    group: "embedded_signup",
    source: "auto",
    blocking: true,
    description: "Meta app id, config id, redirect URI, and app secret are present.",
    action: "Set META_EMBEDDED_SIGNUP_* environment variables.",
  },
  {
    key: "waba_connected",
    title: "WABA connected",
    group: "embedded_signup",
    source: "auto",
    blocking: true,
    description: "At least one WhatsApp Business Account is connected to this tenant.",
    action: "Connect a WABA manually or via Embedded Signup.",
  },
  {
    key: "webhook_hmac_configured",
    title: "Webhook HMAC configured",
    group: "webhook",
    source: "auto",
    blocking: true,
    description: "Webhook verify token and Meta app secret are configured for validation.",
    action: "Set PLATFORM_META_VERIFY_TOKEN and PLATFORM_META_APP_SECRET.",
  },
  {
    key: "webhook_public_https",
    title: "Public HTTPS webhook",
    group: "webhook",
    source: "auto",
    blocking: true,
    description: "Convex site URL is public HTTPS so Meta can deliver webhooks.",
    action: "Deploy Convex HTTP actions and configure CONVEX_SITE_URL/NEXT_PUBLIC_CONVEX_SITE_URL.",
  },
  {
    key: "token_encryption_enabled",
    title: "WABA token encryption",
    group: "security",
    source: "auto",
    blocking: true,
    description: "New WABA tokens are encrypted at rest; legacy plaintext rows are migrated away.",
    action: "Set WABA_TOKEN_ENCRYPTION_KEY_V1 and reconnect/migrate legacy WABA tokens.",
  },
  {
    key: "partner_bridge_selected",
    title: "Provider bridge selected",
    group: "coexistence",
    source: "manual",
    blocking: true,
    description: "Direct Meta provider route or partner fallback is chosen for COEX approval.",
    action: "Pick direct Tech Provider path or partner bridge before client onboarding.",
  },
  {
    key: "coex_eligibility_confirmed",
    title: "COEX eligibility confirmed",
    group: "coexistence",
    source: "manual",
    blocking: true,
    description: "The client number and Business App setup can run Cloud API coexistence.",
    action: "Confirm number ownership, Business App state, and any provider-specific limits.",
  },
  {
    key: "smb_message_echoes_confirmed",
    title: "SMB message echoes confirmed",
    group: "coexistence",
    source: "manual",
    blocking: false,
    description: "Business App messages can be observed through the subscribed webhook event.",
    action: "Subscribe and test smb_message_echoes before go-live.",
  },
  {
    key: "business_app_13_day_process",
    title: "13-day Business App process",
    group: "coexistence",
    source: "manual",
    blocking: false,
    description: "The operating runbook covers the Business App activity requirement during coexistence.",
    action: "Add a client SOP for Business App activity checks.",
  },
  {
    key: "support_runbook_ready",
    title: "Support runbook ready",
    group: "support",
    source: "manual",
    blocking: false,
    description: "Escalation path exists for verification, billing, quality, template, and number issues.",
    action: "Document the owner, partner/provider route, and emergency fallback steps.",
  },
];

const definitionKeys = new Set(ADMISSION_DEFINITIONS.map((item) => item.key));

export const readiness = tenantQuery({
  args: {},
  returns: v.object({
    score: v.number(),
    readinessLabel: v.union(
      v.literal("blocked"),
      v.literal("setup"),
      v.literal("review_ready"),
      v.literal("live_ready"),
    ),
    suggestedPath: v.string(),
    blockers: v.array(v.string()),
    checks: v.array(
      v.object({
        key: v.string(),
        title: v.string(),
        group: groupValidator,
        source: sourceValidator,
        status: statusValidator,
        blocking: v.boolean(),
        description: v.string(),
        action: v.string(),
        notes: v.optional(v.string()),
        updatedAt: v.optional(v.number()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const manualRows = await ctx.db
      .query("metaAdmissionChecks")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const manualByKey = new Map<string, ManualRow>(
      manualRows.map((row) => [
        row.key,
        {
          key: row.key,
          status: row.status,
          notes: row.notes,
          updatedAt: row.updatedAt,
        },
      ]),
    );

    const accounts = await ctx.db
      .query("whatsappAccounts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();

    const env = {
      embeddedAppId: process.env.META_EMBEDDED_SIGNUP_APP_ID,
      embeddedConfigId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
      embeddedRedirectUri: process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI,
      embeddedAppSecret: process.env.META_EMBEDDED_SIGNUP_APP_SECRET,
      webhookSecret: process.env.PLATFORM_META_APP_SECRET,
      webhookVerifyToken: process.env.PLATFORM_META_VERIFY_TOKEN,
      siteUrl:
        process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? process.env.CONVEX_SITE_URL,
    };
    const embeddedEnvMissing = [
      ["META_EMBEDDED_SIGNUP_APP_ID", env.embeddedAppId],
      ["META_EMBEDDED_SIGNUP_CONFIG_ID", env.embeddedConfigId],
      ["META_EMBEDDED_SIGNUP_REDIRECT_URI", env.embeddedRedirectUri],
      ["META_EMBEDDED_SIGNUP_APP_SECRET", env.embeddedAppSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    const encryptionStatus = getSecretEncryptionStatus();
    const legacyTokenRows = accounts.filter(
      (account) => account.accessToken && !account.accessTokenCiphertext,
    );

    const autoStatuses = new Map<
      string,
      { status: AdmissionStatus; notes?: string }
    >([
      [
        "embedded_signup_configured",
        embeddedEnvMissing.length === 0
          ? { status: "done", notes: "Embedded Signup env is complete." }
          : {
              status: "blocked",
              notes: `Missing: ${embeddedEnvMissing.join(", ")}.`,
            },
      ],
      [
        "waba_connected",
        accounts.length > 0
          ? { status: "done", notes: `${accounts.length} WABA connection(s).` }
          : { status: "todo", notes: "No WABA connection for this tenant yet." },
      ],
      [
        "webhook_hmac_configured",
        env.webhookSecret && env.webhookVerifyToken
          ? { status: "done", notes: "HMAC secret and verify token present." }
          : {
              status: "blocked",
              notes: "Missing PLATFORM_META_APP_SECRET or PLATFORM_META_VERIFY_TOKEN.",
            },
      ],
      [
        "webhook_public_https",
        env.siteUrl?.startsWith("https://")
          ? { status: "done", notes: env.siteUrl }
          : {
              status: "blocked",
              notes: "Convex site URL must be public https:// for Meta webhooks.",
            },
      ],
      [
        "token_encryption_enabled",
        isSecretEncryptionConfigured() && legacyTokenRows.length === 0
          ? { status: "done", notes: "WABA token encryption key is active." }
          : isSecretEncryptionConfigured()
            ? {
                status: "in_progress",
                notes: `${legacyTokenRows.length} legacy plaintext token row(s) still need migration.`,
              }
            : {
                status: "blocked",
                notes:
                  encryptionStatus.configured === false
                    ? encryptionStatus.message
                    : "WABA token encryption is not configured.",
              },
      ],
    ]);

    const checks = ADMISSION_DEFINITIONS.map((definition) => {
      const manual = manualByKey.get(definition.key);
      const auto = autoStatuses.get(definition.key);
      const autoDone = auto?.status === "done";
      const status = autoDone
        ? "done"
        : auto?.status ?? manual?.status ?? "todo";
      const notes = [auto?.notes, manual?.notes].filter(Boolean).join(" ");
      return {
        ...definition,
        status,
        notes: notes || undefined,
        updatedAt: manual?.updatedAt,
      };
    });

    const completed = checks.filter(
      (check) => check.status === "done" || check.status === "waived",
    ).length;
    const blockers = checks
      .filter(
        (check) =>
          check.blocking &&
          check.status !== "done" &&
          check.status !== "waived",
      )
      .map((check) => check.key);
    const score = Math.round((completed / checks.length) * 100);
    const readinessLabel: ReadinessLabel =
      blockers.some((key) => checks.find((check) => check.key === key)?.status === "blocked")
        ? "blocked"
        : score >= 90
          ? "live_ready"
          : blockers.length === 0
            ? "review_ready"
            : "setup";

    return {
      score,
      readinessLabel,
      blockers,
      suggestedPath: buildSuggestedPath(readinessLabel, blockers, checks),
      checks,
    };
  },
});

export const setManualCheck = tenantMutation({
  args: {
    key: v.string(),
    status: statusValidator,
    notes: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireRoleAtLeast(ctx.role, "admin");
    if (!definitionKeys.has(args.key)) {
      throw new ConvexError({ code: "INVALID_ADMISSION_CHECK" });
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("metaAdmissionChecks")
      .withIndex("by_tenant_key", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("key", args.key),
      )
      .unique();

    const notes =
      args.notes && args.notes.trim().length > 0
        ? args.notes.trim().slice(0, 1000)
        : undefined;
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        notes,
        updatedAt: now,
        updatedBy: ctx.memberId,
      });
    } else {
      await ctx.db.insert("metaAdmissionChecks", {
        tenantId: ctx.tenantId,
        key: args.key,
        status: args.status,
        notes,
        updatedAt: now,
        updatedBy: ctx.memberId,
      });
    }
    return null;
  },
});

function buildSuggestedPath(
  readinessLabel: ReadinessLabel,
  blockers: string[],
  checks: Array<{ key: string; action: string }>,
): string {
  if (readinessLabel === "live_ready") {
    return "Ready to onboard real client WABAs and operate COEX with provider support.";
  }
  if (readinessLabel === "review_ready") {
    return "Blocking checks are clear. Package evidence and submit/continue Meta provider review.";
  }
  const next = checks.find((check) => blockers.includes(check.key));
  if (next) return next.action;
  return "Finish manual business, Meta app, webhook, and COEX checks.";
}
