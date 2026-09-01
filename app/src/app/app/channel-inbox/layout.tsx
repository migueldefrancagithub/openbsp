import { ReactNode } from "react";
import { ChannelThreadList } from "@/components/channel-inbox/ChannelThreadList";

export default function ChannelInboxLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-[520px] overflow-hidden lg:h-screen lg:min-h-0">
      <ChannelThreadList />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
