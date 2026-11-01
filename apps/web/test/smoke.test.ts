import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';
describe('smoke', () => {
  it('loads the web stub', () => {
    expect(PACKAGE_NAME).toBe('web');
  });
});
