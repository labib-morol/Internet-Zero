import { z } from "zod";
import type { Artifact, Identity, Person, Org, ServiceId, WorldSource } from "@iz/schema";

/**
 * Frozen service contract (master prompt section 10, section 19.3).
 *
 * `assets` is keyed by BOTH the world-relative source path (e.g.
 * "assets/sticker.png", "services/mail/assets/x.pdf") and the content-addressed
 * asset id (the file's sha256 hex). Services resolve author-written asset
 * references through the path key and canonicalize them to the sha256 id.
 */
export type AssetRecord = { sha256: string; bytes: number; contentType: string };
export type LoadContext = { world: WorldSource; assets: Map<string, AssetRecord> };

/**
 * ServiceModule as frozen at the end of M0. The `view()` and `collectibles()`
 * members arrive in M1 and are deliberately omitted here (not stubbed).
 */
export interface ServiceModule {
  id: "forge" | "mail" | "archive" | "terminal" | "forum";
  /** Build time: turn a parsed service source into bundle artifacts. */
  load(source: unknown, ctx: LoadContext): Artifact[];
  /** In-game route patterns served by this service. */
  routes: string[];
}

/**
 * Errors thrown by service loaders. `check` suggests which build-check number
 * the compiler should report (2 = reference/shape resolution by default,
 * 1 = source schema problems).
 */
export class ServiceError extends Error {
  readonly check: number;
  constructor(message: string, check = 2) {
    super(message);
    this.name = "ServiceError";
    this.check = check;
  }
}

/** Validates a load() source payload defensively (the compiler pre-validated it). */
export function parseSource<T>(schema: z.ZodType<T>, source: unknown, service: string): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ServiceError(`${service} source is invalid: ${detail}`, 1);
  }
  return result.data;
}

/**
 * The single world host running `service`. Multi-host services need per-file
 * host assignment which the frozen source schemas cannot express, so more than
 * one host for forge/mail/archive is a build error.
 */
export function resolveHost(ctx: LoadContext, service: Exclude<ServiceId, "terminal" | "forum">): string {
  const hosts = ctx.world.world.hosts.filter((h) => h.service === service).map((h) => h.host);
  if (hosts.length === 0) {
    throw new ServiceError(`world has content for the ${service} service but declares no ${service} host in world.yaml`);
  }
  if (hosts.length > 1) {
    throw new ServiceError(`world declares multiple ${service} hosts (${hosts.join(", ")}); services other than terminal must have exactly one host`);
  }
  return hosts[0] as string;
}

/** All declared hosts for a service (terminal may run on several). */
export function resolveHosts(ctx: LoadContext, service: ServiceId): string[] {
  return ctx.world.world.hosts.filter((h) => h.service === service).map((h) => h.host);
}

/** Index of every identity in the world, by id. */
export function identityIndex(ctx: LoadContext): Map<string, Identity> {
  return new Map(ctx.world.identities.map((i) => [i.id, i]));
}

/** Index of persons and orgs by id. */
export function entityIndex(ctx: LoadContext): Map<string, Person | Org> {
  const map = new Map<string, Person | Org>();
  for (const p of ctx.world.people) map.set(p.id, p);
  for (const o of ctx.world.orgs) map.set(o.id, o);
  return map;
}

/** Best human-readable name for any entity or identity id (falls back to the id). */
export function entityName(ctx: LoadContext, id: string): string {
  const identity = identityIndex(ctx).get(id);
  if (identity) return identity.displayName || identity.login;
  const entity = entityIndex(ctx).get(id);
  if (entity) return "displayName" in entity ? entity.displayName : entity.name;
  return id;
}

/**
 * Resolves an author-written asset reference (world-relative path or a
 * content-addressed id) to the canonical sha256 id. Null when unknown.
 */
export function resolveAssetRef(ctx: LoadContext, ref: string): string | null {
  const normalized = ref.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  const record = ctx.assets.get(normalized) ?? (/^[0-9a-f]{64}$/.test(normalized) ? ctx.assets.get(normalized) : undefined);
  return record ? record.sha256 : null;
}

/** Sanitizes a string into an id fragment usable after the "a." prefix. */
export function sanitizeIdFragment(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/-+$/, "");
  if (slug.length === 0 || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) {
    throw new ServiceError(`cannot derive a stable artifact id from "${raw}"`);
  }
  return slug;
}

/** Deterministic artifact id for a terminal file: a.<host>.<sanitized path>. */
export function terminalFileId(host: string, path: string): string {
  const id = `a.${sanitizeIdFragment(host)}.${sanitizeIdFragment(path)}`;
  if (!/^[a-z]+\.[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
    throw new ServiceError(`derived terminal artifact id "${id}" is not a valid id`);
  }
  return id;
}
