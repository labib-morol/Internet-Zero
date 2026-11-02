import { useState } from 'react';
import { useSessionStore } from '@iz/ui';

export function AgentConnection() {
  const token = useSessionStore((s) => s.session?.token);
  const [agent, setAgent] = useState<{ id: string; token: string }>();
  const [feedback, setFeedback] = useState('');
  return <section aria-label="Connect an agent" style={{ padding: 12 }}>
    <h2>Connect an agent</h2>
    <p>The agent shares your current case and can access only evidence you can reach.</p>
    <button className="iz-btn" type="button" onClick={() => {
      void fetch('/api/agent-tokens', { method: 'POST', headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'My agent' }) })
        .then(async (r) => { if (!r.ok) throw new Error('Token creation failed.'); setAgent(await r.json() as { id: string; token: string }); setFeedback('Copy this token now. It is shown only here.'); })
        .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : 'Token unavailable.'));
    }}>Create agent token</button>
    {agent && <div>
      <label>Agent token<input className="iz-input" readOnly value={agent.token} /></label>
      <p>Endpoint: <code>{window.location.origin}/mcp</code></p>
      <button className="iz-btn" type="button" onClick={() => {
        void fetch(`/api/agent-tokens/${agent.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token ?? ''}` } })
          .then((r) => { if (!r.ok) throw new Error('Revocation failed.'); setAgent(undefined); setFeedback('Token revoked.'); })
          .catch(() => setFeedback('Token could not be revoked.'));
      }}>Revoke agent token</button>
    </div>}
    <p role="status">{feedback}</p>
  </section>;
}
