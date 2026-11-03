import type { WorldBundle } from "../src/bundle.js";
import type { SafeNode } from "../src/safe-ast.js";

const text = (value: string): SafeNode => ({ type: "text", value });
const para = (...children: SafeNode[]): SafeNode => ({ type: "paragraph", children });
export const rootAst = (...children: SafeNode[]): SafeNode => ({ type: "root", children });

/** Minimal valid bundle used by schema tests and shared as a reference shape. */
export function minimalBundle(): WorldBundle {
  return {
    world: {
      id: "tutorial",
      version: "1.0.0",
      format: "iz/1",
      title: "Lost and Found",
      summary: "An intern lost the office printer password. Find it.",
      license: "CC-BY-4.0",
      hostSuffix: "pcp",
      clock: { mode: "session", epoch: "2026-11-02T09:00:00Z" },
      hosts: [{ host: "forge.pinecone.pcp", service: "forge" }],
      entry: "forge.pinecone.pcp/pinecone/office-scripts",
      reports: ["r.final"],
    },
    entities: [{ id: "p.rowan", displayName: "Rowan Hale" }],
    identities: [
      {
        id: "id.rowan-forge",
        service: "forge",
        login: "rowan",
        displayName: "Rowan Hale",
        person: "p.rowan",
        deleted: true,
      },
    ],
    artifacts: [
      {
        id: "a.repo",
        host: "forge.pinecone.pcp",
        path: "/pinecone/office-scripts",
        kind: "repo",
        title: "office-scripts",
        body: "Pinecone office scripts",
        ast: rootAst(para(text("Pinecone office scripts"))),
        meta: {},
        collectible: false,
      },
    ],
    gates: [
      {
        id: "g.first-commit",
        title: "Find the rotation commit",
        check: { kind: "evidenceSet", mustCollect: ["a.commit-0002"], mustLink: [] },
        unlocks: [],
        score: 100,
      },
    ],
    reports: [
      {
        id: "r.final",
        title: "Case report",
        groups: [
          {
            id: "A",
            slots: [
              {
                id: "who",
                label: "Who changed the passphrase?",
                type: "identity",
                fact: "f.rotation",
                answerHashes: ["a".repeat(64)],
              },
            ],
          },
        ],
      },
    ],
    hints: [{ gate: "g.first-commit", tier: 1, text: "Look at recent commits.", cost: 10 }],
    events: [],
    canon: {
      facts: [
        {
          id: "f.rotation",
          proposition: { subject: "p.rowan", predicate: "changedPassphraseOf", object: "printer" },
          required: true,
          secrecy: "secret",
        },
      ],
      beliefs: [],
      statements: [],
      proofs: [{ fact: "f.rotation", artifacts: ["a.commit-0002"], strength: "direct" }],
    },
    assets: [],
    forge: [],
    mailboxes: [],
    forum: [],
    bundleSalt: "0123456789abcdef",
    bundleHash: "b".repeat(64),
  };
}
