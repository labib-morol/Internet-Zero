import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Collectible, ForgeRepoHome, ForgeView, SafeNode } from "@iz/schema";
import { ForgePage } from "../../src/services/forge/ForgeViews.js";
import { unifiedDiff, wholeFileDiff } from "../../src/services/forge/diff.js";

const NO_COLLECTIBLES: Collectible[] = [];

function doc(...children: SafeNode[]): SafeNode {
  return { type: "root", children };
}
function p(text: string): SafeNode {
  return { type: "paragraph", children: [{ type: "text", value: text }] };
}

afterEach(cleanup);

describe("unified diff computation", () => {
  it("renders added and removed lines for a modify change", () => {
    const diff = unifiedDiff("alpha\nbeta\ngamma\n", "alpha\nbeta v2\ngamma\ndelta\n");
    expect(diff.empty).toBe(false);
    const kinds = diff.hunks.flatMap((h) => h.lines.map((l) => l.kind));
    expect(kinds).toContain("del");
    expect(kinds).toContain("add");
    const texts = diff.hunks.flatMap((h) => h.lines.map((l) => l.text));
    expect(texts).toContain("beta v2");
    expect(texts).toContain("beta");
    expect(texts).toContain("delta");
    expect(texts).toContain("alpha"); // context kept
  });

  it("marks line-identical versions as empty", () => {
    expect(unifiedDiff("same\n", "same\n").empty).toBe(true);
  });

  it("splits distant changes into separate hunks", () => {
    const lines = ["a"];
    for (let i = 0; i < 20; i += 1) lines.push(`filler ${i}`);
    lines.push("z");
    const changed = [...lines];
    changed[0] = "A";
    changed[changed.length - 1] = "Z";
    const diff = unifiedDiff(lines.join("\n"), changed.join("\n"));
    expect(diff.hunks.length).toBe(2);
  });

  it("whole-file diffs are all + for adds and all - for deletes", () => {
    const add = wholeFileDiff("add", "one\ntwo\n");
    expect(add.hunks[0]!.lines.every((l) => l.kind === "add")).toBe(true);
    const del = wholeFileDiff("del", "one\ntwo\n");
    expect(del.hunks[0]!.lines.every((l) => l.kind === "del")).toBe(true);
  });
});

const COLLECTIBLES: Collectible[] = [{ artifactId: "a.repo", label: "office-scripts repo" }];

function repoHome(): ForgeRepoHome {
  return {
    view: "repo-home",
    artifactId: "a.repo",
    owner: "pinecone",
    name: "office-scripts",
    description: "Scripts that run the office.",
    defaultBranch: "main",
    readmeAst: doc(p("Prints the badges.")),
    recentCommits: [
      { sha: "a".repeat(40), date: "2026-10-04T09:12:00.000Z", message: "rotate printer admin pass", authorName: "O. Brandt" },
    ],
    openIssues: [{ number: 2, title: "badge printer jams" }],
  };
}

describe("ForgePage: repo-home", () => {
  it("renders README, commits, issues and the Collect affordance", () => {
    const onCollect = vi.fn();
    render(<ForgePage view={repoHome()} host="forge.pinecone.pcp" collectibles={COLLECTIBLES} onCollect={onCollect} />);
    expect(screen.getByText("Scripts that run the office.")).toBeInTheDocument();
    expect(screen.getByText("Prints the badges.")).toBeInTheDocument();
    expect(screen.getByText("rotate printer admin pass")).toBeInTheDocument();
    expect(screen.getByText("badge printer jams")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collect evidence: office-scripts repo" }));
    expect(onCollect).toHaveBeenCalledWith("a.repo", "office-scripts repo");
  });

  it("hides the Collect button when the server lists no collectibles", () => {
    render(<ForgePage view={repoHome()} host="forge.pinecone.pcp" collectibles={NO_COLLECTIBLES} onCollect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Collect evidence/ })).not.toBeInTheDocument();
  });
});

describe("ForgePage: commit-detail", () => {
  const commitView: ForgeView = {
    view: "commit-detail",
    artifactId: "a.abc",
    owner: "pinecone",
    name: "office-scripts",
    commit: {
      sha: "a".repeat(40),
      parents: ["b".repeat(40)],
      author: { name: "O. Brandt", email: "o@pinecone.pcp" },
      committer: { name: "gitd", email: "git@forge.pinecone.pcp", host: "forge.pinecone.pcp" },
      date: "2026-10-04T09:12:00.000Z",
      message: "rotate printer admin pass",
      signature: { keyId: "9A11B0T", fingerprint: "fp:aa:bb", valid: false, signer: "O. Brandt" },
      changes: [
        { path: "print.sh", kind: "modify", before: "PASS=old\nrun\n", after: "PASS=new\nrun\n" },
        { path: "notes.txt", kind: "add", after: "hello\n" },
        { path: "old.txt", kind: "delete", before: "gone\n" },
      ],
    },
  };

  it("renders the signature panel with an INVALID verdict", () => {
    render(<ForgePage view={commitView} host="forge.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    expect(screen.getByText("signature INVALID")).toBeInTheDocument();
    expect(screen.getByText(/key 9A11B0T/)).toBeInTheDocument();
    expect(screen.getByText(/fp:aa:bb/)).toBeInTheDocument();
  });

  it("renders +/- diff lines with coloring classes per kind", () => {
    const { container } = render(
      <ForgePage view={commitView} host="forge.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />
    );
    expect(container.querySelectorAll(".iz-diff__line--add").length).toBeGreaterThanOrEqual(2); // PASS=new + hello
    expect(container.querySelectorAll(".iz-diff__line--del").length).toBeGreaterThanOrEqual(2); // PASS=old + old.txt lines
    expect(container.textContent).toContain("modified");
    expect(container.textContent).toContain("added");
    expect(container.textContent).toContain("deleted");
  });
});

describe("ForgePage: commit-list filters", () => {
  const listView: ForgeView = {
    view: "commit-list",
    artifactId: "a.repo",
    owner: "pinecone",
    name: "office-scripts",
    commits: [
      { sha: "a".repeat(40), date: "2026-10-04T09:12:00.000Z", message: "first", authorName: "O. Brandt" },
      { sha: "b".repeat(40), date: "2026-10-11T09:12:00.000Z", message: "second", authorName: "R. Quill" },
      { sha: "c".repeat(40), date: "2026-10-18T09:12:00.000Z", message: "third", authorName: "O. Brandt" },
    ],
  };

  it("filters by author client-side", () => {
    render(<ForgePage view={listView} host="forge.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    expect(screen.getByText("3 of 3 commits")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Author"), { target: { value: "R. Quill" } });
    expect(screen.getByText("1 of 3 commits")).toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("filters by date range client-side", () => {
    render(<ForgePage view={listView} host="forge.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-11" } });
    expect(screen.getByText("2 of 3 commits")).toBeInTheDocument();
  });
});

describe("ForgePage: file-browser", () => {
  it("lists dir-first entries and numbered file contents", () => {
    const view: ForgeView = {
      view: "file-browser",
      artifactId: null,
      owner: "pinecone",
      name: "office-scripts",
      ref: "main",
      path: "scripts",
      entries: [
        { name: "zeta.sh", kind: "file" },
        { name: "nested", kind: "dir" },
      ],
      file: { path: "scripts/zeta.sh", content: "echo hi\necho bye" },
    };
    const { container } = render(<ForgePage view={view} host="forge.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    const rows = container.querySelectorAll(".iz-filetree li");
    expect(rows[0]?.textContent).toContain("nested/");
    expect(container.querySelectorAll(".iz-codepane__ln").length).toBe(2);
    expect(container.textContent).toContain("echo hi");
  });

  it("shows a tombstone note for content-less files (deleted at this ref)", () => {
    const view: ForgeView = {
      view: "file-browser",
      artifactId: null,
      owner: "pinecone",
      name: "office-scripts",
      ref: "main",
      path: "old.txt",
      entries: [],
      file: { path: "old.txt", content: "" },
    };
    render(<ForgePage view={view} host="forge.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    expect(screen.getByText(/No content at this ref/)).toBeInTheDocument();
  });
});

describe("ForgePage: issues and users", () => {
  const issueDetailView: ForgeView = {
    view: "issue-detail",
    artifactId: "a.issue",
    owner: "pinecone",
    name: "office-scripts",
    issue: {
      number: 2,
      title: "badge printer jams",
      state: "open",
      author: { identityId: "i.quill", displayName: "R. Quill", login: "quill", deleted: false },
      date: "2026-10-05T10:00:00.000Z",
      ast: doc(p("The jams started after the rotation.")),
      comments: [
        {
          author: { identityId: "i.ghost", displayName: "M. Sable", login: "sable", deleted: true },
          date: "2026-10-06T10:00:00.000Z",
          ast: doc(p("Same here.")),
        },
      ],
    },
  };

  it("marks deleted commenters and renders comments", () => {
    render(<ForgePage view={issueDetailView} host="forge.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    expect(screen.getByText("The jams started after the rotation.")).toBeInTheDocument();
    expect(screen.getByText("account deleted")).toBeInTheDocument();
    expect(screen.getByText("Same here.")).toBeInTheDocument();
  });

  it("shows the account-deleted state on user profiles", () => {
    const profile: ForgeView = {
      view: "user-profile",
      artifactId: "a.user",
      login: "sable",
      name: "M. Sable",
      bio: null,
      deleted: true,
      recentCommits: [],
      authoredIssues: [],
    };
    render(<ForgePage view={profile} host="forge.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    expect(screen.getByText(/Account deleted/)).toBeInTheDocument();
    expect(screen.queryByText("No profile details.")).not.toBeInTheDocument(); // deleted hides bio/name block
  });

  it("renders issue list state filter", () => {
    const listView: ForgeView = {
      view: "issue-list",
      artifactId: "a.repo",
      owner: "pinecone",
      name: "office-scripts",
      issues: [
        { number: 1, title: "open one", state: "open", author: { identityId: "i1", displayName: "A", deleted: false }, date: "2026-10-01T00:00:00.000Z", commentCount: 0 },
        { number: 2, title: "closed one", state: "closed", author: { identityId: "i2", displayName: "B", deleted: false }, date: "2026-10-02T00:00:00.000Z", commentCount: 3 },
      ],
    };
    render(<ForgePage view={listView} host="forge.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    expect(screen.getByText("All (2)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "closed (1)" }));
    expect(screen.getByText("closed one")).toBeInTheDocument();
    expect(screen.queryByText("open one")).not.toBeInTheDocument();
  });
});
