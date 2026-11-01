import { describe, expect, it } from "vitest";
import { ParseError, parseLine, MAX_LINE_LENGTH } from "../src/parser.js";
import { normalizePath } from "../src/vfs.js";
import { exec, type ExecContext } from "../src/exec.js";

const fs = {
  "/etc/motd": "Welcome to the printer node.\nThe shop cat is fine.\n",
  "/var/log/jobs.log": "2026-10-30 job 1 ok\n2026-10-31 job 2 failed\n2026-11-01 job 3 ok\n",
  "/home/ines/README.txt": "the tower's network name, reversed\n",
  "/home/ines/notes/draft.txt": "unsent draft\n",
  "/etc/cron.d/ledger-push": "0 3 * * * /usr/bin/ledger-push\n",
};
const overlay = { "notes/mine.txt": "player note" };
const ctx: ExecContext = {
  host: "printer.pinecone.pcp",
  user: "volunteer",
  now: "2026-11-02T09:00:00.000Z",
  forge: [
    {
      owner: "pinecone",
      name: "office-scripts",
      path: "/srv/repo",
      commits: [
        { sha: "a".repeat(40), date: "2026-10-30T17:04:00Z", message: "rotate printer admin pass", authorName: "Rowan" },
      ],
    },
  ],
};

const run = (line: string, cwd = "/", o: typeof overlay = overlay) => exec(fs, o, cwd, line, ctx);

describe("parser", () => {
  it("tokenizes quotes and whitespace", () => {
    expect(parseLine('cat "my file.txt"')).toEqual({
      argv: ["cat", "my file.txt"],
      filters: [],
      redirect: undefined,
    });
  });

  it("splits pipes and only allows grep/head/tail filters", () => {
    const p = parseLine("cat /etc/motd | grep -i cat | head -n 2");
    expect(p.filters.map((f) => f.cmd)).toEqual(["grep", "head"]);
  });

  it("rejects other pipes, bad redirects, overlong lines", () => {
    expect(() => parseLine("cat x | sort")).toThrow(ParseError);
    expect(() => parseLine("cat > /abs")).toThrow(ParseError);
    expect(() => parseLine("cat > ")).toThrow(ParseError);
    expect(() => parseLine("x".repeat(MAX_LINE_LENGTH + 1))).toThrow(ParseError);
  });

  it("rejects unterminated quotes", () => {
    expect(() => parseLine('cat "oops')).toThrow(ParseError);
  });
});

describe("vfs paths", () => {
  it("normalizes relative and absolute paths, including ..", () => {
    expect(normalizePath("/", "etc/motd")).toBe("/etc/motd");
    expect(normalizePath("/home/ines", "notes/draft.txt")).toBe("/home/ines/notes/draft.txt");
    expect(normalizePath("/home/ines", "../../../etc/motd")).toBe("/etc/motd");
    expect(normalizePath("/home/ines")).toBe("/home/ines");
  });
});

describe("exec commands", () => {
  it("ls lists files and implied directories", () => {
    const out = run("ls /home/ines").output;
    expect(out).toContain("README.txt");
    expect(out).toContain("notes/");
  });

  it("cat reads world files and emits TerminalRead", () => {
    const r = run("cat /etc/motd");
    expect(r.output).toContain("shop cat is fine");
    expect(r.events).toEqual([{ type: "TerminalRead", host: "printer.pinecone.pcp", path: "/etc/motd" }]);
  });

  it("head/tail -n work", () => {
    expect(run("head -n 1 /var/log/jobs.log").output).toBe("2026-10-30 job 1 ok");
    expect(run("tail -n 1 /var/log/jobs.log").output).toBe("2026-11-01 job 3 ok");
  });

  it("grep as command and as pipe", () => {
    expect(run("grep failed /var/log/jobs.log").output).toBe("2026-10-31 job 2 failed");
    expect(run("cat /var/log/jobs.log | grep -i OK | head -n 1").output).toBe("2026-10-30 job 1 ok");
  });

  it("find, stat, file, strings, hexdump", () => {
    expect(run("find cron").output).toBe("/etc/cron.d/ledger-push");
    expect(run("stat /etc/motd").output).toContain("world file");
    expect(run("file /etc/motd").output).toContain("ASCII text");
    expect(run("strings /etc/motd").output).toContain("Welcome");
    expect(run("hexdump /etc/motd").output).toMatch(/^00000000/);
  });

  it("whoami, date, decode base64/hex/rot13", () => {
    expect(run("whoami").output).toBe("volunteer");
    expect(run("date").output).toBe("2026-11-02T09:00:00.000Z");
    expect(run("decode base64 aGVsbG8gd29ybGQ=").output).toBe("hello world");
    expect(run("decode hex 68656c6c6f20776f726c64").output).toBe("hello world");
    expect(run("decode rot13 uryyb jbeyq").output).toBe("hello world");
    expect(() => run("decode hex abc")).toThrow(/odd length/);
    expect(() => run("decode nope x")).toThrow(/usage: decode/);
  });

  it("log prints git-style history inside a repo cwd", () => {
    const out = run("log", "/srv/repo").output;
    expect(out).toContain(`commit ${"a".repeat(40)}`);
    expect(out).toContain("rotate printer admin pass");
    expect(() => run("log", "/etc")).toThrow(/not inside a repository/);
  });

  it("verify uses the supplied verifier", () => {
    const r = exec(fs, overlay, "/", "verify ledger", {
      ...ctx,
      verify: () => ({ valid: true, fingerprint: "AB:CD", keyId: "0x1" }),
    });
    expect(r.output).toContain("VALID");
    expect(r.output).toContain("AB:CD");
    expect(() => run("verify nothing")).toThrow(/no signed artifact/);
  });

  it("cd changes cwd; pwd reports it", () => {
    expect(run("cd /var/log").cwd).toBe("/var/log");
    expect(run("pwd").output).toBe("/");
    expect(() => run("cd /nope")).toThrow(/no such directory/);
  });

  it("redirection writes the overlay with caps and emits TerminalOverlayWrite", () => {
    const r = run("cat /etc/motd > notes/motd-copy.txt");
    expect(r.output).toBe("");
    expect(r.overlayPatch["notes/motd-copy.txt"]).toContain("shop cat");
    expect(r.events).toContainEqual({ type: "TerminalOverlayWrite", host: "printer.pinecone.pcp", path: "notes/motd-copy.txt" });
    // Overlay content shadows the world fs on later reads.
    const withCopy = { ...overlay, "notes/motd-copy.txt": "overwritten" };
    expect(run("cat notes/motd-copy.txt", "/", withCopy).output).toBe("overwritten");
  });

  it("enforces output, file size and command length limits", () => {
    const big = { "/big.txt": "x".repeat(64 * 1024 + 10) };
    expect(exec(big, {}, "/", "cat /big.txt", ctx).output).toContain("truncated at 64 KB");
    expect(() => exec(big, {}, "/", "cat /big.txt > toobig.txt", ctx)).toThrow(/64 KB/);
    expect(() => run("x".repeat(1100))).toThrow();
  });

  it("client-side commands are accepted no-ops; unknown commands fail", () => {
    expect(run("clear").output).toBe("");
    expect(run("history").output).toBe("");
    expect(run("logout").output).toBe("");
    expect(() => run("rm -rf /")).toThrow(/command not found/);
  });

  it("path traversal cannot escape the root", () => {
    expect(() => run("cat ../../etc/passwd")).toThrow(/no such file/);
    expect(normalizePath("/", "../../etc/motd")).toBe("/etc/motd");
  });
});
