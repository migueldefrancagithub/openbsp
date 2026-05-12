import { ConversationThread } from "@/components/inbox/ConversationThread";
import type { Id } from "../../../../../convex/_generated/dataModel";

type Props = { params: Promise<{ conversationId: string }> };

export default async function ConversationPage({ params }: Props) {
  const { conversationId } = await params;
  return (
    <ConversationThread
      conversationId={conversationId as Id<"conversations">}
    />
  );
}
