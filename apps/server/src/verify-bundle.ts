import { createHash } from 'node:crypto';
import type { Cond, SafeNode, WorldBundle } from '@iz/schema';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function verifyBundle(bundle: WorldBundle, raw: unknown): void {
  const object = { ...(raw as Record<string, unknown>) };
  delete object.bundleHash;
  const hash = createHash('sha256').update(stable(object)).digest('hex');
  if (hash !== bundle.bundleHash) throw new Error('World bundle integrity hash mismatch');
  const hosts = new Set(bundle.world.hosts.map((h) => h.host));
  const assets = new Set(bundle.assets.map((a) => a.id));
  const nodes = (node: SafeNode): void => {
    if (node.type === 'link') {
      const host = node.url.replace(/^https?:\/\//, '').split('/')[0];
      if (!host || !hosts.has(host)) throw new Error('Unsafe bundle link');
    }
    if (node.type === 'image' && !assets.has(node.url)) throw new Error('Unsafe bundle image');
    if ('children' in node) for (const child of node.children) nodes(child);
  };
  for (const artifact of bundle.artifacts) {
    if (!hosts.has(artifact.host) || Buffer.byteLength(artifact.body) > 256 * 1024) throw new Error('Invalid artifact integrity');
    nodes(artifact.ast);
  }
  const ids = new Set([...bundle.artifacts.map((a) => a.id), ...bundle.gates.map((g) => g.id), ...bundle.reports.map((r) => r.id), ...bundle.events.map((e) => e.id), ...hosts]);
  for (const gate of bundle.gates) for (const id of gate.unlocks) if (!ids.has(id)) throw new Error('Invalid bundle unlock reference');
  const deps = (condition?: Cond): string[] => {
    if (!condition) return [];
    if ('gateSolved' in condition) return [condition.gateSolved];
    if ('all' in condition) return condition.all.flatMap(deps);
    if ('any' in condition) return condition.any.flatMap(deps);
    if ('not' in condition) return deps(condition.not);
    return [];
  };
  const visit = (id: string, path: Set<string>): void => {
    if (path.has(id)) throw new Error('Cyclic bundle gate requirements');
    const gate = bundle.gates.find((g) => g.id === id);
    if (!gate) throw new Error('Unknown bundle gate');
    for (const dependency of deps(gate.requires)) visit(dependency, new Set([...path, id]));
  };
  const validateCondition = (condition?: Cond): void => {
    if (!condition) return;
    if ('gateSolved' in condition && !bundle.gates.some((g) => g.id === condition.gateSolved)) throw new Error('Invalid visibility gate reference');
    if ('evidenceCollected' in condition && !bundle.artifacts.some((a) => a.id === condition.evidenceCollected)) throw new Error('Invalid evidence reference');
    if ('factEstablished' in condition && !bundle.canon.facts.some((f) => f.id === condition.factEstablished)) throw new Error('Invalid fact reference');
    if ('all' in condition) condition.all.forEach(validateCondition);
    if ('any' in condition) condition.any.forEach(validateCondition);
    if ('not' in condition) validateCondition(condition.not);
  };
  for (const artifact of bundle.artifacts) {
    validateCondition(artifact.visibility);
    if (Buffer.byteLength(JSON.stringify(artifact.ast)) > 512 * 1024) throw new Error('Oversize bundle AST');
  }
  for (const host of bundle.world.hosts) validateCondition(host.requires);
  for (const asset of bundle.assets) {
    if (asset.id !== asset.sha256 || asset.bytes > 10 * 1024 * 1024 || ['text/html', 'application/javascript'].includes(asset.contentType)) throw new Error('Unsafe asset integrity');
  }
  for (const gate of bundle.gates) {
    validateCondition(gate.requires);
    const check = gate.check;
    if (check.kind === 'report' && !bundle.reports.some((r) => r.id === check.report)) throw new Error('Invalid report reference');
    if (check.kind === 'terminal') {
      if (!hosts.has(check.host)) throw new Error('Invalid terminal gate host');
      if (!check.mustHaveRead.every((path) => bundle.artifacts.some((a) => a.host === check.host && a.kind === 'terminal-file' && a.path.replace(/^\/+/, '') === path.replace(/^\/+/, '')))) throw new Error('Invalid terminal proof reference');
    }
    if (check.kind === 'evidenceSet') {
      for (const id of check.mustCollect) if (!bundle.artifacts.some((a) => a.id === id)) throw new Error('Invalid evidence-set reference');
    }
  }
  for (const artifact of bundle.artifacts) {
    if (artifact.kind !== 'terminal-file') continue;
    const connectGate = artifact.meta.connectGate;
    if (connectGate !== undefined && !bundle.gates.some((g) => g.id === connectGate)) throw new Error('Invalid connectGate reference');
    const completion = artifact.meta.completion;
    if (completion !== undefined && completion !== 'terminalRead') throw new Error('Invalid completion marker');
  }
  for (const event of bundle.events) {
    validateCondition(event.requires);
    for (const effect of event.effects) {
      const targets = effect.kind === 'reveal' ? [effect.artifact] : effect.kind === 'deliverMail' ? [effect.message] : effect.kind === 'addCommit' ? [effect.repo, effect.commit] : effect.hosts;
      if (!targets.every((id) => ids.has(id))) throw new Error('Invalid event effect reference');
    }
  }
  for (const gate of bundle.gates) visit(gate.id, new Set());
}
