import { Blocks, Layers, Anvil, Grid3x3, Package, type LucideIcon } from "lucide-react";

/**
 * Plain black cover for an instance card. The only content is a centered,
 * muted-white loader logo chosen from the instance's actual loader — no
 * gradients, patterns, textures, or decorative backgrounds.
 */
const LOADER_LOGOS: Record<string, LucideIcon> = {
  vanilla: Blocks,
  fabric: Layers,
  forge: Anvil,
  neoforge: Anvil,
  quilt: Grid3x3,
};
const DEFAULT_LOGO: LucideIcon = Package;

export function InstanceCover({
  loader,
  className = "",
  compact = false,
}: {
  loader?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const Logo = LOADER_LOGOS[loader?.toLowerCase() ?? ""] ?? DEFAULT_LOGO;

  return (
    <div className={`relative overflow-hidden bg-noxara-black ${className}`}>
      <div className="absolute inset-0 flex items-center justify-center">
        <Logo
          size={compact ? 24 : 48}
          strokeWidth={1.5}
          className="text-noxara-white/60"
        />
      </div>
    </div>
  );
}
