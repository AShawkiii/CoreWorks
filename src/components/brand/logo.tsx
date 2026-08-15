import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** Organization logo URL; falls back to the CoreWorks mark when absent (master prompt §29). */
  logoUrl?: string | null;
  /** Organization name; falls back to "CoreWorks". */
  name?: string | null;
  showWordmark?: boolean;
}

/**
 * The CoreWorks mark: interlocking blocks suggesting assembled work.
 * Drawn with `currentColor` so it inherits whatever surface it sits on.
 */
function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <rect
        x="2.5"
        y="2.5"
        width="8.5"
        height="8.5"
        rx="2"
        fill="currentColor"
      />
      <rect
        x="13"
        y="2.5"
        width="8.5"
        height="8.5"
        rx="2"
        fill="currentColor"
        opacity="0.55"
      />
      <rect
        x="2.5"
        y="13"
        width="8.5"
        height="8.5"
        rx="2"
        fill="currentColor"
        opacity="0.55"
      />
      <rect
        x="13"
        y="13"
        width="8.5"
        height="8.5"
        rx="2"
        fill="currentColor"
        opacity="0.3"
      />
    </svg>
  );
}

export function Logo({
  className,
  logoUrl,
  name,
  showWordmark = true,
}: LogoProps) {
  const label = name?.trim() || "CoreWorks";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- organization logos are arbitrary external URLs
        <img
          src={logoUrl}
          alt=""
          className="size-6 rounded object-contain"
          aria-hidden="true"
        />
      ) : (
        <Mark className="text-primary" />
      )}
      {showWordmark ? (
        <span className="text-[15px] font-semibold tracking-tight">
          {label}
        </span>
      ) : null}
      <span className="sr-only">{label}</span>
    </span>
  );
}
