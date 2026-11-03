import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { TeamMembersResponse } from "@iz/schema";
import type { AppContext } from "../app-context.js";
import { hashToken } from "../auth.js";
import { addTeamMember, countMembers, findTeamByInviteHash, listMembers, membershipRole, setInviteCodeHash } from "../db/teams.js";
import { bindSessionTeam } from "../db/sessions.js";

/**
 * Teams via invite link (§2.1.10, §12): the owner mints a random code (stored
 * hashed), a player joins with it and becomes a member of up to 6. Membership
 * rebinds the joiner's CURRENT session to the team, so their next /api/state
 * and WebSocket stream are the team's shared case.
 */
export const MAX_TEAM_MEMBERS = 6;

export function registerTeamRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/teams/invite", async (request, reply) => {
    const auth = request.auth;
    if (auth === undefined) return reply.code(401).send({ error: "unauthorized" });
    const role = await membershipRole(ctx.db, auth.team.id, auth.user.id);
    if (role !== "owner") return reply.code(403).send({ error: "only the team owner can invite" });
    const code = randomBytes(8).toString("hex"); // -> 16 hex chars
    await setInviteCodeHash(ctx.db, auth.team.id, hashToken(code));
    return reply.code(201).send({ code });
  });

  app.post("/api/teams/join", async (request, reply) => {
    const auth = request.auth;
    if (auth === undefined) return reply.code(401).send({ error: "unauthorized" });
    const body = (request.body ?? {}) as { code?: unknown };
    if (typeof body.code !== "string" || body.code.length < 8) {
      return reply.code(400).send({ error: "invalid invite code" });
    }
    const team = await findTeamByInviteHash(ctx.db, hashToken(body.code));
    if (team === undefined) return reply.code(404).send({ error: "unknown invite code" });
    if (team.id === auth.team.id) return reply.code(200).send({ teamId: team.id, teamName: team.name, alreadyMember: true });
    if ((await countMembers(ctx.db, team.id)) >= MAX_TEAM_MEMBERS) {
      return reply.code(409).send({ error: "team is full" });
    }
    await addTeamMember(ctx.db, team.id, auth.user.id, "member");
    await bindSessionTeam(ctx.db, auth.sessionId, team.id);
    return reply.code(200).send({ teamId: team.id, teamName: team.name, alreadyMember: false });
  });

  app.get("/api/teams/members", async (request, reply) => {
    const auth = request.auth;
    if (auth === undefined) return reply.code(401).send({ error: "unauthorized" });
    const members = await listMembers(ctx.db, auth.team.id);
    return TeamMembersResponse.parse({
      members: members.map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        role: m.role as "owner" | "member",
        joinedAt: m.joinedAt.toISOString(),
      })),
    });
  });
}
