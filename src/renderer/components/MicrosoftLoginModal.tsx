import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { AccountRecord } from "@shared/types/ipc";
import { friendlyErrorMessage } from "../lib/coreErrors";

type Phase = "starting" | "waiting" | "finishing" | "error";

export function MicrosoftLoginModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (account: AccountRecord) => void;
}) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return; // React 18 StrictMode double-invokes effects in dev
    startedRef.current = true;

    (async () => {
      try {
        const info = await window.noxara.startMicrosoftLogin();
        setUserCode(info.userCode);
        setVerificationUri(info.verificationUri);
        setPhase("waiting");

        const account = await window.noxara.completeMicrosoftLogin(
          info.deviceCode,
          info.pollIntervalSeconds,
          info.expiresInSeconds
        );
        setPhase("finishing");
        onSuccess(account);
      } catch (e) {
        setError(friendlyErrorMessage(e));
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8 animate-fade-in">
      <div className="yz-card w-full max-w-sm p-6 animate-modal-in text-center">
        <h2 className="text-sm font-semibold mb-4">Microsoft Sign-In</h2>

        {phase === "starting" && <p className="text-sm text-noxara-muted">Contacting Microsoft…</p>}

        {(phase === "waiting" || phase === "finishing") && userCode && verificationUri && (
          <>
            <p className="text-xs text-noxara-muted mb-3">
              Open the Microsoft login page and enter this code:
            </p>
            <div className="yz-input font-mono text-lg tracking-widest text-center py-3 mb-3 select-all">
              {userCode}
            </div>
            <button
              onClick={() => window.noxara.openExternal(verificationUri)}
              className="yz-btn-primary w-full mb-4"
            >
              <ExternalLink size={15} />
              Open Microsoft Login
            </button>
            <div className="flex items-center justify-center gap-2 text-xs text-noxara-muted">
              {phase === "waiting" ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-noxara-warning animate-pulse" />
                  Waiting for sign-in…
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-noxara-success" />
                  Verifying your Minecraft account…
                </>
              )}
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <p className="text-sm text-noxara-error mb-4">{error}</p>
            <button onClick={onClose} className="yz-btn-secondary w-full">
              Close
            </button>
          </>
        )}

        {phase !== "error" && (
          <button onClick={onClose} className="yz-btn-ghost w-full mt-4 text-xs">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
