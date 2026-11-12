import { describe, expect, it } from 'vitest';

import { findForeignAgentRef } from './agent-refs';

describe('findForeignAgentRef', () => {
  it('accepts local references', () => {
    expect(
      findForeignAgentRef({
        skills: [{ name: 'skill-a' }],
        knowledgeBases: [{ name: 'kb-a' }],
        model: { name: 'deepseek' },
      })
    ).toBeNull();
  });

  it('reports the field of a cross-namespace reference', () => {
    expect(
      findForeignAgentRef({
        knowledgeBases: [{ name: 'kb-a', namespace: 'helper-public' }],
      })
    ).toEqual({
      field: 'knowledgeBases',
      message:
        '知识库引用「helper-public/kb-a」是跨空间引用；Agent 只能引用本空间资源，请通过「能力编排 → 能力绑定」注入。',
    });
  });

  it('finds a foreign reference later in the list', () => {
    const issue = findForeignAgentRef({
      skills: [{ name: 'skill-a' }, { name: 'skill-b', namespace: 'platform' }],
    });
    expect(issue?.field).toBe('skills');
  });

  it('checks single-value references too', () => {
    expect(findForeignAgentRef({ memoryRef: { name: 'mem', namespace: 'platform' } })?.field).toBe(
      'memoryRef'
    );
    expect(findForeignAgentRef({ model: { name: 'shared', namespace: 'platform' } })?.field).toBe(
      'model'
    );
  });

  it('rejects an explicit namespace even when it matches the agent namespace', () => {
    expect(
      findForeignAgentRef({ prompts: [{ name: 'persona', namespace: 'default' }] })?.field
    ).toBe('prompts');
  });
});
