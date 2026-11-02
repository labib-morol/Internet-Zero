import { describe, expect, it } from "vitest";
import { FORGE_SERVICE, MAIL_SERVICE, ARCHIVE_SERVICE, TERMINAL_SERVICE } from "../src/index.js";
import { makeCtx, STICKER } from "./helpers.js";
import type { Artifact } from "@iz/schema";

const SHA = "5f2e6a1b3c4d5e6f708192a3b4c5d6e7f8091a2b";

const forgeSource = {
  repos: [
    {
      id: "a.notes",
      owner: "acme",
      name: "notes",
      description: "Office notes.",
      readme: "# acme/notes\n\n[[stamp:INTERNAL]]",
      users: [
        { login: "jamiefox", name: "Jamie Fox", identity: "id.jamie-git" },
      ],
      commits: [
        {
          sha: SHA,
          parents: [],
          author: { name: "Jamie Fox", email: "jamie@acme.pcp", identity: "id.jamie-git" },
          committer: { name: "Acme CI", email: "ci@acme.pcp", host: "forge.fix.pcp" },
          date: "2026-10-28T14:12:00Z",
          message: "Rotate printer password",
          changes: [{ kind: "modify", path: "printer.conf", before: "a=1", after: "a=2" }],
        },
      ],
      issues: [
        {
          number: 1,
          title: "Printer rejects password",
          body: "It fails.",
          author: "id.jamie-git",
          date: "2026-10-29T09:30:00Z",
          comments: [{ author: "id.jamie-git", date: "2026-10-29T10:00:00Z", body: "Looking into it." }],
        },
      ],
    },
  ],
};

describe("FORGE_SERVICE", () => {
  it("produces repo, commit, issue and user artifacts with stable ids and paths", () => {
    const artifacts = FORGE_SERVICE.load(forgeSource, makeCtx());
    const byKind = (kind: Artifact["kind"]): Artifact[] => artifacts.filter((a) => a.kind === kind);
    expect(byKind("repo")).toHaveLength(1);
    expect(byKind("commit")).toHaveLength(1);
    expect(byKind("issue")).toHaveLength(1);
    expect(byKind("user")).toHaveLength(1);

    const repo = byKind("repo")[0]!;
    expect(repo.id).toBe("a.notes");
    expect(repo.path).toBe("acme/notes");
    expect(repo.host).toBe("forge.fix.pcp");
    expect(repo.collectible).toBe(false);

    const commit = byKind("commit")[0]!;
    expect(commit.id).toBe(`a.${SHA}`);
    expect(commit.path).toBe(`acme/notes/commit/${SHA}`);
    expect(commit.kind).toBe("commit");
    expect(commit.collectible).toBe(true);
    expect(commit.meta.repo).toBe("a.notes");
    expect(commit.body).toContain("printer.conf");

    const issue = byKind("issue")[0]!;
    expect(issue.id).toBe("a.notes.issue.1");
    expect(issue.path).toBe("acme/notes/issues/1");
    expect(issue.body).toContain("Jamie Fox: Looking into it.");
    if (issue.ast.type !== 'root') throw new Error('Expected root AST');
    const commentBlock = issue.ast.children.find((n) => n.type === "blockquote");
    expect(commentBlock).toBeDefined();

    const user = byKind("user")[0]!;
    expect(user.id).toBe("a.user.jamiefox");
    expect(user.path).toBe("users/jamiefox");
    expect(user.kind).toBe("user");
  });

  it("rejects content when the world has no forge host", () => {
    const ctx = makeCtx();
    ctx.world.world.hosts = ctx.world.world.hosts.filter((h) => h.service !== "forge");
    expect(() => FORGE_SERVICE.load(forgeSource, ctx)).toThrowError(/no forge host/);
  });
});

describe("MAIL_SERVICE", () => {
  it("produces collectible message artifacts and canonicalizes attachment assets", () => {
    const source = {
      mailboxes: [
        {
          id: "a.mbox",
          owner: "p.jamie",
          messages: [
            {
              id: "a.m-1",
              mailbox: "a.mbox",
              folder: "inbox",
              from: "id.mara-mail",
              to: ["id.jamie-mail"],
              date: "2026-10-29T08:05:00Z",
              subject: "printer",
              body: "See [[redaction:HR case|removable]]",
              attachments: [{ asset: "assets/sticker.png", filename: "sticker.png", redactions: [] }],
              headers: { "X-Mailer": "DEADLETTER" },
            },
          ],
        },
      ],
    };
    const artifacts = MAIL_SERVICE.load(source, makeCtx({ "assets/sticker.png": STICKER }));
    expect(artifacts).toHaveLength(1);
    const message = artifacts[0]!;
    expect(message.id).toBe("a.m-1");
    expect(message.host).toBe("mail.fix.pcp");
    expect(message.path).toBe("a.mbox/inbox/a.m-1");
    expect(message.kind).toBe("mail-message");
    expect(message.collectible).toBe(true);
    expect(message.body).toContain("From: mara.voss@acme.pcp");
    expect(message.body).not.toContain("Mara Voss");
    const attachments = JSON.parse(String(message.meta.attachments));
    expect(attachments[0].asset).toBe(STICKER.sha256);
    expect(JSON.parse(String(message.meta.headers))["X-Mailer"]).toBe("DEADLETTER");
  });

  it("fails when an attachment does not resolve to an asset", () => {
    const source = {
      mailboxes: [
        {
          id: "a.mbox",
          owner: "p.jamie",
          messages: [
            {
              id: "a.m-1",
              mailbox: "a.mbox",
              from: "id.mara-mail",
              to: ["id.jamie-mail"],
              date: "2026-10-29T08:05:00Z",
              subject: "printer",
              body: "hi",
              attachments: [{ asset: "assets/missing.png", filename: "m.png" }],
            },
          ],
        },
      ],
    };
    expect(() => MAIL_SERVICE.load(source, makeCtx())).toThrowError(/does not resolve/);
  });
});

describe("ARCHIVE_SERVICE", () => {
  it("produces collectible document artifacts with meta", () => {
    const source = {
      docs: [
        {
          meta: {
            id: "a.doc-1",
            title: "Maintenance log",
            type: "report",
            date: "2026-10-28T16:00:00Z",
            source: "Facilities",
            assets: ["assets/sticker.png"],
            meta: { room: "2B" },
          },
          body: "The password was rotated.",
        },
      ],
    };
    const artifacts = ARCHIVE_SERVICE.load(source, makeCtx({ "assets/sticker.png": STICKER }));
    expect(artifacts).toHaveLength(1);
    const doc = artifacts[0]!;
    expect(doc.id).toBe("a.doc-1");
    expect(doc.path).toBe("documents/a.doc-1");
    expect(doc.kind).toBe("archive-document");
    expect(doc.collectible).toBe(true);
    expect(doc.meta.room).toBe("2B");
    expect(doc.meta.assets).toBe(STICKER.sha256);
    expect(doc.body).toContain("rotated");
  });
});

describe("TERMINAL_SERVICE", () => {
  const source = {
    fs: { hosts: [{ host: "term.fix.pcp", motd: "NODE TERMINAL", connectGate: "g.term-connect" }] },
    files: [
      { host: "term.fix.pcp", path: "etc/printers.conf", text: "admin_password=papercut-7331" },
      { host: "term.fix.pcp", path: "home/jamie/readme.txt", text: "hello" },
    ],
  };

  it("derives deterministic ids from host and path and carries host meta", () => {
    const artifacts = TERMINAL_SERVICE.load(source, makeCtx());
    expect(artifacts.map((a) => a.id)).toEqual(["a.term.fix.pcp.etc-printers.conf", "a.term.fix.pcp.home-jamie-readme.txt"]);
    const first = artifacts[0]!;
    expect(first.kind).toBe("terminal-file");
    expect(first.host).toBe("term.fix.pcp");
    expect(first.path).toBe("etc/printers.conf");
    expect(first.body).toBe("admin_password=papercut-7331");
    expect(first.collectible).toBe(false);
    expect(first.meta.motd).toBe("NODE TERMINAL");
    expect(first.meta.connectGate).toBe("g.term-connect");
    if (first.ast.type !== 'root') throw new Error('Expected root AST');
    expect(first.ast.children[0]).toMatchObject({ type: "code", value: first.body });
  });

  it("rejects files on undeclared hosts", () => {
    const bad = { ...source, files: [{ host: "ghost.fix.pcp", path: "x.txt", text: "x" }] };
    expect(() => TERMINAL_SERVICE.load(bad, makeCtx())).toThrowError(/not declared/);
  });
});
