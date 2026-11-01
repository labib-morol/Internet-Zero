import { exec as terminalExec, type ExecContext, type ForgeRepoIndex } from "@iz/terminal";
import type { GameEvent, RuntimeState, WorldBundle } from "@iz/schema";
import { hostReachable } from "@iz/runtime";

/**
 * Server-side terminal command execution (M1 task 7, server half). The
 * runtime only gates the terminal action (§9); this module runs
 * packages/terminal's simulated interpreter against the world filesystem and
 * the team's overlay, then returns the events to append. No player input is
 * ever executed on the host — the interpreter is a pure reducer over
 * in-world files.
 */

export type TerminalRunResult =
  | {
      ok: true;
      output: string;
      cwd: string;
      events: GameEvent[];
      /** Present when the command was `connect <host>`; carries the passphrase gate. */
      connect?: { target: string; gateId?: string; connected: boolean };
    }
  | { ok: false; code: "not_found" | "locked" | "invalid_input"; message: string };

export function buildWorldFs(bundle: WorldBundle, host: string): Record<string, string> {
  const fs: Record<string, string> = {};
  for (const artifact of bundle.artifacts) {
    if (artifact.host === host && artifact.kind === "terminal-file") {
      fs[artifact.path.startsWith("/") ? artifact.path : `/${artifact.path}`] = artifact.body;
    }
  }
  return fs;
}

function overlayForHost(state: RuntimeState, host: string): Record<string, string> {
  const overlay: Record<string, string> = {};
  const prefix = `${host}:`;
  for (const [key, content] of Object.entries(state.overlayFs)) {
    if (key.startsWith(prefix)) {
      overlay[key.slice(prefix.length).replace(/^\/+/, "")] = content;
    }
  }
  return overlay;
}

function forgeIndex(bundle: WorldBundle): ForgeRepoIndex[] {
  return bundle.forge.map((repo) => ({
    owner: repo.owner,
    name: repo.name,
    path: `/${repo.owner}/${repo.name}`,
    commits: repo.commits.map((c) => ({
      sha: c.sha,
      date: c.date,
      message: c.message,
      authorName: c.author.name,
    })),
  }));
}

/** `verify <name>`: match a signed commit artifact by id/sha prefix. */
function verifier(bundle: WorldBundle) {
  return (name: string): { valid: boolean; fingerprint: string; keyId: string } | undefined => {
    for (const artifact of bundle.artifacts) {
      if (artifact.kind !== "commit") continue;
      const sha = artifact.id.replace(/^a\./, "");
      if (!artifact.id.includes(name) && !sha.startsWith(name)) continue;
      const signature = findSignatureNode(artifact.ast);
      if (signature !== undefined) {
        return { valid: signature.valid, fingerprint: signature.fingerprint, keyId: signature.keyId };
      }
    }
    return undefined;
  };
}

function findSignatureNode(node: { type: string; [k: string]: unknown }): { valid: boolean; fingerprint: string; keyId: string } | undefined {
  if (node.type === "signature") {
    return {
      valid: node.valid as boolean,
      fingerprint: node.fingerprint as string,
      keyId: node.keyId as string,
    };
  }
  for (const child of (node.children as Array<{ type: string; [k: string]: unknown }> | undefined) ?? []) {
    const hit = findSignatureNode(child);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export function runTerminalCommand(
  bundle: WorldBundle,
  state: RuntimeState,
  host: string,
  cwd: string,
  line: string,
  actorUserId: string,
  now: string
): TerminalRunResult {
  const hostDef = bundle.world.hosts.find((h) => h.host === host);
  if (hostDef === undefined || hostDef.service !== "terminal") {
    return { ok: false, code: "not_found", message: "Host not found." };
  }
  const isUnlocked = (id: string) => state.unlocked.has(id);
  if (!hostReachable(bundle, hostDef, state, isUnlocked, now)) {
    return { ok: false, code: "locked", message: "This host is not available." };
  }

  // The host's own passphrase gate (§10.5): until solved, only the prompt is served.
  const terminalArtifact = bundle.artifacts.find((a) => a.host === host && a.kind === "terminal-file");
  const connectGate = typeof terminalArtifact?.meta.connectGate === "string" ? terminalArtifact.meta.connectGate : undefined;
  if (connectGate !== undefined && state.solvedGates[connectGate] === undefined) {
    return {
      ok: true,
      output: `connecting to ${host}…
passphrase: `,
      cwd,
      events: [],
      connect: { target: host, gateId: connectGate, connected: false },
    };
  }

  // `connect <target>` is a host-level, gate-checked operation (§10.5) — the
  // interpreter never sees it. A passphrase prompt is the host's connectGate.
  const connectMatch = /^connect\s+(\S+)\s*$/.exec(line.trim());
  if (connectMatch !== null) {
    const target = connectMatch[1]!;
    const targetDef = bundle.world.hosts.find((h) => h.host === target && h.service === "terminal");
    const targetUnlocked = targetDef !== undefined && hostReachable(bundle, targetDef, state, isUnlocked, now);
    const targetTerminalArtifact = bundle.artifacts.find((a) => a.host === target && a.kind === "terminal-file");
    const gateId = typeof targetTerminalArtifact?.meta.connectGate === "string" ? targetTerminalArtifact.meta.connectGate : undefined;
    if (targetDef === undefined || targetDef.host === host) {
      return { ok: false, code: "not_found", message: "Host not found." };
    }
    if (!targetUnlocked) {
      if (gateId === undefined) {
        return { ok: false, code: "locked", message: "This host is not available." };
      }
      const gateSolved = state.solvedGates[gateId] !== undefined;
      if (!gateSolved) {
        return {
          ok: true,
          output: `connecting to ${target}…\npassphrase: `,
          cwd,
          events: [],
          connect: { target, gateId, connected: false },
        };
      }
      return {
        ok: true,
        output: `connected to ${target}`,
        cwd: "/",
        events: [],
        connect: { target, connected: true },
      };
    }
    return { ok: true, output: `already connected to ${target}`, cwd, events: [], connect: { target, connected: true } };
  }

  const fs = buildWorldFs(bundle, host);
  const overlay = overlayForHost(state, host);
  const ctx: ExecContext = {
    host,
    user: actorUserId,
    now,
    forge: forgeIndex(bundle),
    verify: verifier(bundle),
  };

  let result;
  try {
    result = terminalExec(fs, overlay, cwd, line, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : "command failed";
    if (message.includes("command too long")) return { ok: false, code: "invalid_input", message };
    return { ok: true, output: `${message}`, cwd, events: [] };
  }

  const events: GameEvent[] = result.events.map((e) =>
    e.type === "TerminalOverlayWrite"
      ? {
          type: "TerminalOverlayWrite",
          host: e.host,
          path: e.path,
          content: result.overlayPatch[e.path] ?? "",
          at: now,
          by: actorUserId,
          actorKind: "human" as const,
        }
      : { type: "TerminalRead", host: e.host, path: e.path, at: now, by: actorUserId, actorKind: "human" as const }
  );
  return { ok: true, output: result.output, cwd: result.cwd, events };
}
