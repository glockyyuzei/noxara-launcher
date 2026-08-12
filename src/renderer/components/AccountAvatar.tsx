import { useEffect, useState } from "react";
import type { AccountRecord } from "@shared/types/ipc";

const PALETTE = [
  "#7c5cff",
  "#4ade80",
  "#f59e0b",
  "#f87171",
  "#38bdf8",
  "#e879f9",
  "#fb923c",
  "#34d399",
];

/** Deterministic color from uuid so the same account always gets the same swatch. */
function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function AccountAvatar({
  account,
  size = 32,
  className = "",
  onError,
}: {
  account: Pick<AccountRecord, "username" | "uuid" | "avatarUrl"> | null;
  size?: number;
  className?: string;
  /** Invoked when the avatar image fails to load (e.g. the URL went stale) so the
   * caller can refresh the account's profile and try again. */
  onError?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const avatarUrl = account?.avatarUrl ?? null;

  // A refreshed profile brings a new URL — reset any failed state so it retries.
  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  if (!account) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`rounded bg-noxara-elevated border border-noxara-border flex items-center justify-center text-noxara-muted shrink-0 ${className}`}
      >
        ?
      </div>
    );
  }

  const bg = colorFor(account.uuid || account.username);

  // Only render an <img> while we have a URL and it hasn't failed. A failed image
  // immediately swaps to the initial fallback so the UI never shows a broken image.
  if (avatarUrl && !failed) {
    return (
      <img
        key={avatarUrl}
        src={avatarUrl}
        alt={`${account.username} avatar`}
        referrerPolicy="no-referrer"
        decoding="async"
        loading="lazy"
        onError={() => {
          setFailed(true);
          onError?.();
        }}
        style={{ width: size, height: size }}
        className={`rounded object-cover border border-noxara-border shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, backgroundColor: `${bg}26`, color: bg, borderColor: `${bg}40` }}
      className={`rounded border flex items-center justify-center font-semibold shrink-0 ${className}`}
    >
      <span style={{ fontSize: size * 0.42 }}>{account.username.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}