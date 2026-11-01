import type { Artifact, Cond, Fact, SafeNode } from "@iz/schema";
import { SlotNormalizers, normalizeAnswer } from "@iz/schema";
import type { AssetIndex } from "./assets.js";
import type { BuildIssue } from "./errors.js";
import { simulateReachability } from "./reach.js";
import type { ReachTree } from "./reach.js";
import type { WorldSourceFiles } from "./source.js";
import { isRealTld } from "./tld.js";

/**
 * Build-time checks (master prompt section 6.5). Checks 1 and 7 have their own
 * modules (source.ts, reach.ts); this module implements 2, 3, 4, 5, 6, 8, 9,
 * 10, 11 and 12. The bundle-size half of check 10 runs in the pipeline once the
 * final JSON exists.
 */

const MAX_ARTIFACT_BODY_BYTES = 256 * 1024; // build check 10
const ID_RE = /^[a-z]+\.[a-z0-9][a-z0-9._-]{0,63}$/;

export type CheckOutput = {
  issues: BuildIssue[];
  warnings: string[];
  reachability: ReachTree;
};

export function runChecks(source: WorldSourceFiles, artifacts: Artifact[], assets: AssetIndex): CheckOutput {
  const issues: BuildIssue[] = [];
  const warnings: string[] = [];
  const add = (issue: BuildIssue): void => {
    issues.push(issue);
  };

  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const personIds = new Set(source.people.map((p) => p.id));
  const orgIds = new Set(source.orgs.map((o) => o.id));
  const identityIds = new Set(source.identities.map((i) => i.id));
  const entityIds = new Set([...personIds, ...orgIds, ...identityIds]);
  const gateIds = new Set(source.gates.map((g) => g.id));
  const reportIds = new Set(source.reports.map((r) => r.id));
  const factIds = new Set(source.facts.map((f) => f.id));
  const eventIds = new Set(source.events.map((e) => e.id));
  const hostIds = new Set(source.world.hosts.map((h) => h.host));
  const assetIds = new Set(assets.records.map((a) => a.id));
  const mailboxIds = new Set(source.mail.map((m) => m.mailbox.id));
  const messageIds = new Set(source.mail.flatMap((m) => m.mailbox.messages.map((msg) => msg.id)));
  const collectible = new Set(artifacts.filter((a) => a.collectible).map((a) => a.id));
  const terminalPathsByHost = new Map<string, Set<string>>();
  for (const artifact of artifacts) {
    if (artifact.kind !== "terminal-file") continue;
    const set = terminalPathsByHost.get(artifact.host) ?? new Set<string>();
    set.add(artifact.path.replace(/^\/+/, ""));
    terminalPathsByHost.set(artifact.host, set);
  }
  const entityNameOf = (id: string): string | null => {
    const person = source.people.find((p) => p.id === id);
    if (person !== undefined) return person.displayName;
    const org = source.orgs.find((o) => o.id === id);
    if (org !== undefined) return org.name;
    const identity = source.identities.find((i) => i.id === id);
    return identity !== undefined ? identity.displayName : null;
  };

  // --- check 7 first: the simulated player defines "reachable" for 5 and 6 ---
  const reach = simulateReachability(source, artifacts, add);

  checkReferences();
  checkFactContradictions();
  checkStatements();
  checkContradictingEvidence(reach.reachableArtifacts);
  checkRequiredProofs(reach.reachableArtifacts);
  checkReportSlots();
  checkHints();
  checkSizes();
  checkContentSafety();
  checkHostTlds();

  return { issues, warnings, reachability: reach.tree };

  // -------------------------------------------------------------------------

  function checkReferences(): void {
    // world.yaml
    const entry = source.world.entry;
    const entrySlash = entry.indexOf("/");
    const entryHost = entrySlash === -1 ? entry : entry.slice(0, entrySlash);
    const entryPath = entrySlash === -1 ? "" : entry.slice(entrySlash + 1);
    if (!hostIds.has(entryHost)) {
      add({ check: 2, file: "world.yaml", message: `entry host "${entryHost}" is not declared in world.yaml` });
    } else {
      const entryArtifact = artifacts.find((a) => a.host === entryHost && a.path === entryPath);
      if (entryArtifact === undefined) {
        add({ check: 2, file: "world.yaml", message: `entry "${entry}" does not resolve to an artifact (host + path)` });
      }
    }
    for (const report of source.world.reports) {
      if (!reportIds.has(report)) add({ check: 2, file: "world.yaml", id: report, message: `world.reports references unknown report "${report}"` });
    }

    // host requirements
    for (const host of source.world.hosts) {
      if (host.requires !== undefined) walkCond(host.requires, "world.yaml", host.host, `host ${host.host}.requires`);
    }

    // gates
    for (const gate of source.gates) {
      if (gate.requires !== undefined) walkCond(gate.requires, "gates.yaml", gate.id, `gate ${gate.id}.requires`);
      const check = gate.check;
      if (check.kind === "report") {
        if (!reportIds.has(check.report)) {
          add({ check: 2, file: "gates.yaml", id: gate.id, message: `gate ${gate.id} references unknown report "${check.report}"` });
        }
      } else if (check.kind === "evidenceSet") {
        for (const id of check.mustCollect) {
          if (!byId.has(id)) add({ check: 2, file: "gates.yaml", id: gate.id, message: `gate ${gate.id}.mustCollect references unknown artifact "${id}"` });
          else if (!collectible.has(id)) warnings.push(`gate ${gate.id}.mustCollect references artifact "${id}" which is not collectible`);
        }
        for (const link of check.mustLink) {
          for (const end of [link.from, link.to]) {
            if (!byId.has(end)) add({ check: 2, file: "gates.yaml", id: gate.id, message: `gate ${gate.id}.mustLink references unknown artifact "${end}"` });
          }
        }
      } else if (check.kind === "terminal") {
        if (!hostIds.has(check.host)) {
          add({ check: 2, file: "gates.yaml", id: gate.id, message: `gate ${check.kind} references unknown host "${check.host}"` });
        } else {
          const paths = terminalPathsByHost.get(check.host) ?? new Set<string>();
          for (const path of check.mustHaveRead) {
            const normalized = path.replace(/^\/+/, "");
            if (!paths.has(normalized)) {
              add({ check: 2, file: "gates.yaml", id: gate.id, message: `gate ${gate.id} requires reading "${path}" on ${check.host}, but no such terminal file exists` });
            }
          }
        }
      }
      for (const unlocked of gate.unlocks) {
        if (!hostIds.has(unlocked) && !byId.has(unlocked) && !reportIds.has(unlocked) && !eventIds.has(unlocked)) {
          add({ check: 2, file: "gates.yaml", id: gate.id, message: `gate ${gate.id}.unlocks references unknown "${unlocked}" (not a host, artifact, report or event)` });
        }
      }
    }

    // facts
    for (const fact of source.facts) {
      if (!entityIds.has(fact.proposition.subject)) {
        add({ check: 2, file: "facts.yaml", id: fact.id, message: `fact ${fact.id}.proposition.subject "${fact.proposition.subject}" is not a person, org or identity` });
      }
      checkEntityShapedObject(fact, "facts.yaml");
    }

    // beliefs
    for (const belief of source.beliefs) {
      if (!entityIds.has(belief.holder)) {
        add({ check: 2, file: "beliefs.yaml", message: `belief holder "${belief.holder}" is not a person, org or identity` });
      }
      if (!entityIds.has(belief.proposition.subject)) {
        add({ check: 2, file: "beliefs.yaml", message: `belief proposition.subject "${belief.proposition.subject}" is not a person, org or identity` });
      }
    }

    // statements
    for (const statement of source.statements) {
      if (!byId.has(statement.artifact)) {
        add({ check: 2, file: "statements.yaml", message: `statement references unknown artifact "${statement.artifact}"` });
      }
      if (!entityIds.has(statement.speaker)) {
        add({ check: 2, file: "statements.yaml", message: `statement speaker "${statement.speaker}" is not a person, org or identity` });
      }
      if (statement.truthful && statement.fact !== undefined && !factIds.has(statement.fact)) {
        add({ check: 2, file: "statements.yaml", message: `statement references unknown fact "${statement.fact}"` });
      }
    }

    // proofs
    for (const proof of source.proofs) {
      if (!factIds.has(proof.fact)) {
        add({ check: 2, file: "proofs.yaml", message: `proof references unknown fact "${proof.fact}"` });
      }
      for (const artifactId of proof.artifacts) {
        if (!byId.has(artifactId)) {
          add({ check: 2, file: "proofs.yaml", message: `proof for ${proof.fact} references unknown artifact "${artifactId}"` });
        }
      }
    }

    // report slots (fact existence + globally unique slot ids)
    const slotIds = new Map<string, number>();
    for (const report of source.reports) {
      for (const group of report.groups) {
        for (const slot of group.slots) {
          slotIds.set(slot.id, (slotIds.get(slot.id) ?? 0) + 1);
          if (!factIds.has(slot.fact)) {
            add({ check: 2, file: "reports.yaml", id: report.id, message: `report ${report.id} slot ${slot.id} references unknown fact "${slot.fact}"` });
          }
          if (slot.type === "choice" && (slot.options === undefined || slot.options.length === 0)) {
            add({ check: 2, file: "reports.yaml", id: report.id, message: `choice slot ${slot.id} must list options` });
          }
        }
      }
    }
    for (const [slotId, count] of slotIds) {
      if (count > 1) add({ check: 2, file: "reports.yaml", id: slotId, message: `slot id "${slotId}" is used ${count} times; slot ids must be globally unique` });
    }

    // hints
    for (const hint of source.hints) {
      if (!gateIds.has(hint.gate)) {
        add({ check: 2, file: "hints.yaml", message: `hint references unknown gate "${hint.gate}"` });
      }
    }

    // events
    for (const event of source.events) {
      if (event.trigger.kind === "after" && !gateIds.has(event.trigger.gateSolved)) {
        add({ check: 2, file: "events.yaml", id: event.id, message: `event ${event.id} trigger references unknown gate "${event.trigger.gateSolved}"` });
      }
      if (event.requires !== undefined) walkCond(event.requires, "events.yaml", event.id, `event ${event.id}.requires`);
      for (const effect of event.effects) {
        if (effect.kind === "deliverMail") {
          if (!mailboxIds.has(effect.mailbox)) {
            add({ check: 2, file: "events.yaml", id: event.id, message: `event ${event.id} delivers to unknown mailbox "${effect.mailbox}"` });
          }
          if (!messageIds.has(effect.message)) {
            add({ check: 2, file: "events.yaml", id: event.id, message: `event ${event.id} delivers unknown message "${effect.message}"` });
          } else {
            const owner = source.mail.find((m) => m.mailbox.messages.some((msg) => msg.id === effect.message));
            if (owner !== undefined && owner.mailbox.id !== effect.mailbox) {
              add({ check: 2, file: "events.yaml", id: event.id, message: `event ${event.id} delivers message "${effect.message}" to mailbox "${effect.mailbox}" but the message belongs to mailbox "${owner.mailbox.id}"` });
            }
          }
        } else if (effect.kind === "reveal") {
          if (!byId.has(effect.artifact)) {
            add({ check: 2, file: "events.yaml", id: event.id, message: `event ${event.id} reveals unknown artifact "${effect.artifact}"` });
          }
        } else if (effect.kind === "revealHosts") {
          for (const host of effect.hosts) {
            if (!hostIds.has(host)) {
              add({ check: 2, file: "events.yaml", id: event.id, message: `event ${event.id} reveals unknown host "${host}"` });
            }
          }
        } else if (effect.kind === "addCommit") {
          const repo = byId.get(effect.repo);
          if (repo === undefined || repo.kind !== "repo") {
            add({ check: 2, file: "events.yaml", id: event.id, message: `event ${event.id} addCommit references unknown repo "${effect.repo}"` });
          }
          const commit = byId.get(effect.commit);
          if (commit === undefined || commit.kind !== "commit") {
            add({ check: 2, file: "events.yaml", id: event.id, message: `event ${event.id} addCommit references unknown commit "${effect.commit}"` });
          }
        }
      }
    }

    // identities and entities
    for (const identity of source.identities) {
      if (identity.person !== undefined && !personIds.has(identity.person)) {
        add({ check: 2, file: "identities.yaml", id: identity.id, message: `identity ${identity.id} references unknown person "${identity.person}"` });
      }
      if (identity.org !== undefined && !orgIds.has(identity.org)) {
        add({ check: 2, file: "identities.yaml", id: identity.id, message: `identity ${identity.id} references unknown org "${identity.org}"` });
      }
    }

    // mailboxes and messages
    for (const { file, mailbox } of source.mail) {
      if (!entityIds.has(mailbox.owner)) {
        add({ check: 2, file, id: mailbox.id, message: `mailbox ${mailbox.id} owner "${mailbox.owner}" is not a person, org or identity` });
      }
      for (const message of mailbox.messages) {
        for (const endpoint of [message.from, ...message.to, ...message.cc]) {
          if (!identityIds.has(endpoint)) {
            add({ check: 2, file, id: message.id, message: `message ${message.id} references unknown mail identity "${endpoint}"` });
          } else {
            const identity = source.identities.find((i) => i.id === endpoint)!;
            if (identity.service !== "mail") {
              warnings.push(`message ${message.id} uses identity "${endpoint}" whose service is "${identity.service}", not "mail"`);
            }
          }
        }
        for (const attachment of message.attachments) {
          // Author refs are world-relative paths (or already content-addressed ids);
          // both are keys of the asset index.
          if (!assets.byKey.has(attachment.asset)) {
            add({ check: 2, file, id: message.id, message: `message ${message.id} attachment asset "${attachment.asset}" does not resolve to a world asset` });
          }
        }
      }
    }

    // forge identities + signatures
    for (const { file, repo } of source.forge) {
      for (const commit of repo.commits) {
        if (commit.author.identity !== undefined && !identityIds.has(commit.author.identity)) {
          add({ check: 2, file, id: commit.sha, message: `commit ${commit.sha} author identity "${commit.author.identity}" does not exist` });
        } else if (commit.author.identity !== undefined) {
          const identity = source.identities.find((i) => i.id === commit.author.identity)!;
          if (identity.service !== "forge") warnings.push(`commit ${commit.sha} author identity "${identity.id}" has service "${identity.service}", not "forge"`);
        }
        if (commit.signature !== undefined && !identityIds.has(commit.signature.signer)) {
          add({ check: 2, file, id: commit.sha, message: `commit ${commit.sha} signature signer "${commit.signature.signer}" does not exist` });
        }
      }
      for (const issue of repo.issues) {
        if (!identityIds.has(issue.author)) {
          add({ check: 2, file, id: repo.id, message: `issue ${issue.number} author "${issue.author}" does not exist` });
        }
        for (const comment of issue.comments) {
          if (!identityIds.has(comment.author)) {
            add({ check: 2, file, id: repo.id, message: `comment on issue ${issue.number} by "${comment.author}" does not exist` });
          }
        }
      }
      for (const user of repo.users) {
        if (user.identity !== undefined && !identityIds.has(user.identity)) {
          add({ check: 2, file, id: repo.id, message: `user ${user.login} references unknown identity "${user.identity}"` });
        }
      }
    }

    // AST signature nodes must name a real identity; asset references must resolve.
    for (const artifact of artifacts) {
      walkSafeAst(artifact.ast, (node) => {
        if (node.type === "signature" && !identityIds.has(node.signer)) {
          add({ check: 2, file: `(artifact ${artifact.id})`, id: artifact.id, message: `signature node signer "${node.signer}" is not a declared identity` });
        }
      });
      if (artifact.kind === "archive-document") {
        for (const id of String(artifact.meta.assets ?? "").split(",").filter((s) => s.length > 0)) {
          if (!assetIds.has(id)) {
            add({ check: 2, file: `(artifact ${artifact.id})`, id: artifact.id, message: `archive document references unknown asset "${id}"` });
          }
        }
      }
      if (artifact.kind === "mail-message" && typeof artifact.meta.attachments === "string") {
        try {
          const attachments = JSON.parse(artifact.meta.attachments) as Array<{ asset: string }>;
          for (const attachment of attachments) {
            if (!assetIds.has(attachment.asset)) {
              add({ check: 2, file: `(artifact ${artifact.id})`, id: artifact.id, message: `attachment asset "${attachment.asset}" does not resolve to a world asset` });
            }
          }
        } catch {
          add({ check: 1, file: `(artifact ${artifact.id})`, id: artifact.id, message: "attachment meta is not valid JSON" });
        }
      }
    }
  }

  function walkCond(cond: Cond, file: string, id: string, what: string): void {
    if ("all" in cond) {
      for (const inner of cond.all) walkCond(inner, file, id, what);
    } else if ("any" in cond) {
      for (const inner of cond.any) walkCond(inner, file, id, what);
    } else if ("not" in cond) {
      walkCond(cond.not, file, id, what);
    } else if ("gateSolved" in cond) {
      if (!gateIds.has(cond.gateSolved)) add({ check: 2, file, id, message: `${what} references unknown gate "${cond.gateSolved}"` });
    } else if ("evidenceCollected" in cond) {
      if (!byId.has(cond.evidenceCollected)) add({ check: 2, file, id, message: `${what} references unknown artifact "${cond.evidenceCollected}"` });
    } else if ("factEstablished" in cond) {
      if (!factIds.has(cond.factEstablished)) add({ check: 2, file, id, message: `${what} references unknown fact "${cond.factEstablished}"` });
    }
    // timeReached and teamSizeAtLeast carry no references.
  }

  function checkEntityShapedObject(fact: Fact, file: string): void {
    const object = fact.proposition.object;
    if (typeof object !== "string") return;
    const prefix = object.slice(0, object.indexOf("."));
    if (ID_RE.test(object) && ["p", "o", "id"].includes(prefix) && !entityIds.has(object)) {
      add({ check: 2, file, id: fact.id, message: `fact ${fact.id}.proposition.object "${object}" looks like an entity id but no such person, org or identity exists` });
    }
  }

  // --- check 3: contradictory facts -------------------------------------
  function checkFactContradictions(): void {
    for (let i = 0; i < source.facts.length; i++) {
      for (let j = i + 1; j < source.facts.length; j++) {
        const a = source.facts[i]!;
        const b = source.facts[j]!;
        if (a.proposition.subject !== b.proposition.subject) continue;
        if (a.proposition.predicate !== b.proposition.predicate) continue;
        if (objectsEqual(a.proposition.object, b.proposition.object)) continue;
        if (!validityOverlaps(a, b)) continue;
        add({
          check: 3,
          file: "facts.yaml",
          id: a.id,
          message: `facts ${a.id} and ${b.id} contradict: same subject "${a.proposition.subject}" and predicate "${a.proposition.predicate}" with different objects (${display(a.proposition.object)} vs ${display(b.proposition.object)}) over overlapping validity`,
        });
      }
    }
  }

  // --- check 4: truthful statements match their fact ---------------------
  function checkStatements(): void {
    for (const statement of source.statements) {
      if (!statement.truthful) continue;
      if (statement.fact === undefined) {
        add({ check: 2, file: "statements.yaml", message: `truthful statement about "${statement.proposition.predicate}" must reference a fact` });
        continue;
      }
      const fact = source.facts.find((f) => f.id === statement.fact);
      if (fact === undefined) continue; // already a check-2 issue
      const same =
        fact.proposition.subject === statement.proposition.subject &&
        fact.proposition.predicate === statement.proposition.predicate &&
        objectsEqual(fact.proposition.object, statement.proposition.object);
      if (!same) {
        add({
          check: 4,
          file: "statements.yaml",
          id: statement.fact,
          message: `truthful statement does not match fact ${statement.fact}: proposition (${statement.proposition.subject} ${statement.proposition.predicate} ${display(statement.proposition.object)}) vs fact (${fact.proposition.subject} ${fact.proposition.predicate} ${display(fact.proposition.object)})`,
        });
      }
    }
  }

  // --- check 5: reachable contradicting artifacts for lies ---------------
  /**
   * Approximation (documented per the build spec): an artifact "contradicts" a
   * false proposition P(subject, predicate, object) when its text contains the
   * object value of a fact sharing P's subject and predicate but with a
   * different object. Text search cannot verify the subject+predicate pairing,
   * so the world author guarantees it by placing the true object's value (or,
   * for entity objects, the entity's display name) in a reachable artifact.
   */
  function checkContradictingEvidence(reachable: Set<string>): void {
    const falseClaims: Array<{ file: string; id: string; label: string; proposition: Fact["proposition"] }> = [];
    for (const belief of source.beliefs) {
      if (belief.stance === "lies_about" || belief.stance === "believes_false") {
        falseClaims.push({ file: "beliefs.yaml", id: belief.holder, label: `${belief.stance} belief by ${belief.holder}`, proposition: belief.proposition });
      }
    }
    for (const statement of source.statements) {
      if (!statement.truthful) {
        falseClaims.push({ file: "statements.yaml", id: statement.artifact, label: `untruthful statement in ${statement.artifact}`, proposition: statement.proposition });
      }
    }

    for (const claim of falseClaims) {
      const contradictingFacts = source.facts.filter(
        (f) => f.proposition.subject === claim.proposition.subject && f.proposition.predicate === claim.proposition.predicate && !objectsEqual(f.proposition.object, claim.proposition.object),
      );
      if (contradictingFacts.length === 0) {
        add({
          check: 5,
          file: claim.file,
          id: claim.id,
          message: `${claim.label} asserts ${claim.proposition.subject} ${claim.proposition.predicate} ${display(claim.proposition.object)} but no fact states a different object for the same subject+predicate, so no contradiction can be shown`,
        });
        continue;
      }
      const searchStrings = contradictingFacts.flatMap((f) => objectSearchStrings(f.proposition.object, entityNameOf));
      const found = artifacts.some(
        (artifact) => reachable.has(artifact.id) && searchStrings.some((needle) => artifact.body.toLowerCase().includes(needle.toLowerCase())),
      );
      if (!found) {
        add({
          check: 5,
          file: claim.file,
          id: claim.id,
          message: `${claim.label} asserts ${claim.proposition.subject} ${claim.proposition.predicate} ${display(claim.proposition.object)} but no reachable artifact text contains the contradicting value(s): ${searchStrings.map((s) => `"${s}"`).join(", ")}`,
        });
      }
    }
  }

  // --- check 6: required facts have direct proofs -------------------------
  function checkRequiredProofs(reachable: Set<string>): void {
    for (const fact of source.facts) {
      if (!fact.required) continue;
      const directProofs = source.proofs.filter((p) => p.fact === fact.id && p.strength === "direct");
      const ok = directProofs.some((p) => p.artifacts.every((a) => reachable.has(a)));
      if (!ok) {
        add({
          check: 6,
          file: "facts.yaml",
          id: fact.id,
          message: `required fact ${fact.id} has no direct proof whose artifacts are all reachable`,
        });
      }
    }
  }

  // --- check 8: report slots match their facts ----------------------------
  function checkReportSlots(): void {
    for (const report of source.reports) {
      for (const group of report.groups) {
        for (const slot of group.slots) {
          const fact = source.facts.find((f) => f.id === slot.fact);
          if (fact === undefined) continue; // check 2
          const object = fact.proposition.object;
          const steps = SlotNormalizers[slot.type];
          const normalizedObject = normalizeAnswer(String(object), steps);

          let candidates: string[];
          if (slot.type === "identity" && typeof object === "string" && ID_RE.test(object) && entityIds.has(object)) {
            const name = entityNameOf(object);
            candidates = name === null ? [object] : [object, name];
          } else {
            candidates = [String(object)];
          }
          const normalizedCandidates = candidates.map((c) => normalizeAnswer(c, steps));

          for (const answer of slot.answers) {
            const normalized = normalizeAnswer(answer, steps);
            if (!normalizedCandidates.includes(normalized)) {
              add({
                check: 8,
                file: "reports.yaml",
                id: report.id,
                message: `report ${report.id} slot ${slot.id} (${slot.type}) answer "${answer}" does not match fact ${fact.id} object ${display(object)}`,
              });
            }
          }

          if (slot.type === "choice") {
            const options = slot.options ?? [];
            const normalizedOptions = options.map((o) => normalizeAnswer(o, steps));
            if (!normalizedOptions.includes(normalizedObject)) {
              add({
                check: 8,
                file: "reports.yaml",
                id: report.id,
                message: `report ${report.id} choice slot ${slot.id}: fact ${fact.id} object ${display(object)} is not among the listed options`,
              });
            }
            for (const answer of slot.answers) {
              if (!normalizedOptions.includes(normalizeAnswer(answer, steps))) {
                add({ check: 8, file: "reports.yaml", id: report.id, message: `report ${report.id} choice slot ${slot.id} answer "${answer}" is not among the listed options` });
              }
            }
          }
        }
      }
    }
  }

  // --- check 9: three hint tiers per gate ---------------------------------
  function checkHints(): void {
    for (const gate of source.gates) {
      const tiers = new Map<number, number>();
      for (const hint of source.hints.filter((h) => h.gate === gate.id)) {
        tiers.set(hint.tier, (tiers.get(hint.tier) ?? 0) + 1);
      }
      for (const tier of [1, 2, 3] as const) {
        const count = tiers.get(tier) ?? 0;
        if (count === 0) add({ check: 9, file: "hints.yaml", id: gate.id, message: `gate ${gate.id} has no tier-${tier} hint (every gate needs tiers 1, 2 and 3)` });
        if (count > 1) add({ check: 9, file: "hints.yaml", id: gate.id, message: `gate ${gate.id} has ${count} tier-${tier} hints; at most one per tier` });
      }
    }
  }

  // --- check 10 (artifact half): text artifact size -----------------------
  function checkSizes(): void {
    for (const artifact of artifacts) {
      const bytes = Buffer.byteLength(artifact.body, "utf8");
      if (bytes > MAX_ARTIFACT_BODY_BYTES) {
        add({ check: 10, file: `(artifact ${artifact.id})`, id: artifact.id, message: `text artifact body is ${bytes} bytes; the limit is ${MAX_ARTIFACT_BODY_BYTES}` });
      }
    }
  }

  // --- check 11: content safety on raw strings and resulting ASTs ---------
  function checkContentSafety(): void {
    // Raw source strings were already scanned during markdown compilation for
    // markdown bodies; this sweep covers every YAML string and terminal file.
    for (const ref of source.strings) {
      scanDangerous(ref.value, (reason) => add({ check: 11, file: ref.file, message: `${ref.path}: ${reason}` }));
    }
    for (const artifact of artifacts) {
      walkSafeAst(artifact.ast, (node) => {
        if (node.type === "link" || node.type === "image") {
          scanDangerous(node.url, (reason) => add({ check: 11, file: `(artifact ${artifact.id})`, id: artifact.id, message: reason }));
        }
      });
    }
  }

  // --- check 12: host suffix is not a real TLD ----------------------------
  function checkHostTlds(): void {
    if (isRealTld(source.world.hostSuffix)) {
      add({ check: 12, file: "world.yaml", message: `hostSuffix "${source.world.hostSuffix}" is a real top-level domain; invent one (see the vendored IANA list)` });
    }
    for (const host of source.world.hosts) {
      const lastLabel = host.host.split(".").pop() ?? "";
      if (isRealTld(lastLabel)) {
        add({ check: 12, file: "world.yaml", id: host.host, message: `host "${host.host}" ends in real TLD "${lastLabel}"; fictional hosts must use the world's own suffix` });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const RE_HTML_TAG =
  /<\s*\/?\s*(?:script|iframe|html|head|body|title|object|embed|style|link|meta|base|form|input|button|select|textarea|svg|math|template|frame|frameset|applet|portal|slot|audio|video|source|track|marquee|details|dialog|canvas|noscript|plaintext)\b/i;
const RE_EVENT_HANDLER = /\bon[a-z]{3,}\s*=/i;
const RE_DANGEROUS_URL = /(?:javascript|vbscript)\s*:/i;
const RE_DATA_HTML = /data:\s*text\/html/i;

/** Check-11 string scanner, shared with the markdown compiler's rule set. */
export function scanDangerous(value: string, report: (reason: string) => void): void {
  if (RE_HTML_TAG.test(value)) report("HTML markup is not allowed in world content");
  else if (RE_EVENT_HANDLER.test(value)) report("event-handler attributes are not allowed in world content");
  else if (RE_DANGEROUS_URL.test(value) || RE_DATA_HTML.test(value)) report("javascript:/vbscript:/data:text/html URLs are not allowed in world content");
}

/** Visits every node of a SafeNode tree. */
export function walkSafeAst(node: SafeNode, visit: (node: SafeNode) => void): void {
  visit(node);
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) walkSafeAst(child, visit);
  }
}

/** Canonical comparison for proposition objects across JSON types. */
export function objectsEqual(a: Fact["proposition"]["object"], b: Fact["proposition"]["object"]): boolean {
  if (typeof a !== typeof b) return false;
  return a === b;
}

/** Human display for a proposition object. */
export function display(object: Fact["proposition"]["object"]): string {
  return typeof object === "string" ? `"${object}"` : String(object);
}

/**
 * Search strings that count as "the artifact asserts this value": the raw
 * object value plus, for entity objects, the entity's display name.
 */
export function objectSearchStrings(object: Fact["proposition"]["object"], nameOf?: (id: string) => string | null): string[] {
  const out = [String(object)];
  if (typeof object === "string" && nameOf !== undefined) {
    const name = nameOf(object);
    if (name !== null && name.length > 0) out.push(name);
  }
  return out;
}

function validityOverlaps(a: Fact, b: Fact): boolean {
  const aFrom = a.validFrom ?? null;
  const aTo = a.validTo ?? null;
  const bFrom = b.validFrom ?? null;
  const bTo = b.validTo ?? null;
  const aStartsBeforeBEnds = aFrom === null || bTo === null || aFrom <= bTo;
  const bStartsBeforeAEnds = bFrom === null || aTo === null || bFrom <= aTo;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}
