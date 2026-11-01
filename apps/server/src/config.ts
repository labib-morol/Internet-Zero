import { readFileSync } from "node:fs";

/**
 * Environment (master prompt §17.2). A tiny .env loader so both the boot entry
 * (src/index.ts) and the tests can inject configuration; no extra dependency.
 */

export interface ServerConfig {
  databaseUrl: string;
  /** 32+ random bytes (validated at boot); signs session cookies. */
  sessionSecret: string;
  publicOrigin: string;
  worldsDir: string;
  logLevel: string;
  port: number;
  host: string;
}

/**
 * Parses a .env file and sets variables into process.env without overriding
 * values that are already present. Missing file is not an error.
 */
export function loadDotEnv(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key.length === 0) continue;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const SESSION_COOKIE = "iz_session";

/** Reads and validates configuration from the environment (§17.2). */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL ?? requireEnv("DATABASE_URL");
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a postgres:// or postgresql:// connection string");
  }
  const sessionSecret = env.SESSION_SECRET ?? requireEnv("SESSION_SECRET");
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  const publicOrigin = env.PUBLIC_ORIGIN ?? requireEnv("PUBLIC_ORIGIN");
  if (!/^https?:\/\//.test(publicOrigin)) {
    throw new Error("PUBLIC_ORIGIN must start with http:// or https://");
  }
  const worldsDir = env.WORLDS_DIR ?? requireEnv("WORLDS_DIR");
  const logLevel = env.LOG_LEVEL ?? "info";
  const port = env.PORT === undefined ? 8080 : Number(env.PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const host = env.HOST ?? "0.0.0.0";
  return { databaseUrl, sessionSecret, publicOrigin, worldsDir, logLevel, port, host };
}
