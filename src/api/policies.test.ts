import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  agentClient: {},
  chatClient: {},
  request: vi.fn(),
}));

import { request } from './client';
import {
  listPolicies,
  normalizePolicy,
  policyPayload,
  type AuthorizationPolicy,
  type PolicyInput,
} from './policies';

const mockedRequest = vi.mocked(request);

function rule(overrides: Partial<AuthorizationPolicy> = {}): AuthorizationPolicy {
  return {
    name: 'rule',
    subjects: [{ kind: 'User', name: 'alice' }],
    resources: [{ kind: 'agent', names: ['alpha'] }],
    verbs: ['read'],
    effect: 'allow',
    status: 'enabled',
    ...overrides,
  };
}

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    name: 'rule',
    subjects: [{ kind: 'User', name: 'alice' }],
    resources: [{ kind: 'agent', names: ['alpha'] }],
    verbs: ['read'],
    effect: 'allow',
    status: 'enabled',
    ...overrides,
  };
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('listPolicies', () => {
  it('deduplicates policies that share a name and reports the deduplicated total', async () => {
    mockedRequest.mockResolvedValue({
      authzRules: [
        rule({ name: 'onexai-grant', description: 'first' }),
        rule({ name: 'onexai-grant', description: 'second' }),
        rule({ name: 'other' }),
      ],
      count: 3,
    } as never);

    const result = await listPolicies();
    expect(result.total).toBe(2);
    expect(result.items.map(policy => policy.name)).toEqual(['onexai-grant', 'other']);
    // 后出现的同名列不覆盖先出现的行。
    expect(result.items[0]?.description).toBe('first');
  });
});

describe('normalizePolicy', () => {
  it('materializes the plural shapes from legacy single-subject/resource fields', () => {
    const normalized = normalizePolicy({
      name: 'legacy',
      subjectType: 'user',
      subjectIds: ['alice'],
      resourceKind: 'agent',
      resourceNames: ['alpha'],
      verbs: ['read'],
      effect: 'allow',
      status: 'enabled',
    });
    expect(normalized.subjects).toEqual([{ kind: 'User', name: 'alice' }]);
    expect(normalized.resources).toEqual([{ kind: 'agent', names: ['alpha'] }]);
  });
});

describe('policyPayload', () => {
  it('dual-writes legacy fields when the policy has a single subject kind and resource', () => {
    const payload = policyPayload(input());
    expect(payload.subjects).toEqual([{ kind: 'User', name: 'alice' }]);
    expect(payload.subjectType).toBe('User');
    expect(payload.subjectIds).toEqual(['alice']);
    expect(payload.resourceKind).toBe('agent');
    expect(payload.resourceNames).toEqual(['alpha']);
  });

  it('does not dual-write subject fields when subjectNamespace is set', () => {
    const payload = policyPayload(input({ subjectNamespace: 'team-a' }));
    expect(payload.subjectNamespace).toBe('team-a');
    expect(payload.subjectType).toBeUndefined();
    expect(payload.subjectIds).toBeUndefined();
  });

  it('normalizes subject kind aliases and trims names', () => {
    const payload = policyPayload(
      input({ subjects: [{ kind: 'group', name: ' sre ' }], resources: [] })
    );
    expect(payload.subjects).toEqual([{ kind: 'Group', name: 'sre' }]);
    expect(payload.resourceKind).toBeUndefined();
  });
});
