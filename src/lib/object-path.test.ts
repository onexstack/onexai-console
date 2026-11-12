import { describe, expect, it } from 'vitest';

import { applyPathPatch, readPath, writePath } from './object-path';

describe('readPath', () => {
  it('reads nested fields', () => {
    expect(readPath({ spec: { enabled: true } }, 'spec.enabled')).toBe(true);
  });

  it('returns undefined for a missing branch', () => {
    expect(readPath({ spec: null }, 'spec.enabled')).toBeUndefined();
    expect(readPath({}, 'spec.enabled')).toBeUndefined();
  });
});

describe('writePath', () => {
  it('writes a nested field without dropping siblings or mutating the input', () => {
    const row = { spec: { enabled: true, namespaces: ['a'] }, name: 'x' };
    const next = writePath(row, 'spec.enabled', false);

    expect(next).toEqual({ spec: { enabled: false, namespaces: ['a'] }, name: 'x' });
    expect(row.spec.enabled).toBe(true);
  });

  it('creates missing parents', () => {
    expect(writePath({}, 'spec.enabled', false)).toEqual({ spec: { enabled: false } });
  });
});

describe('applyPathPatch', () => {
  it('applies dotted keys by path and top-level keys by replacement', () => {
    const row = { spec: { enabled: true, namespaces: ['a'] }, paused: false };
    const next = applyPathPatch(row, { 'spec.enabled': false, paused: true });

    expect(next).toEqual({ spec: { enabled: false, namespaces: ['a'] }, paused: true });
    expect(row.spec.enabled).toBe(true);
    expect(row.paused).toBe(false);
  });
});
