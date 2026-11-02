import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeAst } from '../src/safe-ast.js';

describe('safe document table structure', () => {
  it('wraps table rows in tbody for valid browser DOM', () => {
    render(<SafeAst node={{ type: 'table', align: [null], children: [
      { type: 'tableRow', children: [{ type: 'tableCell', children: [{ type: 'text', value: 'Evidence' }] }] },
    ] }} />);
    expect(screen.getByRole('row').parentElement?.tagName).toBe('TBODY');
  });
});
