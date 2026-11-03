import type { Action, RuntimeState, SafeNode, ViewModel, WorldBundle } from '@iz/schema';
import { evaluateCondition, hostReachable, isWorldComplete, visibleArtifacts } from '@iz/runtime';
import { forgeView, mailView, archiveView, terminalView, forumView, forgeCollectibles, mailCollectibles, archiveCollectibles } from '@iz/services';
import type { AppContext } from './app-context.js';
import { loadTeamState } from './game.js';

export function viewFor(bundle: WorldBundle, state: RuntimeState, host: string, path: string, now: string): ViewModel {
  const h = bundle.world.hosts.find((item) => item.host === host);
  if (!h || !hostReachable(bundle, h, state, (id) => state.unlocked.has(id), now)) return { notFound: true, host, path };
  switch (h.service) {
    case 'forge': return forgeView(bundle, state, host, path, now);
    case 'mail': return mailView(bundle, state, host, path, now);
    case 'archive': return archiveView(bundle, state, host, path, now);
    case 'forum': return forumView(bundle, state, host, path, now);
    case 'terminal': return terminalView(bundle, state, host, path, now);
    default: return { notFound: true, host, path };
  }
}

function viewText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(viewText).join('\n');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'redaction') return '[REDACTED]';
    return Object.entries(record).filter(([key]) => !['type', 'view', 'artifactId'].includes(key)).map(([, item]) => viewText(item)).join('\n');
  }
  return '';
}

function gameLinks(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(gameLinks);
  const node = value as Partial<SafeNode> & { url?: string; type?: string };
  const links = node.type === 'link' && node.url ? [node.url] : [];
  return [...links, ...Object.values(value).flatMap(gameLinks)];
}

export function gameToolBridge(ctx: AppContext, teamId: string, userId: string, worldId: string) {
  const cwdByHost = new Map<string, string>();
  return { async call(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const bundle = ctx.bundles.get(worldId);
    if (!bundle) throw new Error('World unavailable');
    let { state } = await loadTeamState(ctx.db, bundle, teamId);
    const now = ctx.clock.now();
    const hosts = bundle.world.hosts.filter((h) => hostReachable(bundle, h, state, (id) => state.unlocked.has(id), now));
    const available = visibleArtifacts(bundle, state, now);
    const action = async (a: Action) => {
      const result = await ctx.submit({ teamId, bundle, action: a, actor: { userId, kind: 'agent' } });
      return result;
    };
    if (name === 'iz_status') return {
      world: `${bundle.world.id}@${bundle.world.version}`, stage: isWorldComplete(bundle, state) ? 'completed' : 'investigating',
      solvedGates: Object.keys(state.solvedGates), openGates: bundle.gates.filter((g) => !state.solvedGates[g.id] && (!g.requires || evaluateCondition(g.requires, state, bundle, now))).map((g) => g.id),
      reachableHosts: hosts.map((h) => h.host), score: state.score, hintsUsed: state.hintsUsed,
    };
    if (name === 'iz_list_hosts') return { hosts: hosts.map((h) => ({ host: h.host, service: h.service, title: h.title ?? h.host })) };
    if (name === 'iz_inspect') {
      const a = available.find((item) => item.id === input.artifactId);
      if (!a) throw new Error('Unavailable');
      return { meta: Object.fromEntries(Object.entries(a.meta).filter(([key]) => !['redactions', 'attachments'].includes(key))) };
    }
    if (name === 'iz_search') {
      const query = String(input.query);
      await action({ type: 'search', query, ...(typeof input.host === 'string' ? { host: input.host } : {}) });
      const q = query.toLowerCase();
      return { results: available.filter((a) => (!input.host || a.host === input.host) && `${a.title} ${a.body}`.toLowerCase().includes(q)).slice(0, Number(input.limit ?? 10))
        .map((a) => ({ artifactId: a.id, url: `${a.host}/${a.path.replace(/^\/+/, '')}`, title: a.title, snippet: a.body.slice(0, 160) })) };
    }
    if (name === 'iz_open') {
      const url = String(input.url);
      const outcome = await action({ type: 'open', url });
      if (outcome.rejection) throw new Error('Unavailable');
      state = (await loadTeamState(ctx.db, bundle, teamId)).state;
      const slash = url.indexOf('/');
      const host = slash === -1 ? url : url.slice(0, slash);
      const path = slash === -1 ? '/' : url.slice(slash);
      const view = viewFor(bundle, state, host, path, now);
      if ('notFound' in view) throw new Error('Unavailable');
      const collectibles = [...forgeCollectibles(view), ...mailCollectibles(view), ...archiveCollectibles(view)];
      return { url, title: 'name' in view ? view.name : 'subject' in view ? view.subject : view.view, text: viewText(view), collectibles, links: gameLinks(view) };
    }
    const mapped: Record<string, Action> = {
      iz_collect: { type: 'collect', artifactId: String(input.artifactId), ...(input.fragment ? { fragment: input.fragment as Action & never } : {}) },
      iz_claim: { type: 'claim', text: String(input.text), private: false, ...(input.slots ? { slots: input.slots as Record<string, string> } : {}) },
      iz_link: { type: 'link', from: String(input.from), to: String(input.to), relation: input.relation as 'supports', confidence: input.confidence as 1 },
      iz_submit_answer: { type: 'submitAnswer', gateId: String(input.gateId), answer: String(input.answer) },
      iz_submit_report: { type: 'submitReport', reportId: String(input.reportId), groupId: String(input.groupId), slots: input.slots as Record<string, string> },
      iz_request_hint: { type: 'requestHint', gateId: String(input.gateId), tier: input.tier as 1 },
      iz_terminal: { type: 'terminal', host: String(input.host), cwd: cwdByHost.get(String(input.host)) ?? '/', line: String(input.command) },
    };
    const a = mapped[name];
    if (!a) throw new Error('Unknown tool');
    const outcome = await action(a);
    if (name === 'iz_submit_answer') return { accepted: !outcome.rejection, ...(outcome.rejection?.retryAfterSeconds ? { retryAfterSeconds: outcome.rejection.retryAfterSeconds } : {}) };
    if (name === 'iz_submit_report') return { acceptedGroups: outcome.rejection ? [] : (outcome.result as { acceptedGroups: string[] }).acceptedGroups, ...(outcome.rejection?.retryAfterSeconds ? { retryAfterSeconds: outcome.rejection.retryAfterSeconds } : {}) };
    if (outcome.rejection) throw new Error('Action rejected');
    const result = outcome.result as Record<string, unknown>;
    if (name === 'iz_request_hint') return { text: result.text, cost: result.cost };
    if (name === 'iz_terminal') { cwdByHost.set(String(input.host), String(result.cwd)); return { output: result.output, cwd: result.cwd }; }
    return result;
  } };
}
