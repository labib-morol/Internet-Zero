import { describe, expect, it } from 'vitest';
import { hashAnswer } from '../src/index.js';
import { normalizeAnswer } from '@iz/schema';

describe('hashAnswer', () => {
  it('matches the §6.4 format and is deterministic', () => {
    const normalized = normalizeAnswer(' Biscuit-2009! ', ['nfkc', 'lower', 'trim', 'collapse', 'stripPunct']);
    expect(normalized).toBe('biscuit2009');
    expect(hashAnswer('salt-0123456789abcdef', 'g.printer', normalized)).toBe(
      hashAnswer('salt-0123456789abcdef', 'g.printer', normalized)
    );
    expect(hashAnswer('salt-0123456789abcdef', 'g.printer', normalized)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAnswer('other-salt-0000000000', 'g.printer', normalized)).not.toBe(
      hashAnswer('salt-0123456789abcdef', 'g.printer', normalized)
    );
  });
});
