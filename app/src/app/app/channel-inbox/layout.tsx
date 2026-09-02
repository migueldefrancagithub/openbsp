import { ReactNode, Suspense } from "react";
import { ChannelThreadList } from "@/components/channel-inbox/ChannelThreadList";

export default function ChannelInboxLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-[520px] overflow-hidden lg:h-full lg:min-h-0">
      {/* Next 16: useSearchParams inside a client component needs a Suspense boundary. */}
      <Suspense fallback={<div className="w-full shrink-0 border-r border-slate-200 bg-white sm:w-[360px]" />}>
        <ChannelThreadList />
      </Suspense>
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
