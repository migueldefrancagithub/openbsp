#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = targetArg?.split("=")[1] || "staging";

const requiredVercelEnv = [
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
];

const requiredConvexEnv = [
  "SITE_URL",
  "JWT_PRIVATE_KEY",
  "JWKS",
  "PLATFORM_META_VERIFY_TOKEN",
  "WABA_TOKEN_ENCRYPTION_KEY_V1",
  "META_GRAPH_VERSION",
];

const metaGraphReadinessEnv = [
  "PLATFORM_META_APP_SECRET",
  "META_EMBEDDED_SIGNUP_APP_ID",
  "META_EMBEDDED_SIGNUP_CONFIG_ID",
  "META_EMBEDDED_SIGNUP_REDIRECT_URI",
  "META_EMBEDDED_SIGNUP_APP_SECRET",
];

const hubLabReadinessEnv = [
  "OPENBSP_ALLOWED_HUB_CHANNEL_IDS",
  "OPENBSP_ALLOWED_PHONE_NUMBERS",
  "OPENBSP_ALLOWED_WABA_IDS",
];

const requiredFiles = [
  "vercel.json",
  ".env.example",
  "convex/http.ts",
  "convex/metaAdmission.ts",
  "convex/metaEvidence.ts",
  "src/app/connect/whatsapp/[token]/page.tsx",
];

const failures = [];
const warnings = [];

for (const file of requiredFiles) {
  try {
    await fsAccess(new URL(`../${file}`, import.meta.url));
  } catch {
    failures.push(`Missing file: ${file}`);
  }
}

for (const name of requiredVercelEnv) {
  if (!process.env[name]) {
    failures.push(`Missing Vercel env for ${target}: ${name}`);
  }
}

for (const name of requiredConvexEnv) {
  if (!process.env[name]) {
    failures.push(`Missing Convex env for ${target}: ${name}`);
  }
}

for (const name of metaGraphReadinessEnv) {
  if (!process.env[name]) {
    warnings.push(`Meta Graph direct not ready for ${target}: ${name}`);
  }
}

for (const name of hubLabReadinessEnv) {
  if (!process.env[name]) {
    warnings.push(`Hub lab configuration gated for ${target}: ${name}`);
  }
}

const aiProviderEnv = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"];
if (!aiProviderEnv.some((name) => process.env[name])) {
  warnings.push(
    `AI agents not ready for ${target}: none of ${aiProviderEnv.join(", ")} is set (clinics can still store their own key).`,
  );
}

if (!process.env.CONVEX_DEPLOY_KEY) {
  warnings.push(
    "CONVEX_DEPLOY_KEY is absent. This is OK for local Convex deploys; set it only if CI/Vercel deploys Convex.",
  );
}

if (
  process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI &&
  !process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI.endsWith(
    "/embedded-signup/callback",
  )
) {
  failures.push(
    "META_EMBEDDED_SIGNUP_REDIRECT_URI must end with /embedded-signup/callback",
  );
}

for (const name of [
  "CONVEX_SITE_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "SITE_URL",
]) {
  const value = process.env[name];
  if (value && !value.startsWith("https://")) {
    failures.push(`${name} must be public https://`);
  }
}

if (
  process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 &&
  !looksLikeEncryptionKey(process.env.WABA_TOKEN_ENCRYPTION_KEY_V1)
) {
  failures.push(
    "WABA_TOKEN_ENCRYPTION_KEY_V1 must be 32 bytes as 64 hex chars or base64.",
  );
}

if (process.env.META_GRAPH_VERSION && !/^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION)) {
  failures.push("META_GRAPH_VERSION must look like v25.0.");
}

if (target === "production") {
  warnings.push(
    "Before production: revoke the previously exposed GitHub token and use a minimal-scope replacement.",
  );
  warnings.push(
    "Before production: confirm DPA/DPIA are signed in the tenant before connecting real WABAs.",
  );
}

{
  const { spawnSync } = await import("node:child_process");
  const check = spawnSync(process.execPath, [
    new URL("./check-error-codes.mjs", import.meta.url).pathname,
  ]);
  if (check.status !== 0) {
    failures.push(
      `Unmapped ConvexError codes:\n${check.stderr.toString().trim()}`,
    );
  }
}

console.log(`OpenBSP deploy preflight (${target})`);
console.log(`Mode: ${strict ? "strict" : "report"}`);

if (warnings.length > 0) {
  console.log("\nWarnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (failures.length > 0) {
  console.log("\nBlockers:");
  for (const failure of failures) console.log(`- ${failure}`);
  if (strict) process.exit(1);
  process.exit(0);
}

console.log("\nReady: required deploy config and env names are present.");

function looksLikeEncryptionKey(value) {
  return /^[0-9a-fA-F]{64}$/.test(value) || /^[A-Za-z0-9+/=]{43,64}$/.test(value);
}

async function fsAccess(url) {
  const { access } = await import("node:fs/promises");
  return access(url);
}
