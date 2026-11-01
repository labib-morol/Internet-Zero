import type { Artifact, Cond } from "@iz/schema";
import type { BuildIssue } from "./errors.js";
import type { WorldSourceFiles } from "./source.js";

/**
 * Build check 7 — reachability.
 *
 * Walks the gate graph from the entry host with a simulated player who solves
 * every gate: hosts unlock when their `requires` condition holds, collectible
 * artifacts on reachable hosts get collected, report gates establish their
 * slots' facts, and events fire when their trigger condition holds. At the
 * fixpoint every gate must be solved; a gate that never solves is either part
 * of a requirement cycle or unsatisfiable, and both are build failures.
 *
 * Session/global clock: `timeReached` is treated as eventually true.
 * Team size: `teamSizeAtLeast` is treated as satisfiable (simulate a full team).
 */

export type ReachStep = { kind: "host" | "gate" | "artifact" | "event"; id: string; reason: string };

export type ReachTree = {
  entry: string;
  steps: ReachStep[];
  solvedGates: string[];
  reachableHosts: string[];
  reachableArtifacts: string[];
};

export type ReachResult = {
  tree: ReachTree;
  reachableArtifacts: Set<string>;
  solvedGates: Set<string>;
  reachableHosts: Set<string>;
};

type SimState = {
  hosts: Set<string>;
  solved: Set<string>;
  visible: Set<string>;
  collected: Set<string>;
  established: Set<string>;
};

function evalCond(cond: Cond, state: SimState): boolean {
  if ("all" in cond) return cond.all.every((c) => evalCond(c, state));
  if ("any" in cond) return cond.any.some((c) => evalCond(c, state));
  if ("not" in cond) return !evalCond(cond.not, state);
  if ("gateSolved" in cond) return state.solved.has(cond.gateSolved);
  if ("evidenceCollected" in cond) return state.collected.has(cond.evidenceCollected);
  if ("factEstablished" in cond) return state.established.has(cond.factEstablished);
  if ("timeReached" in cond) return true; // eventually reached on session/global clocks
  return true; // teamSizeAtLeast: simulated player may bring a full team
}

export function simulateReachability(source: WorldSourceFiles, artifacts: Artifact[], add: (issue: BuildIssue) => void): ReachResult {
  const entry = source.world.entry;
  const entryHost = entry.includes("/") ? entry.slice(0, entry.indexOf("/")) : entry;
  const entryPath = entry.includes("/") ? entry.slice(entry.indexOf("/") + 1) : "";

  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const collectibleIds = new Set(artifacts.filter((a) => a.collectible).map((a) => a.id));
  const hostDefs = source.world.hosts;
  const gates = [...source.gates].sort((a, b) => a.id.localeCompare(b.id));
  const events = [...source.events].sort((a, b) => a.id.localeCompare(b.id));

  const state: SimState = { hosts: new Set(), solved: new Set(), visible: new Set(), collected: new Set(), established: new Set() };
  const steps: ReachStep[] = [];

  // Initial hosts: no `requires`. The entry host must be one of them.
  for (const host of hostDefs) {
    if (host.requires === undefined) {
      state.hosts.add(host.host);
      steps.push({ kind: "host", id: host.host, reason: "available from the start" });
    }
  }
  if (!state.hosts.has(entryHost)) {
    add({ check: 7, file: "world.yaml", message: `entry host "${entryHost}" is not initially available; the player must start there (remove its requires or unlock it differently)` });
  }

  const refreshVisibility = (): boolean => {
    let changed = false;
    for (const artifact of artifacts) {
      if (state.visible.has(artifact.id)) continue;
      if (!state.hosts.has(artifact.host)) continue;
      if (artifact.visibility !== undefined && !evalCond(artifact.visibility, state)) continue;
      state.visible.add(artifact.id);
      steps.push({ kind: "artifact", id: artifact.id, reason: `visible on reachable host ${artifact.host}` });
      changed = true;
    }
    for (const id of state.visible) {
      if (collectibleIds.has(id) && !state.collected.has(id)) {
        state.collected.add(id);
        changed = true;
      }
    }
    return changed;
  };

  refreshVisibility();

  // The player starts at the entry artifact; it must be visible immediately.
  const entryArtifact = artifacts.find((a) => a.host === entryHost && a.path === entryPath);
  if (entryArtifact !== undefined && !state.visible.has(entryArtifact.id)) {
    add({ check: 7, file: "world.yaml", message: `entry artifact "${entryArtifact.id}" is not visible at session start` });
  }

  // Fixpoint: solve gates, fire events, unlock hosts, re-evaluate visibility.
  let changed = true;
  while (changed) {
    changed = false;

    for (const host of hostDefs) {
      if (state.hosts.has(host.host)) continue;
      if (host.requires !== undefined && !evalCond(host.requires, state)) continue;
      state.hosts.add(host.host);
      steps.push({ kind: "host", id: host.host, reason: "requires condition satisfied" });
      changed = true;
    }

    for (const gate of gates) {
      if (state.solved.has(gate.id)) continue;
      if (gate.requires !== undefined && !evalCond(gate.requires, state)) continue;
      if (!gateSolvable(gate.check, state, collectibleIds)) continue;
      state.solved.add(gate.id);
      steps.push({ kind: "gate", id: gate.id, reason: "solved by the simulated player" });
      changed = true;
      for (const unlocked of gate.unlocks) {
        const host = hostDefs.find((h) => h.host === unlocked);
        if (host !== undefined && !state.hosts.has(unlocked)) {
          state.hosts.add(unlocked);
          steps.push({ kind: "host", id: unlocked, reason: `unlocked by gate ${gate.id}` });
          changed = true;
        }
        if (byId.has(unlocked) && !state.visible.has(unlocked)) {
          state.visible.add(unlocked);
          steps.push({ kind: "artifact", id: unlocked, reason: `unlocked by gate ${gate.id}` });
          changed = true;
        }
      }
      // Report gates establish their slots' facts when accepted.
      if (gate.check.kind === "report") {
        const reportId = gate.check.report;
        const report = source.reports.find((r) => r.id === reportId);
        if (report !== undefined) {
          for (const group of report.groups) {
            for (const slot of group.slots) {
              if (!state.established.has(slot.fact)) {
                state.established.add(slot.fact);
                changed = true;
              }
            }
          }
        }
      }
    }

    for (const event of events) {
      if (event.trigger.kind === "after" && !state.solved.has(event.trigger.gateSolved)) continue;
      if (event.requires !== undefined && !evalCond(event.requires, state)) continue;
      if (steps.some((s) => s.kind === "event" && s.id === event.id)) continue;
      steps.push({ kind: "event", id: event.id, reason: "trigger condition satisfied" });
      changed = true;
      for (const effect of event.effects) {
        if (effect.kind === "deliverMail" || effect.kind === "reveal" || effect.kind === "addCommit") {
          const artifactId = effect.kind === "deliverMail" ? effect.message : effect.kind === "reveal" ? effect.artifact : effect.commit;
          if (byId.has(artifactId) && !state.visible.has(artifactId)) {
            state.visible.add(artifactId);
            steps.push({ kind: "artifact", id: artifactId, reason: `revealed by event ${event.id}` });
            changed = true;
          }
        } else if (effect.kind === "revealHosts") {
          for (const host of effect.hosts) {
            if (hostDefs.some((h) => h.host === host) && !state.hosts.has(host)) {
              state.hosts.add(host);
              steps.push({ kind: "host", id: host, reason: `revealed by event ${event.id}` });
              changed = true;
            }
          }
        }
      }
    }

    if (refreshVisibility()) changed = true;
  }

  // Every gate must have been solved; diagnose unsolved ones.
  const gateDeps = new Map<string, Set<string>>();
  for (const gate of gates) {
    const deps = new Set<string>();
    if (gate.requires !== undefined) collectGateDeps(gate.requires, deps);
    gateDeps.set(gate.id, deps);
  }
  for (const gate of gates) {
    if (state.solved.has(gate.id)) continue;
    if (dependsTransitivelyOnSelf(gate.id, gateDeps)) {
      add({ check: 7, file: "gates.yaml", id: gate.id, message: `gate ${gate.id} is part of a requirement cycle (it requires itself directly or transitively)` });
    } else {
      add({ check: 7, file: "gates.yaml", id: gate.id, message: `gate ${gate.id} can never be solved: its requires condition (or its check's host/collectibles) is unreachable from the entry` });
    }
  }

  return {
    tree: {
      entry,
      steps,
      solvedGates: [...state.solved].sort((a, b) => a.localeCompare(b)),
      reachableHosts: [...state.hosts].sort((a, b) => a.localeCompare(b)),
      reachableArtifacts: [...state.visible].sort((a, b) => a.localeCompare(b)),
    },
    reachableArtifacts: state.visible,
    solvedGates: state.solved,
    reachableHosts: state.hosts,
  };
}

function gateSolvable(check: WorldSourceFiles["gates"][number]["check"], state: SimState, collectibleIds: Set<string>): boolean {
  switch (check.kind) {
    case "answer":
    case "report":
      return true;
    case "terminal":
      return state.hosts.has(check.host);
    case "evidenceSet":
      return (
        check.mustCollect.every((id) => collectibleIds.has(id) && state.visible.has(id)) &&
        check.mustLink.every((link) => state.visible.has(link.from) && state.visible.has(link.to))
      );
  }
}

function collectGateDeps(cond: Cond, out: Set<string>): void {
  if ("all" in cond) cond.all.forEach((c) => collectGateDeps(c, out));
  else if ("any" in cond) cond.any.forEach((c) => collectGateDeps(c, out));
  else if ("not" in cond) collectGateDeps(cond.not, out);
  else if ("gateSolved" in cond) out.add(cond.gateSolved);
}

function dependsTransitivelyOnSelf(gateId: string, deps: Map<string, Set<string>>): boolean {
  const seen = new Set<string>();
  const stack = [...(deps.get(gateId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === gateId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(deps.get(current) ?? []));
  }
  return false;
}
