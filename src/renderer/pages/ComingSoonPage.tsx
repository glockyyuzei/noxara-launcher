import { Construction } from "lucide-react";

export default function ComingSoonPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="h-full flex items-center justify-center px-8">
      <div className="yz-card p-12 flex flex-col items-center text-center max-w-md animate-fade-in">
        <div className="w-12 h-12 rounded-xl bg-noxara-elevated border border-noxara-border flex items-center justify-center mb-4">
          <Construction size={22} className="text-noxara-muted" strokeWidth={1.75} />
        </div>
        <h1 className="text-lg font-semibold text-noxara-text">{title}</h1>
        <p className="text-sm text-noxara-muted mt-2">
          This section is scaffolded but not implemented yet. Nothing here is faked; it simply
          doesn't exist yet.
        </p>
        <span className="yz-label mt-5">Scheduled for {phase}</span>
      </div>
    </div>
  );
}
