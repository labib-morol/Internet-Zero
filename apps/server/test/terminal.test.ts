import { describe, expect, it } from "vitest";
import {
  createGuestSession,
  createTestApp,
  postgresUp,
} from "./helpers.js";

const pgUp = await postgresUp();

/**
 * Full tutorial playthrough over REST, with the terminal as the final stage:
 * the server-side twin of the M0 headless playthrough. Proves the §10.5
 * passphrase gate, command interpretation, TerminalRead/OverlayWrite
 * persistence and overlay reads against the real compiled world.
 */
describe.skipIf(!pgUp)("tutorial over REST with the terminal as final stage", () => {
  it("gates the terminal on its passphrase, then interprets commands", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app, "tutorial");
      const auth = { authorization: `Bearer ${session.sessionToken}` };
      const act = async (action: Record<string, unknown>) => {
        const res = await env.app.inject({
          method: "POST",
          url: "/api/actions",
          headers: auth,
          payload: { action },
        });
        expect(res.statusCode, `${action.type} -> ${res.statusCode} ${res.body.slice(0, 200)}`).toBe(200);
        const body = res.json();
        if (body.rejection !== undefined) {
          throw new Error(`${action.type} rejected: ${JSON.stringify(body.rejection)} action=${JSON.stringify(action).slice(0, 160)}`);
        }
        return body;
      };

      // Stage 1: find the rotation commit the way a player would, collect it.
      const openRepo = await act({ type: "open", url: "forge.pinecone.pcp/pinecone/office-scripts" });
      expect(openRepo.rejection).toBeUndefined();
      const mailHost = 'mail.pinecone.pcp';

      // Discover the commit artifact id via the repo's commit list view.
      const commits = await env.app.inject({
        method: "GET",
        url: "/api/view?host=forge.pinecone.pcp&path=/pinecone/office-scripts/commits",
        headers: auth,
      });
      const commitSummaries = commits.json().view.commits as Array<{ sha: string; message: string }>;
      expect(commitSummaries.length).toBeGreaterThan(0);
      const rotation = commitSummaries.find((c) => c.message.includes("rotate printer admin pass"))!;
      const collected = await act({ type: "collect", artifactId: `a.${rotation.sha}` });
      expect(collected.rejection, JSON.stringify(collected).slice(0, 300)).toBeUndefined();
      // The evidenceSet gate materializes in the next fold (implicit gates),
      // so assert the solved state rather than the collect response.
      const afterCollect = await env.app.inject({ method: "GET", url: "/api/state", headers: auth });
      expect(Object.keys(afterCollect.json().state.solvedGates)).toContain("g.first-commit");

      // Stage 2: the mail host unlocks; collect the hint mail.
      const mailOpen = await act({ type: "open", url: `${mailHost}/` });
      expect(mailOpen.rejection).toBeUndefined();

      // Stage 3: file the report (identity slot accepts the display name).
      const report = await act({
        type: "submitReport",
        reportId: "r.who-holds",
        groupId: "A",
        slots: { "s.holder": "Odile Brandt", "s.clue-kind": "two facts combined" },
      });
      expect(report.events.some((e: { type: string }) => e.type === "ReportGroupAccepted")).toBe(true);

      // Stage 4: the printer terminal is reachable but passphrase-gated.
      const gated = await act({ type: "terminal", host: "printer.pinecone.pcp", cwd: "/", line: "ls" });
      expect(gated.result.connect).toMatchObject({ target: "printer.pinecone.pcp", gateId: "g.printer", connected: false });
      expect(gated.events).toEqual([]);

      // Deliberate wrong answer: bypass the throwing helper.
      const wrong = await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: auth,
        payload: { action: { type: "submitAnswer", gateId: "g.printer", answer: "letmein" } },
      });
      expect(wrong.json().rejection?.code).toBe("invalid_input");

      const solved = await act({ type: "submitAnswer", gateId: "g.printer", answer: "biscuit2009" });
      expect(solved.rejection).toBeUndefined();

      // Commands now interpret against the world fs; reads persist.
      const cat = await act({ type: "terminal", host: "printer.pinecone.pcp", cwd: "/", line: "cat /etc/motd" });
      expect(cat.result.output).not.toBe("");
      expect(cat.events.some((e: { type: string }) => e.type === "TerminalRead")).toBe(true);

      const write = await act({ type: "terminal", host: "printer.pinecone.pcp", cwd: "/", line: "cat /etc/motd > notes/motd-copy.txt" });
      expect(write.events.some((e: { type: string; content?: string }) => e.type === "TerminalOverlayWrite" && (e.content ?? "").length > 0)).toBe(true);
      const readBack = await act({ type: "terminal", host: "printer.pinecone.pcp", cwd: "/", line: "cat notes/motd-copy.txt" });
      expect(readBack.result.output).toBe(cat.result.output);

      // The world is complete: report accepted, all gates solved.
      const state = await env.app.inject({ method: "GET", url: "/api/state", headers: auth });
      const wire = state.json().state;
      expect(Object.keys(wire.solvedGates).sort()).toEqual(["g.first-commit", "g.mailbox", "g.printer"]);
      expect(wire.score).toBe(300);
    } finally {
      await env.close();
    }
  });
});
