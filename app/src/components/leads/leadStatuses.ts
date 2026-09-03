export const LEAD_STATUSES = [
  "new",
  "interested",
  "asked_price",
  "wants_booking",
  "awaiting_human",
  "booked",
  "confirmed",
  "attended",
  "no_show",
  "lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Clinic palette per stage: navy default, agenda blue for booking, teal for
 * won stages, amber for the team queue, coral for lost/no-show. */
export function leadColumnTone(status: LeadStatus): {
  header: string;
  accent: string;
} {
  switch (status) {
    case "wants_booking":
      return { header: "text-[#2b4f8a]", accent: "bg-[#2b4f8a]" };
    case "booked":
    case "confirmed":
    case "attended":
      return { header: "text-[#0d6b61]", accent: "bg-[#0d6b61]" };
    case "awaiting_human":
      return { header: "text-amber-700", accent: "bg-amber-500" };
    case "no_show":
    case "lost":
      return { header: "text-[#b3261e]", accent: "bg-[#e0533d]" };
    default:
      return { header: "text-ink", accent: "bg-brand-solid" };
  }
}
