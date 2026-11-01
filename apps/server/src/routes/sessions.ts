import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CreateSessionRequest,
  CreateSessionResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
} from "@iz/schema";
import { sessionStartEvent } from "@iz/runtime";
import type { AppContext } from "../app-context.js";
import { generateToken, hashToken, COOKIE_NAME } from "../auth.js";
import { append } from "../db/events.js";
import { createSession } from "../db/sessions.js";
import { createGuestUser, findUserByRecoveryCodeHash } from "../db/users.js";
import { addTeamMember, createTeam, firstTeamForUser } from "../db/teams.js";

const RECOVERY_CODE_BYTES = 8; // -> 16 hex chars

function setSessionCookie(
  app: FastifyInstance,
  ctx: AppContext,
  reply: FastifyReply,
  token: string
): void {
  reply.setCookie(COOKIE_NAME, token, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: ctx.config.publicOrigin.startsWith("https://"),
  });
}

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  // POST /api/sessions — create a guest user + team + first event + session.
  app.post("/api/sessions", async (request, reply) => {
    const body = CreateSessionRequest.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const bundle = ctx.bundles.get(body.data.worldId);
    if (bundle === undefined) {
      return reply.code(404).send({ error: "unknown world" });
    }

    const displayName = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
    const recoveryCode = generateToken(RECOVERY_CODE_BYTES);
    const startedAt = ctx.clock.now();

    const user = await createGuestUser(ctx.db, displayName, hashToken(recoveryCode));
    const team = await createTeam(ctx.db, {
      worldId: bundle.world.id,
      worldVersion: bundle.world.version,
      bundleHash: bundle.bundleHash,
      name: displayName,
      clockMode: bundle.world.clock.mode,
      startedAt: new Date(startedAt),
    });
    await addTeamMember(ctx.db, team.id, user.id, "owner");

    const sessionToken = generateToken();
    await createSession(ctx.db, user.id, hashToken(sessionToken));

    // The team stream always begins with SessionStarted (seq 1, §9/§12).
    const startEvent = sessionStartEvent(bundle, team.id, startedAt, {
      userId: user.id,
      kind: "human",
    });
    const appended = await append(ctx.db, team.id, 1, [startEvent]);
    if (!appended.ok) throw new Error("fresh team stream refused its first event");

    setSessionCookie(app, ctx, reply, sessionToken);
    return reply.code(201).send(
      CreateSessionResponse.parse({
        teamId: team.id,
        userId: user.id,
        displayName,
        sessionToken,
        recoveryCode,
      })
    );
  });

  // POST /api/sessions/resume — recovery code -> new session token.
  app.post("/api/sessions/resume", async (request, reply) => {
    const body = ResumeSessionRequest.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const user = await findUserByRecoveryCodeHash(ctx.db, hashToken(body.data.recoveryCode));
    if (user === undefined) {
      return reply.code(401).send({ error: "invalid recovery code" });
    }
    const team = await firstTeamForUser(ctx.db, user.id);
    if (team === undefined) {
      return reply.code(401).send({ error: "invalid recovery code" });
    }
    const sessionToken = generateToken();
    await createSession(ctx.db, user.id, hashToken(sessionToken));

    setSessionCookie(app, ctx, reply, sessionToken);
    return reply.code(201).send(
      ResumeSessionResponse.parse({
        teamId: team.id,
        userId: user.id,
        sessionToken,
      })
    );
  });
}
