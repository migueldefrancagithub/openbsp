/**
 * Meta Cloud API 24h customer service window.
 *
 * Free-form (non-template) business messages are only deliverable while the
 * window is open: `now - lastInboundAt < 24h`. Outside it, only approved
 * templates go through. The window is per conversation (business phone ×
 * consumer), tracked on `conversations.lastIncomingAt` /
 * `serviceWindowExpiresAt` by webhook ingestion.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isServiceWindowOpen(
  lastInboundAt: number | undefined,
  now: number,
): boolean {
  return lastInboundAt !== undefined && now - lastInboundAt < SERVICE_WINDOW_MS;
}
