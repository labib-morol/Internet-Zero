import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WorldBundle, type RuntimeState, type WorldBundle as Bundle } from "@iz/schema";
import { fold, sessionStartEvent } from "@iz/runtime";
import {
  forgeView,
  forgeCollectibles,
  mailView,
  mailCollectibles,
  archiveView,
  archiveCollectibles,
  terminalView,
} from "@iz/services";

const NOW = "2026-11-02T09:00:00.000Z";
const bundle: Bundle = WorldBundle.parse(
  JSON.parse(readFileSync(resolve("packages/services/test/fixtures/fixture@0.1.0.json"), "utf8"))
);

/**
 * The fixture's mail and archive hosts sit behind gates, so build the state a
 * player would have: solve the fixture's answer gate (its plaintext lives in
 * the fixture world source, which is a public test fixture) and record the
 * terminal read that satisfies g.files.
 */
function state(): RuntimeState {
  const log = [
    sessionStartEvent(bundle, "team-views", NOW, { userId: "u1", kind: "human" }),
    {
      type: "GateSolved",
      gateId: "g.first-commit",
      score: 100,
      at: NOW,
      by: "u1",
      actorKind: "human",
    },
    {
      type: "TerminalRead",
      host: "term.fix.pcp",
      path: "/etc/printers.conf",
      at: NOW,
      by: "u1",
      actorKind: "human",
    },
    {
      type: "GateSolved",
      gateId: "g.files",
      score: 100,
      at: NOW,
      by: "u1",
      actorKind: "human",
    },
  ] as const;
  return fold(bundle, [...log]);
}

const forgeHost = bundle.world.hosts.find((h) => h.service === "forge")!.host;
const mailHost = bundle.world.hosts.find((h) => h.service === "mail")!.host;
const archiveHost = bundle.world.hosts.find((h) => h.service === "archive")!.host;
const termHost = bundle.world.hosts.find((h) => h.service === "terminal")!.host;
const repo = bundle.forge[0]!;
const firstCommit = repo.commits[0]!;
const mailbox = bundle.mailboxes[0]!;
const firstMessage = mailbox.messages[0]!;

describe("forge views", () => {
  it("renders the repo home from structured source data", () => {
    const v = forgeView(bundle, state(), forgeHost, `/${repo.owner}/${repo.name}`, NOW);
    expect(v).toMatchObject({ view: "repo-home", owner: repo.owner, name: repo.name });
    if (v.view !== "repo-home") return;
    expect(v.recentCommits[0]!.sha).toBe(firstCommit.sha);
    expect(v.artifactId).toBeTypeOf("string");
    expect(forgeCollectibles(v)).toEqual([{ artifactId: v.artifactId, label: "Repository" }]);
  });

  it("renders commit detail with changes and signature data", () => {
    const v = forgeView(bundle, state(), forgeHost, `/${repo.owner}/${repo.name}/commit/${firstCommit.sha}`, NOW);
    expect(v.view).toBe("commit-detail");
    if (v.view !== "commit-detail") return;
    expect(v.commit.changes.length).toBe(firstCommit.changes.length);
    expect(v.commit.committer.host).toBeTypeOf("string");
    expect(v.artifactId).toBe(`a.${firstCommit.sha}`);
  });

  it("renders the file tree computed from the change list", () => {
    const v = forgeView(bundle, state(), forgeHost, `/${repo.owner}/${repo.name}/tree/${firstCommit.sha}`, NOW);
    expect(v.view).toBe("file-browser");
    if (v.view !== "file-browser") return;
    expect(v.entries.length).toBe(firstCommit.changes.length);
    const file = v.entries.find((e) => e.kind === "file");
    if (file !== undefined) {
      const full = forgeView(bundle, state(), forgeHost, `/${repo.owner}/${repo.name}/tree/${firstCommit.sha}/${file.name}`, NOW);
      expect(full.view).toBe("file-browser");
    }
  });

  it("returns the indistinguishable not-found for unknown pages", () => {
    expect(forgeView(bundle, state(), forgeHost, `/${repo.owner}/${repo.name}/commit/${"0".repeat(40)}`, NOW)).toEqual({
      notFound: true,
      host: forgeHost,
      path: `/${repo.owner}/${repo.name}/commit/${"0".repeat(40)}`,
    });
  });
});

describe("mail views", () => {
  it("lists threads only from visible messages", () => {
    const v = mailView(bundle, state(), mailHost, `/${mailbox.id}`, NOW);
    expect(v.view).toBe("mailbox");
    if (v.view !== "mailbox") return;
    expect(v.threads.length).toBeGreaterThan(0);
  });

  it("renders a single message with headers and collectible", () => {
    const v = mailView(bundle, state(), mailHost, `/${mailbox.id}/${firstMessage.folder}/${firstMessage.id}`, NOW);
    expect(v.view).toBe("message");
    if (v.view !== "message") return;
    expect(v.message.artifactId).toBe(firstMessage.id);
    expect(v.message.from.displayName).toBeTypeOf("string");
    expect(mailCollectibles(v)).toEqual([{ artifactId: firstMessage.id, label: v.message.subject }]);
  });

  it("hides messages that are not visible in this state", () => {
    // initialState with zero unlocked: a message whose artifact carries a
    // visibility condition must not appear. The fixture messages are
    // ungated, so assert the mechanism via a hand-locked copy.
    const locked: Bundle = {
      ...bundle,
      artifacts: bundle.artifacts.map((a) =>
        a.id === firstMessage.id ? { ...a, visibility: { teamSizeAtLeast: 2 } } : a
      ),
    };
    // Host reachable (gate solved), but the locked message itself is hidden:
    const alone = fold(locked, [
      sessionStartEvent(locked, "solo", NOW, { userId: "u1", kind: "human" }),
      { type: "GateSolved", gateId: "g.first-commit", score: 100, at: NOW, by: "u1", actorKind: "human" },
    ]);
    const v = mailView(locked, alone, mailHost, `/${mailbox.id}`, NOW);
    if (v.view !== "mailbox") throw new Error("expected mailbox view");
    const subjects = v.threads.map((t) => t.subject);
    expect(subjects).not.toContain(firstMessage.subject);
    // ...and the direct message URL is indistinguishable from missing.
    expect(mailView(locked, alone, mailHost, `/${mailbox.id}/${firstMessage.folder}/${firstMessage.id}`, NOW)).toEqual({
      notFound: true,
      host: mailHost,
      path: `/${mailbox.id}/${firstMessage.folder}/${firstMessage.id}`,
    });
  });
});

describe("archive views", () => {
  it("searches only visible documents and returns documents with metadata", () => {
    const search = archiveView(bundle, state(), archiveHost, "/search/", NOW);
    expect(search.view).toBe("archive-search");
    const anyDoc = bundle.artifacts.find((a) => a.kind === "archive-document");
    if (anyDoc !== undefined) {
      const doc = archiveView(bundle, state(), archiveHost, `/doc/${anyDoc.id}`, NOW);
      expect(doc.view).toBe("archive-document");
      if (doc.view === "archive-document") {
        expect(doc.doc.ast.type).toBe("root");
        expect(archiveCollectibles(doc)).toEqual([{ artifactId: doc.artifactId, label: doc.doc.title }]);
      }
    }
  });
});

describe("terminal views", () => {
  it("initializes a session with the host motd", () => {
    const v = terminalView(bundle, state(), termHost, "/", NOW);
    expect(v.view).toBe("terminal");
    if (v.view !== "terminal") return;
    expect(v.cwd).toBe("/");
    expect(v.passphrasePrompt).toBe(false);
  });
});
