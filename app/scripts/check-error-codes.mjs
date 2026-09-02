#!/usr/bin/env node
// Fails when a ConvexError code thrown in convex/ has no PT/EN message in
// src/lib/convexErrorMessage.ts. Keeps raw codes out of the product UI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const convexDir = join(root, "convex");
const dictionaryPath = join(root, "src", "lib", "convexErrorMessage.ts");

const SKIP_DIRS = new Set(["_generated", "_test", "node_modules"]);
const CODE_RE = /code:\s*"([A-Z][A-Z0-9_]+)"/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const thrown = new Map();
for (const file of walk(convexDir)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(CODE_RE)) {
    if (!thrown.has(match[1])) thrown.set(match[1], file.replace(root, ""));
  }
}

const dictionary = readFileSync(dictionaryPath, "utf8");
const known = new Set(
  [...dictionary.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s*\[/gm)].map((m) => m[1]),
);

const missing = [...thrown.keys()].filter((code) => !known.has(code)).sort();
if (missing.length > 0) {
  console.error("Missing PT/EN messages in src/lib/convexErrorMessage.ts for:");
  for (const code of missing) console.error(`- ${code} (${thrown.get(code)})`);
  process.exit(1);
}
console.log(`check:errors OK — ${thrown.size} codes thrown, all mapped.`);
