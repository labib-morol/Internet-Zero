import { z } from 'zod';
import { createDb } from './db/client.js';
import { generateToken, hashToken } from './auth.js';
import { createAgentToken } from './db/agent-tokens.js';
import { teamMembers } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { loadDotEnv } from './config.js';

loadDotEnv('.env');
const teamIndex = process.argv.indexOf('--team');
const teamId = z.uuid().parse(process.argv[teamIndex + 1]);
const { pool, db } = createDb(process.env.DATABASE_URL ?? '');
try {
  const owner = (await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId))).find((member) => member.role === 'owner');
  if (!owner) throw new Error('Team owner not found.');
  const token = generateToken();
  await createAgentToken(db, { teamId, userId: owner.userId, tokenHash: hashToken(token), label: 'CLI agent' });
  process.stdout.write(`${token}\n`);
} finally { await pool.end(); }
