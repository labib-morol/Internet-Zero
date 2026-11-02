import type { AssetRecord, LoadContext } from "../src/index.js";
import type { WorldSource } from "@iz/schema";

/** Minimal valid WorldSource for service tests. */
export function makeWorldSource(overrides: Partial<WorldSource> = {}): WorldSource {
  return {
    world: {
      id: "fixture",
      version: "0.1.0",
      format: "iz/1",
      title: "Fixture",
      summary: "A fixture world.",
      license: "CC-BY-4.0",
      hostSuffix: "pcp",
      clock: { mode: "session", epoch: "2026-11-02T09:00:00Z" },
      hosts: [
        { host: "forge.fix.pcp", service: "forge" },
        { host: "mail.fix.pcp", service: "mail" },
        { host: "archive.fix.pcp", service: "archive" },
        { host: "term.fix.pcp", service: "terminal" },
      ],
      entry: "forge.fix.pcp/acme/notes",
      reports: [],
    },
    people: [],
    orgs: [],
    identities: [
      { id: "id.jamie-git", service: "forge", login: "jamiefox", displayName: "Jamie Fox", deleted: false },
      { id: "id.mara-mail", service: "mail", login: "mara.voss@acme.pcp", displayName: "Mara Voss", deleted: false },
      { id: "id.jamie-mail", service: "mail", login: "jamie.fox@acme.pcp", displayName: "Jamie Fox", deleted: false },
    ],
    facts: [],
    beliefs: [],
    statements: [],
    proofs: [],
    gates: [],
    reports: [],
    hints: [],
    events: [],
    ...overrides,
  };
}

export function makeCtx(assets: Record<string, AssetRecord> = {}, overrides: Partial<WorldSource> = {}): LoadContext {
  return { world: makeWorldSource(overrides), assets: new Map(Object.entries(assets)) };
}

export const STICKER: AssetRecord = { sha256: "ab".repeat(32), bytes: 67, contentType: "image/png" };
