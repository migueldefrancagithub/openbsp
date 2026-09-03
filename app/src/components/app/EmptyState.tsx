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
      <div className="mb-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-surface-2">
          <Icon size={22} className="text-ink" strokeWidth={2} />
        </div>
      </div>
      <h2 className="font-[var(--font-outfit)] text-[22px] font-medium tracking-tight text-ink">
        {title}
      </h2>
      <p className="text-muted text-sm mt-2 max-w-md leading-relaxed">
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
    <div className="flex flex-col gap-4 border-b border-line bg-surface px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 xl:px-8">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-faint font-medium mb-1">
          {eyebrow}
        </div>
        <h1 className="font-[var(--font-outfit)] text-[22px] font-medium tracking-tight text-ink">
          {title}
        </h1>
        <p className="text-muted text-sm mt-0.5">{description}</p>
      </div>
      {action}
    </div>
  );
}
