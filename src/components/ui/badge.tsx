import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Health variants map to the domain-semantic tokens in globals.css, so a
 * Delayed badge stays legible in both light and dark without a second
 * component (audit §5 defines the four health states).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-border bg-muted text-muted-foreground",
        primary: "border-transparent bg-primary/10 text-primary",
        success: "border-transparent bg-success/10 text-success",
        warning: "border-transparent bg-warning/15 text-warning",
        danger: "border-transparent bg-danger/10 text-danger",
        outline: "border-border bg-transparent text-foreground",
        onTrack:
          "border-transparent bg-health-on-track text-health-on-track-fg",
        atRisk: "border-transparent bg-health-at-risk text-health-at-risk-fg",
        delayed: "border-transparent bg-health-delayed text-health-delayed-fg",
        onHold: "border-transparent bg-health-on-hold text-health-on-hold-fg",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
