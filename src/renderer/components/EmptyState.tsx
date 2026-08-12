import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="yz-card p-10 flex flex-col items-center text-center animate-fade-in">
      <div className="w-12 h-12 rounded-xl bg-noxara-elevated border border-noxara-border flex items-center justify-center mb-4">
        <Icon size={22} className="text-noxara-muted" strokeWidth={1.75} />
      </div>
      <p className="text-sm text-noxara-text font-medium mb-1">{title}</p>
      {description && <p className="text-sm text-noxara-muted mb-5 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}
