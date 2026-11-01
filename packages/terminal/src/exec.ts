import { MAX_OUTPUT, ParseError, parseLine, type Pipeline } from "./parser.js";
import {
  isDir,
  listDir,
  normalizePath,
  overlayAsAbsolute,
  readForCommand,
  splitLines,
  type Overlay,
  type VirtualFs,
} from "./vfs.js";

/**
 * The simulated NODE TERMINAL interpreter (§10.5). Pure: no I/O, no host
 * execution — everything below operates on the world's virtual filesystem
 * and the team's overlay. `connect` is handled by the server (it is a
 * host-level, gate-checked operation), and `clear`, `history` and `logout`
 * are client-side; exec accepts them as no-ops so they are not errors.
 */

export type ForgeCommitRow = { sha: string; date: string; message: string; authorName: string };
export type ForgeRepoIndex = {
  owner: string;
  name: string;
  /** Repo root path on this host, e.g. "/pinecone/office-scripts". */
  path: string;
  commits: ForgeCommitRow[];
};

export type ExecContext = {
  host: string;
  user: string;
  now: string;
  /** Git-style history inside a repo directory (from the forge data). */
  forge?: ForgeRepoIndex[];
  /** Signed-artifact verification for `verify` (server supplies). */
  verify?: (name: string) => { valid: boolean; fingerprint: string; keyId: string } | undefined;
};

export type ExecResult = {
  output: string;
  cwd: string;
  /** Files the command wrote to the team overlay (path -> content). */
  overlayPatch: Record<string, string>;
  /** TerminalRead / TerminalOverlayWrite events (server fills at/by/actorKind). */
  events: Array<{ type: "TerminalRead"; host: string; path: string } | { type: "TerminalOverlayWrite"; host: string; path: string }>;
};

export const MAX_FILE_SIZE = 64 * 1024;
export const MAX_OVERLAY_FILES = 100;

class ExecError extends Error {}

function readArgvFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function numericArg(argv: string[], flag: string, fallback: number): number {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) return fallback;
  const n = Number.parseInt(argv[i + 1]!, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cmdOf(argv: string[]): string {
  return argv[0] ?? "";
}

/** Apply the allowed trailing filters (§10.5: only | grep, | head, | tail). */
function applyFilters(text: string, pipeline: Pipeline): string {
  let lines = text.split("\n");
  for (const f of pipeline.filters) {
    if (f.cmd === "grep") {
      const args = f.argv.slice(1).filter((a) => a !== "-i");
      const ignoreCase = f.argv.includes("-i");
      const pattern = args[0];
      if (pattern === undefined) throw new ExecError("usage: grep [-i] PATTERN");
      let re: RegExp;
      try {
        re = new RegExp(pattern, ignoreCase ? "i" : "");
      } catch {
        throw new ExecError(`grep: invalid pattern: ${pattern}`);
      }
      lines = lines.filter((l) => re.test(l));
    } else if (f.cmd === "head") {
      lines = splitLines(lines.join("\n")).slice(0, numericArg(f.argv, "-n", 10));
    } else {
      const n = numericArg(f.argv, "-n", 10);
      const content = lines.join("\n");
      const all = splitLines(content);
      lines = all.length > n ? all.slice(all.length - n) : all.slice();
    }
  }
  return lines.join("\n");
}

function capOutput(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n… output truncated at 64 KB`;
}

const HELP = `NODE TERMINAL — available commands:
  ls, cd, pwd, cat, head, tail, grep, find, file, strings, hexdump, stat
  whoami, date, decode <base64|hex|rot13> <text>, log (in a repo), verify <name>
  pipes: | grep [-i] PATTERN, | head [-n N], | tail [-n N]
  redirect: command > note.txt (writes to your overlay)
  connect <host>, logout, clear, history — handled by your session
Everything here is a simulation inside the game world.`;

export function exec(
  fs: VirtualFs,
  overlay: Overlay,
  cwd: string,
  line: string,
  ctx: ExecContext
): ExecResult {
  const events: ExecResult["events"] = [];
  const overlayPatch: Record<string, string> = {};
  // Overlay keys are relative; normalize to absolute for path logic below.
  const view = overlayAsAbsolute(overlay);
  let pipeline: Pipeline;
  try {
    pipeline = parseLine(line);
  } catch (e) {
    if (e instanceof ParseError) {
      if (e.kind === "empty") return { output: "", cwd, overlayPatch, events };
      throw e;
    }
    throw e;
  }

  const argv = pipeline.argv;
  const cmd = cmdOf(argv);

  // Client-side commands: accepted, nothing to compute server-side.
  if (cmd === "clear" || cmd === "history" || cmd === "logout") {
    return { output: "", cwd, overlayPatch, events };
  }
  if (cmd === "connect") {
    throw new ExecError("connect is handled by your session; usage: connect <host>");
  }
  if (cmd === "help") return { output: HELP, cwd, overlayPatch, events };

  const cwdN = normalizePath("/", cwd);
  const pathArg = (arg: string | undefined): string => normalizePath(cwdN, arg);
  const readTarget = (arg: string | undefined): { path: string; content: string } => {
    const p = pathArg(arg);
    const r = readForCommand(fs, view, p);
    if (!r.found) throw new ExecError(`${arg ?? ""}: no such file`);
    events.push({ type: "TerminalRead", host: ctx.host, path: p });
    return { path: p, content: r.content };
  };

  let text: string;

  switch (cmd) {
    case "pwd":
      text = cwdN;
      break;

    case "ls": {
      const target = pathArg(argv[1]);
      if (!isDir(fs, view, target)) {
        const r = readForCommand(fs, view, target);
        text = r.found ? argv[1]! : `ls: ${argv[1]}: no such file or directory`;
        if (r.found) events.push({ type: "TerminalRead", host: ctx.host, path: target });
        break;
      }
      const entries = listDir(fs, view, target);
      text = entries.length === 0 ? "" : entries.map((e) => (e.kind === "dir" ? `${e.name}/` : e.name)).join("\n");
      break;
    }

    case "cd": {
      const target = pathArg(argv[1] ?? "/");
      if (!isDir(fs, view, target)) throw new ExecError(`cd: ${argv[1] ?? "/"}: no such directory`);
      return { output: "", cwd: target, overlayPatch, events };
    }

    case "cat": {
      if (argv.length < 2) throw new ExecError("usage: cat FILE");
      text = argv
        .slice(1)
        .filter((a) => a !== ">")
        .map((a) => readTarget(a).content)
        .join("");
      break;
    }

    case "head":
    case "tail": {
      const n = numericArg(argv, "-n", 10);
      const file = argv.filter((a, i) => a !== "-n" && argv[i - 1] !== "-n" && i > 0)[0];
      if (file === undefined) throw new ExecError(`usage: ${cmd} [-n N] FILE`);
      const content = readTarget(file).content;
      const lines = splitLines(content);
      text = cmd === "head" ? lines.slice(0, n).join("\n") : lines.slice(Math.max(0, lines.length - n)).join("\n");
      break;
    }

    case "grep": {
      const ignoreCase = readArgvFlag(argv, "-i");
      const rest = argv.slice(1).filter((a) => a !== "-i");
      const pattern = rest[0];
      if (pattern === undefined) throw new ExecError("usage: grep [-i] PATTERN [FILE...]");
      let re: RegExp;
      try {
        re = new RegExp(pattern, ignoreCase ? "i" : "");
      } catch {
        throw new ExecError(`grep: invalid pattern: ${pattern}`);
      }
      const files = rest.slice(1);
      if (files.length === 0) throw new ExecError("grep: no input (pipe from a command or name a file)");
      const chunks: string[] = [];
      for (const f of files) {
        const content = readTarget(f).content;
        for (const l of content.split("\n")) if (re.test(l)) chunks.push(files.length > 1 ? `${f}:${l}` : l);
      }
      text = chunks.join("\n");
      break;
    }

    case "find": {
      const needle = (argv[1] ?? "").replace(/\*/g, "");
      const all = [...Object.keys(fs), ...Object.keys(view)];
      text = all
        .filter((p) => p.includes(needle))
        .sort()
        .join("\n");
      break;
    }

    case "file": {
      const p = pathArg(argv[1]);
      const r = readForCommand(fs, view, p);
      if (!r.found) throw new ExecError(`${argv[1] ?? ""}: no such file`);
      const ext = p.slice(p.lastIndexOf(".") + 1);
      const kind =
        /\.(txt|md|log|motd|conf|cfg|ini)$/.test(p) || ext === p
          ? "ASCII text"
          : /\.(json|ya?ml)$/.test(p)
            ? "JSON/YAML data"
            : /\.(png|jpg|jpeg|gif|webp)$/.test(p)
              ? "image data"
              : "data";
      text = `${argv[1]}: ${kind}`;
      break;
    }

    case "strings": {
      const content = readTarget(argv[1]).content;
      const runs = content.match(/[\x20-\x7E]{4,}/g) ?? [];
      text = runs.join("\n");
      break;
    }

    case "hexdump": {
      const content = readTarget(argv[1]).content;
      const out: string[] = [];
      for (let i = 0; i < content.length; i += 16) {
        const slice = [...content.slice(i, i + 16)];
        const hex = slice.map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
        const ascii = slice.map((c) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : ".")).join("");
        out.push(`${i.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  |${ascii}|`);
      }
      text = out.join("\n");
      break;
    }

    case "stat": {
      const p = pathArg(argv[1]);
      const r = readForCommand(fs, view, p);
      if (r.found) {
        events.push({ type: "TerminalRead", host: ctx.host, path: p });
        text = `  File: ${p}\n  Size: ${r.content.length}\n Type: ${r.fromOverlay ? "overlay file" : "world file"}`;
      } else if (isDir(fs, view, p)) {
        text = `  File: ${p}\n Type: directory`;
      } else {
        throw new ExecError(`stat: ${argv[1] ?? ""}: no such file or directory`);
      }
      break;
    }

    case "whoami":
      text = ctx.user;
      break;

    case "date":
      text = ctx.now;
      break;

    case "decode": {
      const mode = argv[1];
      const payload = argv.slice(2).join(" ");
      if (mode === "base64") {
        text = Buffer.from(payload, "base64").toString("utf8");
      } else if (mode === "hex") {
        const hex = payload.replace(/[^0-9a-fA-F]/g, "");
        if (hex.length % 2 !== 0) throw new ExecError("decode: hex input has odd length");
        text = Buffer.from(hex, "hex").toString("utf8");
      } else if (mode === "rot13") {
        text = payload.replace(/[a-zA-Z]/g, (c) => {
          const base = c <= "Z" ? 65 : 97;
          return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });
      } else {
        throw new ExecError("usage: decode <base64|hex|rot13> <text>");
      }
      break;
    }

    case "log": {
      const repo = (ctx.forge ?? []).find((r) => cwdN === r.path || cwdN.startsWith(`${r.path.replace(/\/+$/, "")}/`));
      if (!repo) throw new ExecError("log: not inside a repository directory");
      text = repo.commits
        .map((c) => `commit ${c.sha}\nAuthor: ${c.authorName}\nDate:   ${c.date}\n\n    ${c.message.split("\n").join("\n    ")}`)
        .join("\n\n");
      break;
    }

    case "verify": {
      const name = argv[1];
      if (name === undefined) throw new ExecError("usage: verify <name>");
      const result = ctx.verify?.(name);
      if (result === undefined) throw new ExecError(`verify: no signed artifact matching '${name}'`);
      text = result.valid
        ? `${name}: signature VALID\n  key id: ${result.keyId}\n  fingerprint: ${result.fingerprint}`
        : `${name}: signature INVALID`;
      break;
    }

    case "less":
      text = readTarget(argv[1]).content;
      break;

    default:
      throw new ExecError(`${cmd}: command not found (try help)`);
  }

  text = applyFilters(text, pipeline);

  if (pipeline.redirect) {
    const target = normalizePath("/", pipeline.redirect.path).replace(/^\/+/, "");
    if (target === "") throw new ExecError("redirection: bad file name");
    const existingOverlayCount = Object.keys(overlay).length + Object.keys(overlayPatch).length;
    if (!(pipeline.redirect.path in overlay) && existingOverlayCount >= MAX_OVERLAY_FILES) {
      throw new ExecError(`overlay limit reached (${MAX_OVERLAY_FILES} files)`);
    }
    if (text.length > MAX_FILE_SIZE) throw new ExecError("redirection: file exceeds 64 KB limit");
    overlayPatch[target] = text;
    events.push({ type: "TerminalOverlayWrite", host: ctx.host, path: target });
    return { output: "", cwd: cwdN, overlayPatch, events };
  }

  return { output: capOutput(text), cwd: cwdN, overlayPatch, events };
}
