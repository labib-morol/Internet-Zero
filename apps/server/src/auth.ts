import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "./db/client.js";
import { findLiveSession } from "./db/sessions.js";
import { firstTeamForUser, getTeam } from "./db/teams.js";
import type { TeamRow, UserRow } from "./db/schema.js";
import { SESSION_COOKIE } from "./config.js";

/**
 * Session auth (§15, §17.2): a random 32-byte token, stored as sha256, carried
 * either as a signed httpOnly cookie (browser) or as
 * `Authorization: Bearer <token>` (the same session tokens; bound agent tokens
 * arrive in M2).
 */

export const COOKIE_NAME = SESSION_COOKIE;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export interface AuthContext {
  user: UserRow;
  team: TeamRow;
  /** The session row id (used to rebind the team on invite join, §12). */
  sessionId: string;
}

/**
 * Resolves the session from the request: Bearer token first, then the signed
 * session cookie. Returns undefined when absent or invalid.
 */
export async function authenticate(db: Db, request: FastifyRequest): Promise<AuthContext | undefined> {
  let token: string | undefined;
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    token = header.slice("Bearer ".length).trim();
  } else {
    const rawCookie = request.cookies[COOKIE_NAME];
    if (rawCookie !== undefined) {
      const unsigned = request.unsignCookie(rawCookie);
      if (unsigned.valid && typeof unsigned.value === "string") {
        token = unsigned.value;
      }
    }
  }
  if (token === undefined || token.length === 0) return undefined;

  const session = await findLiveSession(db, hashToken(token));
  if (session === undefined) return undefined;
  // §12: every session belongs to a team. Sessions created before invite-join
  // have no binding and fall back to the user's first membership.
  const team =
    session.session.teamId !== null
      ? ((await getTeam(db, session.session.teamId)) ?? (await firstTeamForUser(db, session.user.id)))
      : await firstTeamForUser(db, session.user.id);
  if (team === undefined) return undefined;
  return { user: session.user, team, sessionId: session.session.id };
}

export async function authGuard(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthContext | undefined> {
  const ctx = await authenticate(db, request);
  if (ctx === undefined) {
    await reply.code(401).send({ error: "unauthorized" });
    return undefined;
  }
  return ctx;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the /api guard after successful session auth. */
    auth?: AuthContext;
  }
}
