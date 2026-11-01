import { describe, expect, it } from "vitest";
import { WorldYaml } from "../src/world.js";
import { WorldBundle } from "../src/bundle.js";
import { worldFormatJsonSchema } from "../src/index.js";
import { minimalBundle } from "./helpers.js";

const validWorld = minimalBundle().world;

describe("WorldYaml", () => {
  it("accepts the tutorial shape", () => {
    expect(WorldYaml.parse(validWorld)).toEqual(validWorld);
  });

  it("rejects unknown keys", () => {
    expect(WorldYaml.safeParse({ ...validWorld, sneaky: 1 }).success).toBe(false);
  });

  it("rejects bad semver, bad ids, uppercase suffix", () => {
    expect(WorldYaml.safeParse({ ...validWorld, version: "1.0" }).success).toBe(false);
    expect(WorldYaml.safeParse({ ...validWorld, id: "Tutorial" }).success).toBe(false);
    expect(WorldYaml.safeParse({ ...validWorld, hostSuffix: "PCP" }).success).toBe(false);
  });

  it("requires at least one host and one report", () => {
    expect(WorldYaml.safeParse({ ...validWorld, hosts: [] }).success).toBe(false);
    expect(WorldYaml.safeParse({ ...validWorld, reports: [] }).success).toBe(false);
  });
});

describe("WorldBundle", () => {
  it("accepts the minimal bundle", () => {
    expect(WorldBundle.parse(minimalBundle()).canon.facts).toHaveLength(1);
  });

  it("rejects a bundle whose answer hashes are not sha256 hex", () => {
    const b = minimalBundle();
    const slot = b.reports[0]!.groups[0]!.slots[0]!;
    slot.answerHashes = ["short"];
    expect(WorldBundle.safeParse(b).success).toBe(false);
  });

  it("requires a bundleSalt of at least 16 chars and a sha256 bundleHash", () => {
    const b = minimalBundle();
    b.bundleSalt = "short";
    expect(WorldBundle.safeParse(b).success).toBe(false);
  });
});

describe("worldFormatJsonSchema", () => {
  it("emits JSON Schema documents from the Zod schemas", () => {
    const schemas = worldFormatJsonSchema();
    for (const key of ["WorldYaml", "WorldSource", "Fact", "Gate", "Report"]) {
      const doc = schemas[key];
      expect(doc, key).toBeTruthy();
    }
  });
});
