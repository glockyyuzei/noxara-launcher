import { Construction } from "lucide-react";

export default function ComingSoonPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
      <Construction size={28} className="text-noxara-muted" />
      <h1 className="text-lg font-semibold text-noxara-text">{title}</h1>
      <p className="text-sm text-noxara-muted max-w-sm">
        This section is scaffolded but not implemented yet — it's scheduled for {phase} of the
        Noxara Launcher roadmap. Nothing here is faked; it simply doesn't exist yet.
      </p>
    </div>
  );
}
