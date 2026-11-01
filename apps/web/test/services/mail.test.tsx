import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Collectible, MailboxView, MailThreadView, SafeNode } from "@iz/schema";
import { MailPage } from "../../src/services/mail/MailViews.js";

function doc(...children: SafeNode[]): SafeNode {
  return { type: "root", children };
}
function p(text: string): SafeNode {
  return { type: "paragraph", children: [{ type: "text", value: text }] };
}

afterEach(cleanup);

const COLLECTIBLES: Collectible[] = [{ artifactId: "a.msg1", label: "mail: printer rotation" }];

describe("MailPage: mailbox", () => {
  const mailbox: MailboxView = {
    view: "mailbox",
    mailboxId: "reception",
    folder: "inbox",
    threads: [
      {
        threadId: "t.rotation",
        subject: "printer rotation",
        participants: [
          { identityId: "i.odile", displayName: "Odile Brandt", login: "obrandt", deleted: false },
          { identityId: "i.sable", displayName: "M. Sable", login: "sable", deleted: true },
        ],
        lastDate: "2026-10-12T08:00:00.000Z",
        messageCount: 3,
      },
      {
        threadId: null,
        subject: "parking rota",
        participants: [{ identityId: "i.fac", displayName: "Facilities", deleted: false }],
        lastDate: "2026-10-10T08:00:00.000Z",
        messageCount: 1,
        // The server folds folders into one list; non-inbox threads carry a marker.
        folder: "archive",
      } as unknown as MailboxView["threads"][number],
    ],
  };

  it("lists threads with participants and dates; solo subjects stay plain text", () => {
    render(<MailPage view={mailbox} host="mail.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    expect(screen.getByText("printer rotation")).toBeInTheDocument();
    expect(screen.getByText("account deleted")).toBeInTheDocument(); // deleted identity chip
    expect(screen.getByText("parking rota")).toBeInTheDocument();
    expect(screen.getAllByText(/3 messages/).length).toBe(1);
  });

  it("filters on folder markers client-side", () => {
    render(<MailPage view={mailbox} host="mail.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "archive" }));
    expect(screen.getByText("parking rota")).toBeInTheDocument();
    expect(screen.queryByText("printer rotation")).not.toBeInTheDocument();
  });
});

describe("MailPage: thread + message", () => {
  const baseMessage = {
    artifactId: "a.msg1",
    from: { identityId: "i.odile", displayName: "Odile Brandt", login: "obrandt", deleted: false },
    to: [{ identityId: "i.quill", displayName: "R. Quill", login: "quill", deleted: false }],
    cc: [{ identityId: "i.ghost", displayName: "M. Sable", login: "sable", deleted: true }],
    date: "2026-10-11T14:30:00.000Z",
    subject: "printer rotation",
    ast: doc(p("The passphrase is "), { type: "redaction", text: "biscuit2009", removable: true }, p(" — keep it quiet.")),
    attachments: [
      { assetId: "as.1", filename: "rotation-memo.txt", hasRemovableRedactions: true },
      { assetId: "as.2", filename: "logo.png", hasRemovableRedactions: false },
    ],
    headers: { "Message-ID": "<a1@pinecone.pcp>", "X-Mailer": "DEADLETTER 2.1" },
  };

  const thread: MailThreadView = {
    view: "thread",
    mailboxId: "reception",
    subject: "printer rotation",
    messages: [
      baseMessage,
      { ...baseMessage, artifactId: "a.msg2", date: "2026-10-12T09:00:00.000Z", attachments: [] },
    ],
  };

  it("renders messages in order with identity chips and the deleted marker", () => {
    render(<MailPage view={thread} host="mail.pinecone.pcp" collectibles={COLLECTIBLES} onCollect={vi.fn()} />);
    expect(screen.getAllByText("printer rotation").length).toBeGreaterThanOrEqual(3); // thread title + two subjects
    expect(screen.getAllByText("account deleted").length).toBe(2);
  });

  it("never puts removable redaction text in the DOM until layers are inspected", () => {
    render(<MailPage view={thread} host="mail.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    expect(screen.queryByText("biscuit2009")).not.toBeInTheDocument();
    const hidden = document.querySelectorAll('[data-redaction="removable-hidden"]');
    expect(hidden.length).toBe(2);
  });

  it("reveals redactions per message via the attachment inspect tool, session-sticky", () => {
    const onCollect = vi.fn();
    render(<MailPage view={thread} host="mail.pinecone.pcp" collectibles={COLLECTIBLES} onCollect={onCollect} />);
    const inspectButtons = screen.getAllByRole("button", { name: "Inspect layers of rotation-memo.txt" });
    expect(inspectButtons.length).toBe(1); // only the first message has attachments
    fireEvent.click(inspectButtons[0]!);
    // The inspected message reveals; the sibling stays covered.
    expect(screen.getByText("biscuit2009")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-redaction="removable-hidden"]').length).toBe(1);

    // Collect affordance from the server's collectibles list.
    fireEvent.click(screen.getByRole("button", { name: "Collect evidence: mail: printer rotation" }));
    expect(onCollect).toHaveBeenCalledWith("a.msg1", "mail: printer rotation");

    // Inspecting again hides it (session record tracks the message).
    fireEvent.click(screen.getByRole("button", { name: "Inspect layers of rotation-memo.txt" }));
    expect(screen.queryByText("biscuit2009")).not.toBeInTheDocument();
  });

  it("shows raw headers behind View source", () => {
    render(<MailPage view={thread} host="mail.pinecone.pcp" collectibles={[]} onCollect={vi.fn()} />);
    expect(screen.queryByText(/X-Mailer: DEADLETTER 2.1/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "View source" })[0]!);
    expect(screen.getByText(/Message-ID: <a1@pinecone\.pcp>/)).toBeInTheDocument();
    expect(screen.getByText(/X-Mailer: DEADLETTER 2.1/)).toBeInTheDocument();
  });

  it("renders the single-message view", () => {
    render(
      <MailPage
        view={{ view: "message", mailboxId: "reception", message: baseMessage }}
        host="mail.pinecone.pcp"
        collectibles={COLLECTIBLES}
        onCollect={vi.fn()}
      />
    );
    expect(screen.getAllByText("printer rotation").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("rotation-memo.txt")).toBeInTheDocument();
    expect(screen.getByText("no covered layers")).toBeInTheDocument();
  });
});
