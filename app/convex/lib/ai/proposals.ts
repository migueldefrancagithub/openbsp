/**
 * A proposal is what the AI heard, waiting for a person to decide.
 *
 * The rule this file exists to enforce is refusal: a proposal that should never
 * have been born costs human attention, and attention spent on noise is what
 * turns a confirmation queue into a button everyone approves without reading.
 * So it refuses early — anonymised contact, value identical to what is already
 * recorded, malformed value, one already pending.
 *
 * Adapted from DeskcommCRM's `lib/contacts/proposta-de-dado.ts` (MIT).
 */
import type { Doc, Id } from "../../_generated/dataModel";

export const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * Only what a patient can actually correct about themselves here. The phone is
 * NOT proposable: it is the thread key, the identity they wrote from, and
 * rewriting it would move the conversation to someone else.
 */
export type ProposalField = "name" | "email";

export type ProposalRefusal =
  | "PROPOSAL_VALUE_INVALID"
  | "PROPOSAL_VALUE_UNCHANGED"
  | "PROPOSAL_ALREADY_PENDING"
  | "PROPOSAL_CONTACT_ANONYMISED";

/**
 * Validates SHAPE, never truth. A syntactically valid email can still be a lie,
 * and no regular expression fixes that — the person confirming does. Promising
 * more here would give false confidence to whoever approves.
 */
export function valueAcceptable(field: ProposalField, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 200) return false;
  if (field === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  return trimmed.length >= 2 && !/^\d+$/.test(trimmed);
}

export function normalizeValue(field: ProposalField, value: string): string {
  const trimmed = value.trim();
  if (field === "email") return trimmed.toLowerCase();
  return trimmed;
}

export function proposalBusinessKey(
  threadId: Id<"channelThreads">,
  kind: "contact_field" | "next_action",
  field?: ProposalField,
): string {
  return `${threadId}:${kind}:${field ?? "-"}`;
}

/** What the clinic has on file today, so whoever decides sees both sides. */
export function currentValue(contact: Doc<"contacts"> | null, field: ProposalField): string | null {
  if (!contact) return null;
  if (field === "email") {
    const attributes = (contact.customAttributes ?? {}) as Record<string, unknown>;
    const email = attributes.email;
    return typeof email === "string" ? email : null;
  }
  return contact.name ?? null;
}

export const FIELD_LABEL_PT: Record<ProposalField, string> = { name: "nome", email: "email" };
export const FIELD_LABEL_EN: Record<ProposalField, string> = { name: "name", email: "email" };
