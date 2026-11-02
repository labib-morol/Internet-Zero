import { McpServer } from '@modelcontextprotocol/server';
import * as S from '@iz/schema';
import type { ZodType } from 'zod';

export interface ToolBridge {
  call(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export const TOOL_DEFINITIONS = [
  ['iz_status', S.IzStatusInput, S.IzStatusOutput, 'Read your current case progress.'],
  ['iz_list_hosts', S.IzListHostsInput, S.IzListHostsOutput, 'List reachable in-game hosts.'],
  ['iz_open', S.IzOpenInput, S.IzOpenOutput, 'Open an in-game page.'],
  ['iz_search', S.IzSearchInput, S.IzSearchOutput, 'Search visible in-game artifacts.'],
  ['iz_inspect', S.IzInspectInput, S.IzInspectOutput, 'Inspect metadata of a visible artifact.'],
  ['iz_terminal', S.IzTerminalInput, S.IzTerminalOutput, 'Run a simulated terminal command.'],
  ['iz_collect', S.IzCollectInput, S.IzCollectOutput, 'Collect visible evidence.'],
  ['iz_claim', S.IzClaimInput, S.IzClaimOutput, 'Create a shared investigation claim.'],
  ['iz_link', S.IzLinkInput, S.IzLinkOutput, 'Link evidence or claims.'],
  ['iz_submit_answer', S.IzSubmitAnswerInput, S.IzSubmitAnswerOutput, 'Submit a gate answer.'],
  ['iz_submit_report', S.IzSubmitReportInput, S.IzSubmitReportOutput, 'Submit one case-report group.'],
  ['iz_request_hint', S.IzRequestHintInput, S.IzRequestHintOutput, 'Request the next hint tier.'],
] as const;

export function createGameMcpServer(bridge: ToolBridge): McpServer {
  const server = new McpServer({ name: 'intranet-zero', version: '0.1.0' });
  for (const [name, input, output, description] of TOOL_DEFINITIONS) {
    server.registerTool(name, {
      description: `${description} ${S.MCP_FICTION_WARNING}`,
      inputSchema: input as ZodType<Record<string, unknown>>,
      outputSchema: output as ZodType<Record<string, unknown>>,
    }, async (args) => {
      try {
        const result = await bridge.call(name, args);
        const structuredContent = output.parse(result);
        return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
      } catch {
        return { isError: true, content: [{ type: 'text', text: 'Action rejected or content unavailable.' }] };
      }
    });
  }
  return server;
}
