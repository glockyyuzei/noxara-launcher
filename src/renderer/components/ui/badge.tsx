import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export type BadgeVariant = "default" | "secondary" | "success" | "outline" | "destructive";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-noxara-white text-noxara-black border-transparent",
  secondary: "bg-noxara-elevated text-noxara-subtle border-noxara-border",
  success: "bg-noxara-success/10 text-noxara-success border-noxara-success/25",
  outline: "bg-transparent text-noxara-muted border-noxara-border",
  destructive: "bg-noxara-error/10 text-noxara-error border-noxara-error/25",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/** shadcn-style Badge: small pill for status/labels. Never the sole signal for an
 * important state (e.g. "Applied") — pair with an icon or explicit copy too, per
 * accessibility guidance (don't rely purely on color). */
export function Badge({ variant = "default", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        VARIANT_CLASSES[variant],
        className
      )}
      {...props}
    />
  );
}
