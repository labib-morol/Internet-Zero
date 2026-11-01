import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@iz/ui";

/**
 * One-time recovery code modal (§15/§11.3): shown exactly once after a guest
 * session is created; the code is the ONLY way back into the account. Copy
 * button + explicit acknowledgment; no persistence anywhere.
 */
export function RecoveryModal({ code, onConfirm }: { code: string; onConfirm: () => void }): ReactNode {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard unavailable (permissions/insecure context): fall back to
      // selecting the code so the user can copy manually.
      const range = document.createRange();
      const span = codeRef.current;
      if (span !== null) {
        range.selectNodeContents(span);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopied(false);
    }
  };

  return (
    <div className="iz-modal-backdrop">
      <div className="iz-modal" role="dialog" aria-modal="true" aria-labelledby="iz-recovery-title">
        <div className="iz-modal__head" id="iz-recovery-title">
          Save your recovery code
        </div>
        <div className="iz-modal__body">
          <p style={{ marginTop: 0 }}>
            This is the only way back into your case. It is shown <strong>once</strong> and never
            stored — write it down or copy it somewhere safe.
          </p>
          <div className="iz-recovery-code">
            <span ref={codeRef} tabIndex={-1} style={{ outline: "none" }}>
              {code}
            </span>
            <span className="iz-menubar__spacer" style={{ flex: 1 }} />
            <Button onClick={() => void copy()} aria-label="Copy recovery code">
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p style={{ color: "var(--iz-faint)", fontSize: 12.5, marginBottom: 0 }}>
            Returning later? Use “Resume with a recovery code” on the landing page.
          </p>
        </div>
        <div className="iz-modal__foot">
          <Button variant="primary" onClick={onConfirm}>
            I've saved it — open the desktop
          </Button>
        </div>
      </div>
    </div>
  );
}
