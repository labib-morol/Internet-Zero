import { describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readAll } from "../src/db/events.js";
import { createTestApp, createGuestSession, bearer, postgresUp, listen } from "./helpers.js";
import { scoreRun, runReferenceAgent } from "@iz/agent-runner";

const pgUp = await postgresUp();

/** The model's script: the same investigation the oracle runs, but driven
 * through the reference agent's OpenAI-compatible chat loop. */
const SCRIPT: Array<{ tool: string; args: Record<string, unknown> }> = [
  { tool: "iz_list_hosts", args: {} },
  { tool: "iz_open", args: { url: "forge.pinecone.pcp/pinecone/office-scripts" } },
  { tool: "iz_search", args: { query: "rotate printer admin pass", host: "forge.pinecone.pcp" } },
  { tool: "iz_open", args: { url: "forge.pinecone.pcp/pinecone/office-scripts/commit/47e5a182496203c773d6f8ee9162ec549974865f" } },
  { tool: "iz_collect", args: { artifactId: "a.47e5a182496203c773d6f8ee9162ec549974865f" } },
  { tool: "iz_collect", args: { artifactId: "a.office-scripts" } },
  { tool: "iz_search", args: { query: "Copyright (c)", host: "forge.pinecone.pcp" } },
  { tool: "iz_open", args: { url: "forge.pinecone.pcp/pinecone/office-scripts/commit/1692bb4c3428499837c9b8d578d00462a48e4fca" } },
  { tool: "iz_collect", args: { artifactId: "a.1692bb4c3428499837c9b8d578d00462a48e4fca" } },
  { tool: "iz_open", args: { url: "mail.pinecone.pcp/mb.odile" } },
  { tool: "iz_search", args: { query: "name of the shop cat", host: "mail.pinecone.pcp" } },
  { tool: "iz_open", args: { url: "mail.pinecone.pcp/mb.odile/inbox/a.m-hint" } },
  { tool: "iz_collect", args: { artifactId: "a.m-hint" } },
  { tool: "iz_submit_report", args: { reportId: "r.who-holds", groupId: "A", slots: { "s.holder": "Odile Brandt", "s.clue-kind": "two facts combined" } } },
  { tool: "iz_submit_answer", args: { gateId: "g.printer", answer: "biscuit2009" } },
  { tool: "iz_terminal", args: { host: "printer.pinecone.pcp", command: "cat /etc/motd" } },
  { tool: "iz_status", args: {} },
];

describe.skipIf(!pgUp)("reference agent over MCP (§14.3)", () => {
  it("completes the tutorial with a scripted model through the chat loop", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app, "tutorial");
      const tokenResponse = await env.app.inject({ method: "POST", url: "/api/agent-tokens", headers: bearer(session.sessionToken), payload: { label: "reference" } });
      const token = tokenResponse.json().token as string;
      const { httpUrl } = await listen(env.app);
      const endpoint = `${httpUrl.replace("127.0.0.1", "localhost")}/mcp`;

      let step = 0;
      const run = await runReferenceAgent(
        async () => {
          const client = new Client({ name: "reference-agent", version: "0.1.0" });
          const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
            requestInit: { headers: { authorization: `Bearer ${token}` } },
          });
          await client.connect(transport);
          return client;
        },
        { endpoint, token, chatBaseUrl: "http://127.0.0.1:0", chatApiKey: "test", chatModel: "stub", maxSteps: 40 },
        async () => {
          const next = SCRIPT[Math.min(step, SCRIPT.length - 1)]!;
          step += 1;
          return new Response(JSON.stringify({
            choices: [{ message: { tool_calls: [{ function: { name: "next", arguments: JSON.stringify({ tool: next.tool, args: next.args }) } }] } }],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
      );

      expect(run.toolCalls).toBeGreaterThanOrEqual(SCRIPT.length);
      const events = (await readAll(env.ctx.db, session.teamId)).map((row) => row.event);
      const metrics = scoreRun(env.ctx.bundles.get("tutorial")!, events, "reference", run.toolCalls);
      expect(metrics.completed).toBe(true);
      expect(metrics.gatesSolved).toBe(3);
      expect(metrics.requiredFactsEvidenced).toBe(metrics.requiredFactsTotal);
      expect(events.filter((event) => event.type !== "SessionStarted").every((event) => event.actorKind === "agent")).toBe(true);
    } finally { await env.close(); }
  }, 60000);
});
