import { Inbox } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function InboxPage() {
  return (
    <>
      <PageHeader
        eyebrow="Conversations"
        title="Inbox"
        description="Realtime WhatsApp conversations with your contacts."
      />
      <EmptyState
        icon={Inbox}
        title="No conversations yet"
        description="Connect a WhatsApp Business number in Settings, then incoming messages will stream in here automatically via Convex reactive queries."
      />
    </>
  );
}
