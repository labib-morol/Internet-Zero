import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { Client } from "pg";
import type { ServerMsg } from "@iz/schema";
import { buildApp } from "../src/app.js";
import type { AppContext } from "../src/app-context.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Test infrastructure: a UNIQUE-NAME database per app on a real Postgres
 * instance, real migrations, the compiled fixture world — no mocks. Tests skip
 * cleanly only when Postgres is unreachable (set REQUIRE_POSTGRES=1, as CI
 * does, to fail instead of skip).
 */

const DEFAULT_ADMIN_URL = "postgres://intranet:intranet@localhost:5432/postgres";

/** Admin connection for destructive test setup (CREATE/DROP DATABASE). */
export const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL;

const LOCAL_ADMIN_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Builds the per-test database URL from the admin URL, swapping only the
 * database name. Refuses remote admin hosts unless TEST_ALLOW_REMOTE_ADMIN=1:
 * CREATE/DROP DATABASE is destructive, so pointing the harness at a
 * production instance must be an explicit, opt-in decision.
 */
export function deriveTestDatabaseUrl(dbName: string): string {
  const url = new URL(ADMIN_URL);
  // WHATWG URLs keep brackets on IPv6 hostnames ("[::1]"); strip for the check.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!LOCAL_ADMIN_HOSTS.has(hostname) && process.env.TEST_ALLOW_REMOTE_ADMIN !== "1") {
    throw new Error(
      `TEST_DATABASE_ADMIN_URL host "${hostname}" is not local — refusing destructive test setup. ` +
        "Point it at an isolated local/disposable Postgres, or set TEST_ALLOW_REMOTE_ADMIN=1 to opt in."
    );
  }
  url.pathname = `/${dbName}`;
  return url.toString();
}

export const FIXTURE_WORLDS_DIR = fileURLToPath(new URL("./fixtures/worlds", import.meta.url));
export const FIXTURE_WORLD_ID = "fixture";
export const FIXTURE_SOURCE_DIR = fileURLToPath(
  new URL("../../../packages/compiler/test/fixtures/valid-world", import.meta.url)
);

let pgUpPromise: Promise<boolean> | undefined;

/** True when the dev Postgres (iz-dev-pg) answers on :5432. Memoized. */
export function postgresUp(): Promise<boolean> {
  pgUpPromise ??= (async () => {
    try {
      const client = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2_000 });
      await client.connect();
      await client.query("select 1");
      await client.end();
      return true;
    } catch {
      return false;
    }
  })();
  return pgUpPromise;
}

export function testConfig(databaseUrl: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    databaseUrl,
    sessionSecret: "test-session-secret-0123456789abcdef0123456789abcdef",
    publicOrigin: "http://localhost:8080",
    worldsDir: FIXTURE_WORLDS_DIR,
    logLevel: "silent",
    port: 0,
    host: "127.0.0.1",
    trustProxy: false,
    ...overrides,
  };
}

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  dbName: string;
  databaseUrl: string;
  close(): Promise<void>;
}

/**
 * Builds an app against a freshly created, uniquely named database; close()
 * drops the database again. Migrations run inside buildApp (as at boot).
 */
export async function createTestApp(
  opts: {
    publicOrigin?: string;
    requestsPerMinute?: number;
    worldsDir?: string;
    trustProxy?: boolean;
    wsHelloTimeoutMs?: number;
  } = {}
): Promise<TestEnv> {
  const dbName = `iz_test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const databaseUrl = deriveTestDatabaseUrl(dbName);
  const config = testConfig(databaseUrl, {
    ...(opts.publicOrigin === undefined ? {} : { publicOrigin: opts.publicOrigin }),
    ...(opts.worldsDir === undefined ? {} : { worldsDir: opts.worldsDir }),
    ...(opts.trustProxy === undefined ? {} : { trustProxy: opts.trustProxy }),
  });
  const app = await buildApp({
    config,
    ...(opts.requestsPerMinute === undefined ? {} : { requestsPerMinute: opts.requestsPerMinute }),
    ...(opts.wsHelloTimeoutMs === undefined ? {} : { wsHelloTimeoutMs: opts.wsHelloTimeoutMs }),
  });

  return {
    app,
    ctx: app.iz,
    dbName,
    databaseUrl,
    close: async () => {
      await app.close();
      const cleanup = new Client({ connectionString: ADMIN_URL });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

export interface CreatedSession {
  teamId: string;
  userId: string;
  displayName: string;
  sessionToken: string;
  recoveryCode: string;
  /** "name=value" cookie header captured from the Set-Cookie response header. */
  cookie: string;
}

export async function createGuestSession(app: FastifyInstance, worldId: string = FIXTURE_WORLD_ID): Promise<CreatedSession> {
  const res = await app.inject({ method: "POST", url: "/api/sessions", payload: { worldId } });
  if (res.statusCode !== 201) {
    throw new Error(`session create failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as Omit<CreatedSession, "cookie">;
  const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return { ...body, cookie };
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Starts the server on a random local port for real-socket tests (WS). */
export async function listen(app: FastifyInstance): Promise<{ httpUrl: string; wsUrl: string }> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  return {
    httpUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
  };
}

/** The plaintext answer of the fixture world's answer gate, read from source. */
export function fixtureAnswer(): string {
  const raw = readFileSync(`${FIXTURE_SOURCE_DIR}/gates.yaml`, "utf8");
  const match = raw.match(/answers:\s*\[\s*"([^"]+)"/);
  if (match === null) throw new Error("cannot find the fixture answer in gates.yaml");
  return match[1]!;
}

export interface WsCloseInfo {
  code: number;
  reason: string;
}

type Waiter = { match: (msg: ServerMsg) => boolean; resolve: (msg: ServerMsg) => void; timer: NodeJS.Timeout };

/** Minimal client over Node's global WebSocket for the /ws protocol tests. */
export class WsClient {
  readonly socket: WebSocket;
  readonly closePromise: Promise<WsCloseInfo>;
  readonly #queue: ServerMsg[] = [];
  readonly #waiters: Waiter[] = [];

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.closePromise = new Promise((resolve) => {
      socket.addEventListener("close", (event) => {
        resolve({ code: event.code, reason: event.reason });
      });
    });
    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMsg;
      const index = this.#waiters.findIndex((waiter) => waiter.match(msg));
      if (index >= 0) {
        const waiter = this.#waiters.splice(index, 1)[0]!;
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      } else {
        this.#queue.push(msg);
      }
    });
  }

  static async open(url: string, hello?: { sessionToken: string; lastSeq: number }): Promise<WsClient> {
    const socket = new WebSocket(url);
    const client = new WsClient(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ws open timeout")), 5_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("ws failed to open"));
      }, { once: true });
    });
    if (hello !== undefined) {
      client.send({ t: "hello", sessionToken: hello.sessionToken, lastSeq: hello.lastSeq });
    }
    return client;
  }

  send(msg: unknown): void {
    this.socket.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  /** Next message of ANY type; rejects on timeout (waiter removed). */
  async #next(timeoutMs: number): Promise<ServerMsg> {
    const queued = this.#queue.shift();
    if (queued !== undefined) return queued;
    return new Promise((resolve, reject) => {
      const entry: Waiter = {
        match: () => true,
        resolve: (msg) => {
          clearTimeout(entry.timer);
          resolve(msg);
        },
        timer: setTimeout(() => {
          const index = this.#waiters.indexOf(entry);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(new Error(`ws: no message within ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.#waiters.push(entry);
    });
  }

  async waitFor<T extends ServerMsg["t"]>(t: T, timeoutMs = 5_000): Promise<Extract<ServerMsg, { t: T }>> {
    const queuedIndex = this.#queue.findIndex((msg) => msg.t === t);
    if (queuedIndex >= 0) {
      return this.#queue.splice(queuedIndex, 1)[0] as Extract<ServerMsg, { t: T }>;
    }
    return new Promise((resolve, reject) => {
      const entry: Waiter = {
        match: (msg) => msg.t === t,
        resolve: (msg) => {
          clearTimeout(entry.timer);
          resolve(msg as Extract<ServerMsg, { t: T }>);
        },
        timer: setTimeout(() => {
          const index = this.#waiters.indexOf(entry);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(new Error(`ws: no "${t}" within ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.#waiters.push(entry);
    });
  }

  /** Asserts that no message arrives within the window (close is fine). */
  async expectSilence(ms = 400): Promise<void> {
    if (this.#queue.length > 0) throw new Error("expected silence but messages are queued");
    const arrived = await this.#next(ms).then(
      (msg) => msg,
      () => undefined
    );
    if (arrived !== undefined) {
      throw new Error(`expected silence, received ${JSON.stringify(arrived).slice(0, 120)}`);
    }
  }

  async close(): Promise<void> {
    this.socket.close();
    await this.closePromise.catch(() => {});
  }
}
