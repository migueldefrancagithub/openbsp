import { cn } from "@/lib/cn";

export const BRAND_NAME = "CXCast";

export function BrandMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("h-7 w-7 shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id="cxcast-mark-bg" x1="7" y1="5" x2="59" y2="62">
          <stop stopColor="#0B1B33" />
          <stop offset="0.58" stopColor="#123A55" />
          <stop offset="1" stopColor="#0EA5A4" />
        </linearGradient>
        <linearGradient id="cxcast-mark-bubble" x1="12" y1="14" x2="46" y2="48">
          <stop stopColor="#C9FFF0" />
          <stop offset="1" stopColor="#3DD7C4" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#cxcast-mark-bg)" />
      <path
        d="M12 23.8C12 17.8 16.8 13 22.8 13h18.4C47.2 13 52 17.8 52 23.8v13.4C52 43.2 47.2 48 41.2 48h-9.4L20 56v-9.2a10.78 10.78 0 0 1-8-10.4V23.8Z"
        fill="url(#cxcast-mark-bubble)"
      />
      <text
        x="31.2"
        y="37.8"
        fill="#0B1B33"
        fontFamily="Inter, Arial, sans-serif"
        fontSize="20"
        fontWeight="900"
        letterSpacing="-2.4"
        textAnchor="middle"
      >
        CX
      </text>
      <path
        d="M46 13.5c4.1 2.2 7.1 5.8 8.4 10.3"
        fill="none"
        stroke="#C9FFF0"
        strokeLinecap="round"
        strokeWidth="3.8"
        opacity="0.92"
      />
      <path
        d="M51 7.7c5 3.1 8.4 7.8 10 13.6"
        fill="none"
        stroke="#FFB46B"
        strokeLinecap="round"
        strokeWidth="2.8"
        opacity="0.78"
      />
    </svg>
  );
}

export function BrandLogo({
  className,
  markClassName,
  textClassName,
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-[var(--font-outfit)] font-semibold tracking-tight text-[#0a1b33]",
        className,
      )}
    >
      <BrandMark className={markClassName} />
      <span className={textClassName}>{BRAND_NAME}</span>
    </span>
  );
}
