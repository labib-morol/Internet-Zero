import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app-context.js";
import { listNotes, upsertNote } from "../db/notes.js";

const NoteInput = z.strictObject({ id: z.uuid(), body: z.string().max(65536) });

/** Private notes never enter the shared action stream or websocket rooms. */
export function registerNoteRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/notes", async (request, reply) => {
    const auth = request.auth;
    if (auth === undefined) return reply.code(401).send({ error: "unauthorized" });
    const rows = await listNotes(ctx.db, auth.user.id, auth.team.id);
    return { notes: rows.map((row) => ({ id: row.id, body: row.body, updatedAt: row.updatedAt.toISOString() })) };
  });
  app.put("/api/notes", async (request, reply) => {
    const auth = request.auth;
    if (auth === undefined) return reply.code(401).send({ error: "unauthorized" });
    const input = NoteInput.safeParse(request.body);
    if (!input.success || Buffer.byteLength(input.data.body, "utf8") > 65536) {
      return reply.code(400).send({ error: "invalid note" });
    }
    const saved = await upsertNote(ctx.db, auth.user.id, auth.team.id, input.data.id, input.data.body);
    if (!saved) return reply.code(404).send({ error: "not found" });
    return { id: input.data.id, body: input.data.body };
  });
}
