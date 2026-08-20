import { ReactNode } from "react";
import { ChannelThreadList } from "@/components/channel-inbox/ChannelThreadList";

export default function ChannelInboxLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <ChannelThreadList />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
