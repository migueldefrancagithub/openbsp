import { ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-6">
      <div className="relative mb-5">
        <div
          className="absolute inset-0 rounded-2xl opacity-40"
          style={{
            background:
              "linear-gradient(137deg, #FF3D77 0%, #06B6D4 50%, #4361EE 100%)",
            filter: "blur(24px)",
          }}
        />
        <div className="relative w-14 h-14 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-sm">
          <Icon size={22} className="text-[#0a1b33]" strokeWidth={2} />
        </div>
      </div>
      <h2 className="font-[var(--font-outfit)] text-[22px] font-medium tracking-tight text-[#0a1b33]">
        {title}
      </h2>
      <p className="text-slate-500 text-sm mt-2 max-w-md leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-8 py-6 border-b border-slate-200 bg-white flex items-center justify-between gap-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-medium mb-1">
          {eyebrow}
        </div>
        <h1 className="font-[var(--font-outfit)] text-[22px] font-medium tracking-tight text-[#0a1b33]">
          {title}
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">{description}</p>
      </div>
      {action}
    </div>
  );
}
