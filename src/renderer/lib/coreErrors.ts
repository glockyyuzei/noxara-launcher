/**
 * Renders noxara-core error codes (and the timeout/network errors the main process
 * turns into plain IPC Error messages) into a short, actionable explanation the UI
 * can surface in toasts and inline errors.
 */
export interface FriendlyError {
  title: string;
  detail: string;
  /** True when retrying the same action is a reasonable next step. */
  retryable: boolean;
}

export function friendlyCoreError(err: unknown): FriendlyError {
  let message = err instanceof Error ? err.message : String(err);
  // Electron wraps IPC handler failures as "Error invoking remote method '<channel>':
  // <inner message>". Strip the wrapper so the underlying reason is what we classify
  // and show — never expose the raw "invoking remote method" boilerplate to the user.
  message = message.replace(/^Error invoking remote method '[^']*':\s*/i, "").trim();
  const m = message.toLowerCase();

  if (m.includes("did not respond in time") || m.includes("timed out") || m.includes("timeout")) {
    return {
      title: "Request timed out",
      detail: "A network request took too long. This can happen on slow connections or when the service is busy — try again.",
      retryable: true,
    };
  }
  if (
    m.includes("network") ||
    m.includes("fetch") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("connection")
  ) {
    return {
      title: "Network problem",
      detail: "The launcher couldn't reach the server it needed. Check your internet connection and try again.",
      retryable: true,
    };
  }
  if (m.includes("cancelled") || m.includes("cancel")) {
    return { title: "Cancelled", detail: "The operation was cancelled.", retryable: true };
  }
  if (m.includes("no xbox profile") || m.includes("child account")) {
    return { title: "Microsoft account issue", detail: message, retryable: false };
  }
  if (m.includes("does not own minecraft")) {
    return {
      title: "Minecraft not owned",
      detail: "This Microsoft account doesn't own Minecraft: Java Edition, so it can't be used to play.",
      retryable: false,
    };
  }
  if (m.includes("bad request") || m.includes("invalid") || m.includes("not found") || m.includes("unsupported")) {
    return { title: "The request couldn't be completed", detail: message, retryable: false };
  }

  return { title: "Something went wrong", detail: message, retryable: false };
}

/** The full message to show inline (e.g. under a failed action). */
export function friendlyErrorMessage(err: unknown): string {
  const f = friendlyCoreError(err);
  return `${f.title}. ${f.detail}`;
}