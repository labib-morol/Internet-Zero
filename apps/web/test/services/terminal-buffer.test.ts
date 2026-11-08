import { describe, expect, it } from "vitest";
import { pushLines, TERMINAL_BUFFER_CAP, type TerminalBufferLine } from "../../src/services/terminal/terminal-store.js";
import { planTerminalSync } from "../../src/services/terminal/TerminalConsole.js";

/**
 * Task 4: the graphical terminal must track output by identity, not array
 * index. Clear shrinks the buffer; the 500-line cap rolls old lines off —
 * index-based tracking made new output invisible in both cases.
 *
 * The line counter is global (monotonic across the store lifetime), so every
 * assertion here is relative to the ids pushLines actually returned.
 */

function line(text: string): Omit<TerminalBufferLine, "n"> {
  return { kind: "out", text };
}

describe("terminal buffer identity", () => {
  it("assigns strictly increasing ids across pushes", () => {
    const first = pushLines([], [line("one"), line("two")]);
    const second = pushLines(first, [line("three")]);
    expect(first[1]!.n).toBe(first[0]!.n + 1);
    expect(second[2]!.n).toBe(second[1]!.n + 1);
  });

  it("rolls old lines off the capped buffer while ids keep rising", () => {
    let lines: TerminalBufferLine[] = [];
    let lastId = 0;
    for (let i = 0; i < TERMINAL_BUFFER_CAP + 5; i++) {
      lines = pushLines(lines, [line(`cmd-${i}`)]);
      lastId = lines[lines.length - 1]!.n;
    }
    expect(lines).toHaveLength(TERMINAL_BUFFER_CAP);
    // The newest line carries the highest id and is present.
    expect(lines[lines.length - 1]?.text).toBe(`cmd-${TERMINAL_BUFFER_CAP + 4}`);
    expect(lines[lines.length - 1]!.n).toBe(lastId);
  });
});

describe("planTerminalSync (graphical renderer)", () => {
  it("writes nothing when the engine is up to date", () => {
    const lines = pushLines([], [line("a"), line("b")]);
    const newest = lines[lines.length - 1]!.n;
    const plan = planTerminalSync(newest, lines);
    expect(plan).toMatchObject({ clear: false, write: [], lastN: newest });
  });

  it("writes only new lines after rollover (index tracking would stall here)", () => {
    // Fill the buffer to its cap, note the engine's cursor, then push one
    // more line: the array keeps its length (rollover) but the newest id rises.
    let lines: TerminalBufferLine[] = [];
    for (let i = 0; i < TERMINAL_BUFFER_CAP; i++) lines = pushLines(lines, [line(`l-${i}`)]);
    const engineAt = lines[lines.length - 1]!.n;
    lines = pushLines(lines, [line("the-fresh-line")]);
    expect(lines).toHaveLength(TERMINAL_BUFFER_CAP);
    const plan = planTerminalSync(engineAt, lines);
    expect(plan.clear).toBe(false);
    expect(plan.write.map((l) => l.text)).toEqual(["the-fresh-line"]);
    expect(plan.lastN).toBe(lines[lines.length - 1]!.n);
  });

  it("clears and restarts when the buffer was wiped (Clear button)", () => {
    const plan = planTerminalSync(42, []);
    expect(plan).toMatchObject({ clear: true, write: [], lastN: 0 });
  });

  it("replays the whole buffer on a fresh engine (window remount)", () => {
    const lines = pushLines([], [line("a"), line("b"), line("c")]);
    const plan = planTerminalSync(0, lines);
    expect(plan.clear).toBe(false);
    expect(plan.write).toHaveLength(3);
    expect(plan.lastN).toBe(lines[lines.length - 1]!.n);
  });

  it("rebuilds when the engine is somehow ahead of the buffer (shrunk)", () => {
    const lines = pushLines([], [line("a")]);
    const newest = lines[lines.length - 1]!.n;
    const plan = planTerminalSync(newest + 10, lines);
    expect(plan).toMatchObject({ clear: true, write: lines, lastN: newest });
  });
});
