import { describe, expect, it } from "vitest";
import { FORGE_SERVICE } from "@iz/services";
import { initialState } from "@iz/runtime";
import { compileMarkdown } from "@iz/services";
import { bearer, createGuestSession, createTestApp, postgresUp } from "./helpers.js";

/**
 * Audit: (1) archive search crashed with URIError on a bare "%" path segment;
 * (2) issue-detail reused the whole issue AST per comment, rendering the full
 * thread once per comment.
 */

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("view builder audit fixes", () => {
  it("archive search tolerates a bare % and returns the raw query", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const bundle = env.ctx.bundles.get("fixture")!;
      const archiveHost = bundle.world.hosts.find((h) => h.service === "archive")!.host;
      // The fixture gates the archive host behind g.files; the audit target is
      // the search path itself, so unlock the host for this test only.
      const archiveDef = bundle.world.hosts.find((h) => h.host === archiveHost)!;
      const originalRequires = archiveDef.requires;
      archiveDef.requires = undefined;
      try {
        const res = await env.app.inject({
          method: "GET",
          url: `/api/view?host=${archiveHost}&path=${encodeURIComponent("/search/100%")}`,
          headers: bearer(session.sessionToken),
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().view).toMatchObject({ view: "archive-search", query: "100%" });
      } finally {
        archiveDef.requires = originalRequires;
      }
    } finally {
      await env.close();
    }
  });

  it("issue-detail comments render their own body, not the whole thread", async () => {
    const env = await createTestApp();
    try {
      const bundle = env.ctx.bundles.get("fixture")!;
      const forgeHost = bundle.world.hosts.find((h) => h.service === "forge")!.host;
      const repo = bundle.forge[0]!;
      repo.issues.push({
        number: 7,
        title: "Printer rejects password",
        state: "open",
        body: "It fails.",
        author: "id.jamie-git",
        date: "2026-11-01T09:00:00Z",
        comments: [{ author: "id.jamie-git", date: "2026-11-01T10:00:00Z", body: "Looking into it." }],
      });
      bundle.artifacts.push({
        id: "a.issue7",
        host: forgeHost,
        path: "acme/notes/issues/7",
        kind: "issue",
        title: "Printer rejects password",
        body: "It fails.\n\nLooking into it.",
        ast: compileMarkdown("It fails.\n\nLooking into it."),
        meta: {},
        collectible: false,
      });
      const state = initialState(bundle, "team.audit", "2026-11-02T09:00:00Z");
      const view = FORGE_SERVICE.view(bundle, state, forgeHost, "/acme/notes/issues/7", "2026-11-02T10:00:00Z");
      if (!("view" in view) || view.view !== "issue-detail") throw new Error("expected issue-detail view");
      expect(view.issue.comments).toHaveLength(1);
      const commentJson = JSON.stringify(view.issue.comments[0]?.ast);
      expect(commentJson).toContain("Looking into it.");
      expect(commentJson).not.toContain("It fails.");
      expect(JSON.stringify(view.issue.ast)).toContain("It fails.");
    } finally {
      await env.close();
    }
  });
});
