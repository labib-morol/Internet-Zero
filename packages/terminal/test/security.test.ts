import { describe, expect, it } from 'vitest';
import { exec } from '../src/exec.js';
const ctx = { host: 'fixture.iz', user: 'player', now: '2026-11-02T09:00:00Z' };
describe('simulated terminal security boundaries', () => {
  it('rejects unbounded regular-expression repetition without evaluating it', () => {
    expect(() => exec({ '/note': 'aaaa' }, {}, '/', 'grep "(a+)+$" /note', ctx)).toThrow(/unsupported.*pattern|pattern.*unsupported/i);
  });
  it('overlay reads never claim to have read the authored world proof file', () => {
    const result = exec({ '/proof': 'world text' }, { proof: 'player text' }, '/', 'cat /proof', ctx);
    expect(result.output).toBe('player text');
    expect(result.events).toEqual([]);
    expect(exec({ '/proof': 'world text' }, { proof: 'player text' }, '/', 'ls /proof', ctx).events).toEqual([]);
    expect(exec({ '/proof': 'world text' }, { proof: 'player text' }, '/', 'stat /proof', ctx).events).toEqual([]);
  });
});
