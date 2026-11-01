import type { Artifact, Cond } from "@iz/schema";
import { ARCHIVE_SERVICE, FORGE_SERVICE, MAIL_SERVICE, TERMINAL_SERVICE } from "@iz/services";
import type { LoadContext } from "@iz/services";
import type { AssetIndex } from "./assets.js";
import { BuildError, issueFromError } from "./errors.js";
import type { WorldSourceFiles } from "./source.js";

/**
 * Artifactization: hands each service's parsed source to the frozen
 * ServiceModule.load() contract and collects the resulting artifacts. Also
 * derives artifact visibility conditions from gate unlocks and reveal events
 * (the schema's "extra visibility condition on top of host reachability").
 */

export type ArtifactizeResult = {
  artifacts: Artifact[];
  warnings: string[];
};

function serviceContext(source: WorldSourceFiles, assets: AssetIndex): LoadContext {
  return {
    world: {
      world: source.world,
      people: source.people,
      orgs: source.orgs,
      identities: source.identities,
      facts: source.facts,
      beliefs: source.beliefs,
      statements: source.statements,
      proofs: source.proofs,
      gates: source.gates,
      reports: source.reports,
      hints: source.hints,
      events: source.events,
    },
    assets: assets.byKey,
  };
}

/** Runs one service load and converts failures into build issues with file context. */
function loadArtifacts(service: { load(source: unknown, ctx: LoadContext): Artifact[] }, payload: unknown, ctx: LoadContext, file: string): Artifact[] {
  try {
    return service.load(payload, ctx);
  } catch (error) {
    throw new BuildError([issueFromError(error, file)]);
  }
}

export function artifactize(source: WorldSourceFiles, assets: AssetIndex): ArtifactizeResult {
  const warnings: string[] = [];
  const ctx = serviceContext(source, assets);
  const artifacts: Artifact[] = [];

  for (const { file, repo } of source.forge) {
    artifacts.push(...loadArtifacts(FORGE_SERVICE, { repos: [repo] }, ctx, file));
  }

  for (const { file, mailbox } of source.mail) {
    artifacts.push(...loadArtifacts(MAIL_SERVICE, { mailboxes: [mailbox] }, ctx, file));
  }

  for (const { file, meta, body } of source.archive) {
    artifacts.push(...loadArtifacts(ARCHIVE_SERVICE, { docs: [{ meta, body }] }, ctx, file));
  }

  if (source.terminalFiles.length > 0 || source.terminalFs.hosts.length > 0) {
    artifacts.push(...loadArtifacts(TERMINAL_SERVICE, { fs: source.terminalFs, files: source.terminalFiles }, ctx, "services/terminal/fs.yaml"));
  }

  // Artifact visibility from gate unlocks and reveal events.
  const visibility = new Map<string, Cond[]>();
  const push = (artifactId: string, cond: Cond): void => {
    const list = visibility.get(artifactId) ?? [];
    list.push(cond);
    visibility.set(artifactId, list);
  };

  const artifactIds = new Set(artifacts.map((a) => a.id));
  for (const gate of source.gates) {
    for (const unlocked of gate.unlocks) {
      if (artifactIds.has(unlocked)) push(unlocked, { gateSolved: gate.id });
    }
  }
  for (const event of source.events) {
    for (const effect of event.effects) {
      if (effect.kind === "reveal") {
        push(effect.artifact, eventTriggerCond(event));
      } else if (effect.kind === "addCommit") {
        push(effect.commit, eventTriggerCond(event));
      } else if (effect.kind === "deliverMail") {
        // Delivered messages already exist as artifacts; flag possible double delivery.
        const staticallyListed = source.mail.some((m) => m.mailbox.messages.some((msg) => msg.id === effect.message));
        if (staticallyListed) {
          warnings.push(`event ${event.id} delivers message ${effect.message} which is also listed statically in its mailbox`);
        }
        push(effect.message, eventTriggerCond(event));
      }
    }
  }
  for (const artifact of artifacts) {
    const conds = visibility.get(artifact.id);
    if (conds === undefined) continue;
    artifact.visibility = conds.length === 1 ? conds[0] : { all: conds };
  }

  // Service-content sanity: service content requires a matching host.
  const servicesWithContent = new Set<string>();
  if (source.forge.length > 0) servicesWithContent.add("forge");
  if (source.mail.length > 0) servicesWithContent.add("mail");
  if (source.archive.length > 0) servicesWithContent.add("archive");
  for (const service of servicesWithContent) {
    const count = source.world.hosts.filter((h) => h.service === service).length;
    if (count === 0) {
      throw new BuildError([{ check: 2, file: "world.yaml", message: `world has ${service} content but world.yaml declares no ${service} host` }]);
    }
    if (count > 1) {
      const names = source.world.hosts.filter((h) => h.service === service).map((h) => h.host).join(", ");
      throw new BuildError([
        { check: 2, file: "world.yaml", message: `world declares multiple ${service} hosts (${names}); services other than terminal must have exactly one host` },
      ]);
    }
  }

  const covered = new Set(artifacts.map((a) => a.host));
  for (const host of source.world.hosts) {
    if (!covered.has(host.host)) warnings.push(`host ${host.host} has no artifacts`);
  }

  // Duplicate artifact ids (stable identity is part of reference resolution, check 2).
  const seen = new Map<string, number>();
  for (const artifact of artifacts) seen.set(artifact.id, (seen.get(artifact.id) ?? 0) + 1);
  for (const [id, count] of seen) {
    if (count > 1) {
      throw new BuildError([{ check: 2, file: "(artifacts)", id, message: `duplicate artifact id "${id}" (${count} artifacts); ids must be globally unique` }]);
    }
  }

  artifacts.sort((a, b) => a.id.localeCompare(b.id));
  return { artifacts, warnings };
}

function eventTriggerCond(event: WorldSourceFiles["events"][number]): Cond {
  if (event.trigger.kind === "after") return { gateSolved: event.trigger.gateSolved };
  return { timeReached: event.trigger.time };
}
