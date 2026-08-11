import type { HTMLAttributes } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "../../lib/utils";

export type AlertVariant = "default" | "success" | "destructive";

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  default: "border-noxara-border bg-noxara-surface text-noxara-subtle",
  success: "border-noxara-success/25 bg-noxara-success/5 text-noxara-text",
  destructive: "border-noxara-error/25 bg-noxara-error/5 text-noxara-text",
};

const VARIANT_ICON: Record<AlertVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  destructive: AlertCircle,
};

const VARIANT_ICON_CLASSES: Record<AlertVariant, string> = {
  default: "text-noxara-subtle",
  success: "text-noxara-success",
  destructive: "text-noxara-error",
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
}

/** shadcn-style Alert: inline banner for status/errors/info that should stay on
 * screen (unlike a toast). Icon + text together — never color alone. */
export function Alert({ variant = "default", title, className, children, ...props }: AlertProps) {
  const Icon = VARIANT_ICON[variant];
  return (
    <div
      role="alert"
      className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed", VARIANT_CLASSES[variant], className)}
      {...props}
    >
      <Icon size={16} className={cn("shrink-0 mt-0.5", VARIANT_ICON_CLASSES[variant])} />
      <div>
        {title && <p className="text-noxara-text font-medium mb-0.5">{title}</p>}
        {children}
      </div>
    </div>
  );
}
