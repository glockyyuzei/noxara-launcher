/**
 * Generates a deterministic monochrome gradient "cover" for an instance, similar in
 * spirit to GDLauncher/Prism's modpack banner cards, but original artwork (no image
 * assets, no borrowed branding) — just a seeded gradient + the instance's initial.
 */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const ANGLE_STEPS = [45, 90, 135, 160, 200, 225, 270, 315];

export function InstanceCover({
  name,
  className = "",
  compact = false,
}: {
  name: string;
  className?: string;
  compact?: boolean;
}) {
  const seed = hashString(name || "?");
  const angle = ANGLE_STEPS[seed % ANGLE_STEPS.length];
  const lightness1 = 14 + (seed % 10); // stays dark/monochrome, subtle variation
  const lightness2 = 22 + ((seed >> 3) % 14);
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();

  return (
    <div
      className={`relative overflow-hidden rounded-md border border-noxara-border ${className}`}
      style={{
        background: `linear-gradient(${angle}deg, hsl(0 0% ${lightness1}%), hsl(0 0% ${lightness2}%))`,
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 1px, transparent 12px)",
        }}
      />
      <div
        className={`relative flex items-center justify-center h-full font-semibold text-noxara-white/90 ${
          compact ? "text-lg" : "text-4xl"
        }`}
      >
        {initial}
      </div>
    </div>
  );
}
