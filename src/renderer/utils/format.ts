export function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSpeed(bytesPerSec: number | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}