import { ReactNode } from "react";
import { ConversationList } from "@/components/inbox/ConversationList";

export default function InboxLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen">
      <ConversationList />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
