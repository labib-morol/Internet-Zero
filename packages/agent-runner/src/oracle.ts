import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

/** Scripted practice-world oracle; derives the answer from tool observations only. */
export async function runTutorialOracle(endpoint: string, token: string): Promise<{ toolCalls: number }> {
  const client = new Client({ name: 'intranet-zero-oracle', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  let toolCalls = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    toolCalls++;
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`Oracle tool failed: ${name}`);
    if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('No tool observation');
    return JSON.parse(first.text) as Record<string, unknown>;
  };
  try {
    await client.connect(transport);
    await call('iz_list_hosts', {});
    const home = await call('iz_open', { url: 'forge.pinecone.pcp/pinecone/office-scripts' });
    const cat = /\b([A-Za-z]+), quality control/.exec(String(home.text))?.[1];
    if (!cat) throw new Error('Cat clue unavailable');
    const commits = await call('iz_search', { query: 'rotate printer admin pass', host: 'forge.pinecone.pcp' });
    const rotation = (commits.results as Array<{ artifactId: string; url: string }>)[0];
    if (!rotation) throw new Error('Rotation commit unavailable');
    await call('iz_open', { url: rotation.url });
    await call('iz_collect', { artifactId: rotation.artifactId });
    await call('iz_collect', { artifactId: 'a.office-scripts' });
    const licenses = await call('iz_search', { query: 'Copyright (c)', host: 'forge.pinecone.pcp' });
    const license = (licenses.results as Array<{ artifactId: string; url: string }>)[0];
    if (!license) throw new Error('Year clue unavailable');
    const observed = await call('iz_open', { url: license.url });
    const year = /Copyright \(c\)\s*(\d{4})/.exec(String(observed.text))?.[1];
    if (!year) throw new Error('Founding year unavailable');
    await call('iz_collect', { artifactId: license.artifactId });
    await call('iz_open', { url: 'mail.pinecone.pcp/mb.odile' });
    const hints = await call('iz_search', { query: 'name of the shop cat', host: 'mail.pinecone.pcp' });
    const hint = (hints.results as Array<{ artifactId: string; url: string }>)[0];
    if (!hint) throw new Error('Hint unavailable');
    await call('iz_open', { url: hint.url });
    await call('iz_collect', { artifactId: hint.artifactId });
    const report = await call('iz_submit_report', { reportId: 'r.who-holds', groupId: 'A', slots: { 's.holder': 'Odile Brandt', 's.clue-kind': 'two facts combined' } });
    if (!(report.acceptedGroups as string[]).includes('A')) throw new Error('Report rejected');
    const answer = await call('iz_submit_answer', { gateId: 'g.printer', answer: `${cat}${year}` });
    if (!answer.accepted) throw new Error('Derived answer rejected');
    await call('iz_terminal', { host: 'printer.pinecone.pcp', command: 'cat /etc/motd' });
    const status = await call('iz_status', {});
    if (status.stage !== 'completed') throw new Error('Ending did not complete');
    return { toolCalls };
  } finally { await client.close(); }
}
