import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "default" | "lg" | "icon";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "yz-btn-primary",
  secondary: "yz-btn-secondary",
  ghost: "yz-btn-ghost",
  danger: "yz-btn-danger",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1.5",
  default: "text-sm px-4 py-2",
  lg: "text-sm px-5 py-2.5",
  icon: "p-2 aspect-square",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** shadcn-style Button API on top of Noxara's existing `.yz-btn-*` utility classes —
 * same visual system, just with a typed variant/size prop instead of hand-written
 * className strings, so new call sites don't have to remember the exact class names. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "default", className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(VARIANT_CLASSES[variant], SIZE_CLASSES[size], "yz-focus-ring", className)}
      {...props}
    />
  );
});
