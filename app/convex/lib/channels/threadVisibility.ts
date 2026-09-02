import type { Doc } from "../../_generated/dataModel";

const MESSAGE_EVENT_KIND_START = "message.";
const MESSAGE_EVENT_KIND_END = "message/";

/**
 * A thread is visible in product surfaces only once it carries at least one
 * real message. Status-only or unknown-kind projections (delivery receipts
 * for a message we never saw, provider echoes) stay hidden. Single source of
 * truth for the inbox, the channel inbox, the operation dashboard and leads.
 */
export async function threadHasMessageEvent(
  ctx: { db: any },
  thread: Pick<Doc<"channelThreads">, "channelId" | "threadKey" | "lastEventKind">,
): Promise<boolean> {
  if (thread.lastEventKind.startsWith(MESSAGE_EVENT_KIND_START)) return true;
  const messageEvent = await ctx.db
    .query("channelEvents")
    .withIndex("by_channel_thread_kind", (q: any) =>
      q
        .eq("channelId", thread.channelId)
        .eq("threadKey", thread.threadKey)
        .gte("eventKind", MESSAGE_EVENT_KIND_START)
        .lt("eventKind", MESSAGE_EVENT_KIND_END),
    )
    .first();
  return messageEvent !== null;
}
