import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Action, GameEvent } from "@iz/schema";
import { setIzClientForTests, useSessionStore, type IzClient, type WireRuntimeState } from "@iz/ui";
import { CaseFilePanel } from "../../src/shell/CaseFilePanel.js";

/**
 * M1 task 8: open gates (answer + hints), open reports (slot forms from
 * GET /api/case) and accepted-group feedback. Grading feedback shows only what
 * the server says: groups accepted, never which slot was wrong (§8).
 */

function wireState(): WireRuntimeState {
  return {
    teamId: "team-1",
    worldId: "w.tutorial",
    bundleHash: "hash-1",
    startedAt: "2026-11-02T10:00:00.000Z",
    solvedGates: {},
    unlocked: [],
    evidence: {},
    claims: {},
    links: {},
    hintsUsed: {},
    reportGroupsAccepted: {},
    firedEvents: [],
    overlayFs: {},
    readPaths: {},
    attempts: {},
    score: 120,
  };
}

const CASE_FIXTURE = {
  openGates: [{ gateId: "g.printer", title: "Printer passphrase" }],
  reports: [
    {
      reportId: "r.who-holds",
      title: "Who holds the key",
      groups: [
        {
          id: "A",
          slots: [
            { id: "s.holder", label: "Holder of the key", type: "identity", fact: "f.holder" },
            { id: "s.clue-kind", label: "Kind of clue", type: "choice", options: ["one fact", "two facts combined"], fact: "f.clue" },
          ],
        },
      ],
    },
  ],
};

type SubmitSpy = (action: Action) => Promise<{ events: GameEvent[]; result?: unknown; rejection?: { code: string; message: string; retryAfterSeconds?: number } }>;

function install(submit: SubmitSpy): ReturnType<typeof vi.fn> {
  const spy = vi.fn(submit);
  setIzClientForTests({
    listWorlds: async () => [],
    createSession: async () => {
      throw new Error("unused");
    },
    resumeSession: async () => {
      throw new Error("unused");
    },
    getState: async () => wireState(),
    submit: spy as unknown as IzClient["submit"],
    getView: async () => {
      throw new Error("unused");
    },
  } as unknown as IzClient);
  useSessionStore.setState({
    session: { teamId: "team-1", userId: "u1", token: "tok" },
    state: wireState(),
    world: {
      worldId: "w.tutorial",
      title: "Lost and Found",
      summary: "A dead company's leftovers.",
      version: "1.0.0",
      bundleHash: "hash-1",
      entry: "forge.pinecone.pcp",
      hosts: [],
    },
    screen: "shell",
    status: "ready",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/case")) {
        return new Response(JSON.stringify(CASE_FIXTURE), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unrouted" }), { status: 404 });
    })
  );
  return spy;
}

beforeEach(() => {
  useSessionStore.setState({ session: undefined, state: undefined, world: undefined, screen: "landing", status: "idle" });
});

afterEach(() => {
  cleanup();
  setIzClientForTests(undefined);
  vi.unstubAllGlobals();
  useSessionStore.setState({ session: undefined, state: undefined, world: undefined, screen: "landing", status: "idle" });
});

describe("CaseFilePanel: open gates", () => {
  it("loads /api/case and lists open gates with an answer form", async () => {
    install(async () => ({ events: [] }));
    render(<CaseFilePanel onClose={() => undefined} />);
    expect(await screen.findByText("Printer passphrase")).toBeInTheDocument();
    expect(screen.getByText("g.printer")).toBeInTheDocument();
    expect(screen.getByLabelText("Answer for Printer passphrase")).toBeInTheDocument();
  });

  it("submits the answer through dispatch and confirms", async () => {
    const submit = install(async (action) =>
      action.type === "submitAnswer"
        ? {
            events: [{ type: "GateSolved", gateId: "g.printer", score: 100, at: "2026-11-02T10:10:00.000Z", by: "u1", actorKind: "human" }],
            result: { accepted: true },
          }
        : { events: [] }
    );
    render(<CaseFilePanel onClose={() => undefined} />);
    await screen.findByText("Printer passphrase");
    fireEvent.change(screen.getByLabelText("Answer for Printer passphrase"), { target: { value: "biscuit2009" } });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: "submitAnswer", gateId: "g.printer", answer: "biscuit2009" }))
    );
    expect(await screen.findByText("Correct — gate solved.")).toBeInTheDocument();
  });

  it("surfaces rejections with the rate-limit wait", async () => {
    install(async (action) =>
      action.type === "submitAnswer"
        ? { events: [], rejection: { code: "rate_limited", message: "Too many attempts.", retryAfterSeconds: 90 } }
        : { events: [] }
    );
    render(<CaseFilePanel onClose={() => undefined} />);
    await screen.findByText("Printer passphrase");
    fireEvent.change(screen.getByLabelText("Answer for Printer passphrase"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(await screen.findByText(/Too many attempts\. Wait 90s\./)).toBeInTheDocument();
  });

  it("requests hints tier by tier and shows text with its cost", async () => {
    const submit = install(async (action) => {
      if (action.type === "requestHint" && action.tier === 1) {
        return { events: [{ type: "HintRequested", gateId: "g.printer", tier: 1, cost: 10, at: "2026-11-02T10:12:00.000Z", by: "u1", actorKind: "human" }], result: { gateId: "g.printer", tier: 1, text: "Read the commit messages.", cost: 10 } };
      }
      return { events: [] };
    });
    render(<CaseFilePanel onClose={() => undefined} />);
    await screen.findByText("Printer passphrase");
    fireEvent.click(screen.getByRole("button", { name: "Request hint (tier 1)" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: "requestHint", gateId: "g.printer", tier: 1 })));
    expect(await screen.findByText("Read the commit messages.")).toBeInTheDocument();
    expect(screen.getByText(/tier 1 · −10 points/)).toBeInTheDocument();
  });
});

describe("CaseFilePanel: open reports", () => {
  it("renders slot forms (input for identity, select for choice) and submits a group", async () => {
    const submit = install(async (action) => {
      if (action.type === "submitReport") {
        expect(action.slots).toEqual({ "s.holder": "Odile Brandt", "s.clue-kind": "two facts combined" });
        return {
          events: [{ type: "ReportGroupAccepted", reportId: "r.who-holds", groupId: "A", at: "2026-11-02T10:15:00.000Z", by: "u1", actorKind: "human" }],
          result: { acceptedGroups: ["A"] },
        };
      }
      return { events: [] };
    });
    render(<CaseFilePanel onClose={() => undefined} />);
    await screen.findByText("Who holds the key");
    fireEvent.change(screen.getByLabelText("Holder of the key"), { target: { value: "Odile Brandt" } });
    fireEvent.change(screen.getByLabelText("Kind of clue"), { target: { value: "two facts combined" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit group A" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: "submitReport", reportId: "r.who-holds", groupId: "A" })));
    // After the acceptance event merges, the group leaves the open list and
    // the accepted line appears (group-level feedback only, §8).
    await waitFor(() => expect(screen.getByText(/Accepted: A/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Submit group A" })).not.toBeInTheDocument();
  });

  it("shows only group-level feedback when a group is rejected (§8)", async () => {
    install(async () => ({ events: [], rejection: { code: "invalid_input", message: "One or more report fields are incorrect." } }));
    render(<CaseFilePanel onClose={() => undefined} />);
    await screen.findByText("Who holds the key");
    fireEvent.change(screen.getByLabelText("Holder of the key"), { target: { value: "Wrong Person" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit group A" }));
    expect(await screen.findByText("Not accepted — one or more fields are incorrect.")).toBeInTheDocument();
    // No per-slot verdict may appear.
    expect(screen.queryByText(/s\.holder/)).not.toBeInTheDocument();
  });

  it("keeps already-accepted groups out of the form and lists them", async () => {
    install(async () => ({ events: [] }));
    useSessionStore.setState({
      state: { ...wireState(), reportGroupsAccepted: { "r.who-holds": ["A"] } },
    });
    render(<CaseFilePanel onClose={() => undefined} />);
    await screen.findByText("Who holds the key");
    expect(screen.getByText("Accepted: A")).toBeInTheDocument();
    expect(screen.getByText("Every group is accepted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit group A" })).not.toBeInTheDocument();
  });
});
