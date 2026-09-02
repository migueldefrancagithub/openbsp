import type { ThreadIntent } from "../channels/intents";
import { THREAD_INTENTS } from "../channels/intents";

export type RouteDecision = {
  intent: ThreadIntent;
  needsHuman: boolean;
  confidence: number;
  language: "pt" | "en" | "other";
  summary?: string;
};

/** Defensive parse of the router's forced tool call. Never throws. */
export function parseRouteDecision(input: unknown): RouteDecision | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const intent = typeof raw.intent === "string" && (THREAD_INTENTS as readonly string[]).includes(raw.intent) ? (raw.intent as ThreadIntent) : "other";
  const confidenceRaw = typeof raw.confidence === "number" ? raw.confidence : Number(raw.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0.5;
  const language = raw.language === "en" || raw.language === "other" ? raw.language : "pt";
  return {
    intent,
    needsHuman: raw.needsHuman === true || raw.needsHuman === "true",
    confidence,
    language,
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 200) : undefined,
  };
}

/** Minimal JSON-Schema check for tool inputs: required keys, primitive types, enums. */
export function validateAgainstSchema(schema: Record<string, unknown>, input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return ["input must be an object"];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required ?? []) as string[];
  const value = input as Record<string, unknown>;
  for (const key of required) {
    if (value[key] === undefined || value[key] === null || value[key] === "") errors.push(`missing ${key}`);
  }
  for (const [key, raw] of Object.entries(value)) {
    const prop = properties[key];
    if (!prop) {
      if (schema.additionalProperties === false) errors.push(`unexpected ${key}`);
      continue;
    }
    const type = prop.type;
    if (type === "string" && typeof raw !== "string") errors.push(`${key} must be a string`);
    if (type === "number" && typeof raw !== "number") errors.push(`${key} must be a number`);
    if (type === "boolean" && typeof raw !== "boolean") errors.push(`${key} must be a boolean`);
    if (type === "array" && !Array.isArray(raw)) errors.push(`${key} must be an array`);
    const allowed = prop.enum as unknown[] | undefined;
    if (allowed && !allowed.includes(raw)) errors.push(`${key} must be one of ${allowed.join("|")}`);
  }
  return errors;
}
