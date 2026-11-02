import { describe, expect, it } from 'vitest';
import { CaseFileResponse } from '../src/api.js';

describe('public case-file schema', () => {
  const report = {
    reportId: 'r.final', title: 'Case report',
    groups: [{ id: 'A', slots: [{ id: 'holder', label: 'Who holds the hint?', type: 'identity' }] }],
  };
  it('accepts report forms without canonical fact identifiers', () => {
    expect(CaseFileResponse.safeParse({ openGates: [], reports: [report] }).success).toBe(true);
  });
  it('rejects canonical fact identifiers on a public report slot', () => {
    const slot = { ...report.groups[0]!.slots[0]!, fact: 'f.private-canon' };
    expect(CaseFileResponse.safeParse({ openGates: [], reports: [{ ...report, groups: [{ id: 'A', slots: [slot] }] }] }).success).toBe(false);
  });
});
