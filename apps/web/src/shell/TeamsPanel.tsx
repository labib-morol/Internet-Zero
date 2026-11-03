import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { announce, useSessionStore } from "@iz/ui";

/**
 * Teams (§2.1.10, §12): the owner mints an invite code (shown once, stored
 * hashed server-side); a player joins with it and their session rebinds to the
 * team's shared case. Live sync rides the same team event stream as evidence.
 */
export function TeamsPanel(): ReactNode {
  const session = useSessionStore((s) => s.session);
  const switchTeam = useSessionStore((s) => s.switchTeam);
  const [members, setMembers] = useState<Array<{ userId: string; displayName: string; role: string; joinedAt: string }>>([]);
  const [inviteCode, setInviteCode] = useState<string | undefined>(undefined);
  const [joinCode, setJoinCode] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>(undefined);

  const headers = (): Record<string, string> => ({ authorization: `Bearer ${session?.token ?? ""}` });

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/teams/members", { headers: headers() });
      if (!response.ok) throw new Error("Members unavailable.");
      const body = (await response.json()) as { members: typeof members };
      setMembers(body.members);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Members unavailable.");
    }
  }, [session?.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const createInvite = (): void => {
    void fetch("/api/teams/invite", { method: "POST", headers: { ...headers(), "content-type": "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Invite could not be created.");
        const body = (await response.json()) as { code: string };
        setInviteCode(body.code);
        announce("Invite code created. Share it with your teammate.");
      })
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : "Invite unavailable."));
  };

  const join = (event: FormEvent): void => {
    event.preventDefault();
    const code = joinCode.trim();
    if (code.length < 8) return;
    void fetch("/api/teams/join", { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ code }) })
      .then(async (response) => {
        const body = (await response.json()) as { teamId?: string; error?: string };
        if (!response.ok || body.teamId === undefined) throw new Error(body.error ?? "Could not join.");
        setJoinCode("");
        await switchTeam(body.teamId);
        await load();
      })
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : "Could not join."));
  };

  return (
    <section aria-label="Team" style={{ padding: 12 }}>
      <h2>Team</h2>
      <p>Up to six players share one case: the same evidence, gates and score.</p>
      <ul aria-label="Team members">
        {members.map((m) => (
          <li key={m.userId}>
            {m.displayName} — {m.role}
          </li>
        ))}
      </ul>
      {inviteCode === undefined ? (
        <button type="button" className="iz-btn" onClick={createInvite}>
          Create invite code
        </button>
      ) : (
        <p>
          Invite code (shown once): <code className="iz-nb__mono">{inviteCode}</code>
        </p>
      )}
      <form onSubmit={join} style={{ marginTop: 10 }}>
        <label>
          Join with an invite code
          <input
            className="iz-input"
            value={joinCode}
            maxLength={16}
            minLength={8}
            onChange={(e) => setJoinCode(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="iz-btn" disabled={joinCode.trim().length < 8}>
          Join team
        </button>
      </form>
      <p role="status">{feedback ?? ""}</p>
    </section>
  );
}
