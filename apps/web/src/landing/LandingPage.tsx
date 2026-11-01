import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, useSessionStore } from "@iz/ui";

/**
 * Landing page (§11.3): one sentence, one primary button, guest start with no
 * signup wall, recovery-code handoff (shown once by the shell), a resume path
 * for returning players, and the three secondary sections.
 *
 * GET /api/worlds requires a session (guarded /api subtree), so the CTA starts
 * the PUBLIC TUTORIAL by its stable world id (worlds/tutorial/world.yaml) and
 * the catalogue is loaded once the session exists.
 */
const TUTORIAL_WORLD_ID = "tutorial";

export function LandingPage(): ReactNode {
  const worlds = useSessionStore((s) => s.worlds);
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const startGuest = useSessionStore((s) => s.startGuest);
  const resume = useSessionStore((s) => s.resume);
  const loadWorlds = useSessionStore((s) => s.loadWorlds);

  const [recoveryCode, setRecoveryCode] = useState("");

  useEffect(() => {
    // Best effort: in deployments where the catalogue is public we can show
    // the world's title; a 401 here is normal and the CTA still works.
    void loadWorlds().catch(() => undefined);
  }, [loadWorlds]);

  const world = worlds[0];
  const starting = status === "starting";

  const onStart = (): void => {
    void startGuest(world?.worldId ?? TUTORIAL_WORLD_ID);
  };

  const onResume = (event: FormEvent): void => {
    event.preventDefault();
    if (recoveryCode.trim().length > 0) void resume(recoveryCode);
  };

  return (
    <div className="iz-root iz-landing">
      <header className="iz-landing__top">
        <span className="iz-menubar__brand">INTRANET ZERO</span>
        <span style={{ color: "var(--iz-faint)", fontSize: 12.5 }}>the internet is your crime scene</span>
        <span className="iz-menubar__spacer" />
        <nav aria-label="Site links" style={{ display: "flex", gap: 14 }}>
          <a href="#" style={{ color: "var(--iz-dim)", fontSize: 13 }}>
            GitHub
          </a>
          <a href="#" style={{ color: "var(--iz-dim)", fontSize: 13 }}>
            MCP docs
          </a>
        </nav>
      </header>

      <main className="iz-landing__main">
        <p className="iz-landing__kicker">CASE 0 — a company that no longer exists</p>
        <div className="iz-landing__filecard">
          <span className="iz-landing__filetab">OPEN CASE</span>
          <div className="iz-landing__filebody">
            <h1 className="iz-landing__lede">
              A dead company's servers just woke up. Find out why.
            </h1>
            <p className="iz-landing__worldnote">
              {world !== undefined ? (
                <>
                  First case: <strong>{world.title}</strong> — {world.summary}
                </>
              ) : (
                "First case: the public tutorial. The catalogue unlocks once your session exists."
              )}
            </p>
            <div className="iz-landing__cta-row">
              <Button variant="primary" className="iz-landing__cta" onClick={onStart} disabled={starting}>
                {starting ? "Opening…" : "Open the case"}
              </Button>
              <span style={{ color: "var(--iz-faint)", fontSize: 12.5 }}>
                Runs as a guest. No account, no signup — a recovery code is your only key.
              </span>
            </div>
            {error !== undefined && (
              <p role="alert" style={{ color: "var(--iz-bad)", fontSize: 13, marginBottom: 0 }}>
                {error}
              </p>
            )}
          </div>
        </div>

        <form onSubmit={onResume} style={{ marginTop: 18, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor="iz-resume-code" style={{ fontSize: 13, color: "var(--iz-dim)" }}>
            Returning? Resume with a recovery code:
          </label>
          <input
            id="iz-resume-code"
            className="iz-input"
            style={{ width: 220, fontFamily: "var(--iz-font-mono)" }}
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="16-character code"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" disabled={starting || recoveryCode.trim().length < 8}>
            Resume
          </Button>
        </form>

        <div className="iz-landing__sections">
          <section className="iz-landing__section">
            <h2>Play with friends</h2>
            <p>
              Investigations are shared per team — up to six players on one case stream. Team invite
              links arrive with the next milestone.
            </p>
          </section>
          <section className="iz-landing__section">
            <h2>Build your own world</h2>
            <p>
              The engine and world format are open source. Fork the repo, build a world from YAML, and
              your intranet comes alive.{" "}
              <a href="#" aria-label="INTRANET ZERO on GitHub (placeholder link)">
                GitHub →
              </a>
            </p>
          </section>
          <section className="iz-landing__section">
            <h2>For agent researchers</h2>
            <p>
              The same worlds are playable over MCP with exactly a player's permissions — a benchmark
              you can score.{" "}
              <a href="#" aria-label="MCP documentation (placeholder link)">
                MCP docs →
              </a>
            </p>
          </section>
        </div>
      </main>

      <footer className="iz-landing__foot">
        <span>Engine Apache-2.0 · sample worlds CC BY 4.0</span>
        <a href="#">Source</a>
        <a href="#">Documentation</a>
        <span>
          {world === undefined
            ? "Runs entirely on a private server. Nothing leaves it."
            : "Case catalogue loaded. Runs entirely on a private server."}
        </span>
      </footer>
    </div>
  );
}
