import { describe, expect, it } from 'vitest';

import type { AuthorizationPolicy } from '@/api/policies';
import {
  deriveUsableResources,
  matchPolicies,
  policyToInput,
  removeSubjectNames,
  subjectsForUser,
  userAliasesOf,
  type UserRow,
} from './authz';

function policy(overrides: Partial<AuthorizationPolicy>): AuthorizationPolicy {
  return {
    name: 'rule',
    verbs: ['read'],
    effect: 'allow',
    status: 'enabled',
    ...overrides,
  };
}

const user: UserRow = {
  id: 'uid-1',
  username: 'alice',
  display_name: 'Alice',
  status: 'active',
  provider: 'local',
  created_at: '2026-01-01T00:00:00Z',
  feishu: { open_id: 'ou_1', lark_user_id: 'lark_1', bound_at: '2026-01-01T00:00:00Z' },
};

describe('userAliasesOf', () => {
  it('returns every identity path, deduplicated', () => {
    expect(userAliasesOf(user)).toEqual(['uid-1', 'alice', 'lark_1', 'ou_1']);
    expect(userAliasesOf({ ...user, feishu: undefined })).toEqual(['uid-1', 'alice']);
    expect(userAliasesOf(null)).toEqual([]);
  });
});

describe('matchPolicies', () => {
  const direct = policy({ name: 'direct', subjects: [{ kind: 'User', name: 'alice' }] });
  const viaGroup = policy({ name: 'via-group', subjects: [{ kind: 'Group', name: 'sre' }] });
  const wildcard = policy({ name: 'wildcard', subjects: [{ kind: 'User', name: '*' }] });
  const other = policy({ name: 'other', subjects: [{ kind: 'User', name: 'bob' }] });

  it('matches direct aliases, groups and wildcards', () => {
    const matches = matchPolicies([direct, viaGroup, wildcard, other], {
      aliases: ['uid-1', 'alice'],
      groupNames: ['sre'],
    });
    expect(matches.map(match => [match.policy.name, match.source, match.via])).toEqual([
      ['direct', 'direct', undefined],
      ['via-group', 'group', 'sre'],
      ['wildcard', 'wildcard', undefined],
    ]);
  });

  it('keeps the strongest source when a policy hits both directly and via a group', () => {
    const both = policy({
      name: 'both',
      subjects: [
        { kind: 'User', name: 'alice' },
        { kind: 'Group', name: 'sre' },
      ],
    });
    const [match] = matchPolicies([both], { aliases: ['alice'], groupNames: ['sre'] });
    expect(match?.source).toBe('direct');
  });

  it('matches a group target by its own name', () => {
    const matches = matchPolicies([viaGroup], { groupName: 'sre' });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source).toBe('group');
  });

  it('does not return unrelated policies', () => {
    expect(matchPolicies([other], { aliases: ['alice'] })).toEqual([]);
  });
});

describe('policyToInput', () => {
  it('preserves subjectNamespace and normalizes missing verbs', () => {
    const input = policyToInput(
      policy({
        name: 'ns-rule',
        subjects: [{ kind: 'User', name: 'alice' }],
        resources: [{ kind: 'agent', names: ['a'] }],
        subjectNamespace: 'team-a',
        verbs: [],
      })
    );
    expect(input.verbs).toEqual(['read']);
    expect(input.subjectNamespace).toBe('team-a');
    expect(input.subjects).toEqual([{ kind: 'User', name: 'alice' }]);
  });

  it('lets a patch override only the requested fields', () => {
    const input = policyToInput(
      policy({ name: 'p', description: 'old', subjects: [{ kind: 'Group', name: 'g' }] }),
      { subjects: [{ kind: 'Group', name: 'h' }] }
    );
    expect(input.description).toBe('old');
    expect(input.subjects).toEqual([{ kind: 'Group', name: 'h' }]);
  });
});

describe('subject mutation helpers', () => {
  it('adds every alias of a platform account once', () => {
    const subjects = subjectsForUser(user, [{ kind: 'Group', name: 'sre' }]);
    expect(subjects).toEqual([
      { kind: 'Group', name: 'sre' },
      { kind: 'User', name: 'uid-1' },
      { kind: 'User', name: 'alice' },
      { kind: 'User', name: 'lark_1' },
      { kind: 'User', name: 'ou_1' },
    ]);
    // 再次添加不会产生重复。
    expect(subjectsForUser(user, subjects)).toHaveLength(5);
  });

  it('removes only the requested kind/name pairs', () => {
    const subjects = [
      { kind: 'User', name: 'alice' },
      { kind: 'user', name: 'uid-1' },
      { kind: 'Group', name: 'alice' },
    ];
    expect(removeSubjectNames(subjects, 'User', ['alice', 'uid-1'])).toEqual([
      { kind: 'Group', name: 'alice' },
    ]);
  });
});

describe('deriveUsableResources', () => {
  it('merges allowed verbs and reports the source policy', () => {
    const rows = deriveUsableResources([
      {
        policy: policy({
          name: 'a',
          verbs: ['read'],
          resources: [{ kind: 'agent', names: ['alpha'] }],
        }),
        source: 'direct',
      },
      {
        policy: policy({
          name: 'b',
          verbs: ['write'],
          resources: [{ kind: 'agent', names: ['alpha'] }],
        }),
        source: 'group',
      },
    ]);
    expect(rows).toEqual([
      {
        key: 'agent/alpha',
        kind: 'agent',
        name: 'alpha',
        verbs: ['read', 'write'],
        sources: ['a', 'b（用户组）'],
      },
    ]);
  });

  it('lets deny remove the matching verbs and drops empty rows', () => {
    const entry = (name: string, verbs: string[], effect: 'allow' | 'deny' = 'allow') => ({
      policy: policy({
        name,
        verbs,
        effect,
        resources: [{ kind: 'agent', names: ['alpha'] }],
      }),
      source: 'direct' as const,
    });
    expect(
      deriveUsableResources([entry('allow-read', ['read']), entry('deny-read', ['read'], 'deny')])
    ).toEqual([]);
    expect(
      deriveUsableResources([
        entry('allow-read', ['read']),
        entry('deny-write', ['write'], 'deny'),
      ])
    ).toHaveLength(1);
  });

  it('applies deny with a wildcard resource name to the whole kind', () => {
    const rows = deriveUsableResources([
      {
        policy: policy({
          name: 'allow',
          verbs: ['read'],
          resources: [{ kind: 'agent', names: ['alpha', 'beta'] }],
        }),
        source: 'direct',
      },
      {
        policy: policy({
          name: 'deny-all',
          effect: 'deny',
          verbs: ['read'],
          resources: [{ kind: 'agent', names: ['*'] }],
        }),
        source: 'wildcard',
      },
    ]);
    expect(rows).toEqual([]);
  });

  it('ignores disabled policies and keeps wildcard resources as their own row', () => {
    const rows = deriveUsableResources([
      {
        policy: policy({
          name: 'disabled',
          status: 'disabled',
          resources: [{ kind: 'agent', names: ['alpha'] }],
        }),
        source: 'direct',
      },
      {
        policy: policy({ name: 'all', resources: [{ kind: 'agent', names: ['*'] }] }),
        source: 'wildcard',
      },
    ]);
    expect(rows).toEqual([
      {
        key: 'agent/*',
        kind: 'agent',
        name: '*',
        verbs: ['read'],
        sources: ['all'],
      },
    ]);
  });
});
