#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = targetArg?.split("=")[1] || "staging";

const requiredVercelEnv = [
  "CONVEX_DEPLOY_KEY",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
];

const requiredConvexEnv = [
  "PLATFORM_META_VERIFY_TOKEN",
  "PLATFORM_META_APP_SECRET",
  "META_EMBEDDED_SIGNUP_APP_ID",
  "META_EMBEDDED_SIGNUP_CONFIG_ID",
  "META_EMBEDDED_SIGNUP_REDIRECT_URI",
  "META_EMBEDDED_SIGNUP_APP_SECRET",
  "WABA_TOKEN_ENCRYPTION_KEY_V1",
  "META_GRAPH_VERSION",
  "CONVEX_SITE_URL",
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

for (const name of ["CONVEX_SITE_URL", "NEXT_PUBLIC_CONVEX_SITE_URL"]) {
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
