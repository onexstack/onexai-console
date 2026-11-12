import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  agentClient: {},
  chatClient: {},
  request: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock('./queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import { queryClient } from './queryClient';
import { getResourceDef, invalidateAgentViews } from './resourceDefs';

const def = getResourceDef('cluster-agent-bindings');
if (!def?.decode || !def.encode) {
  throw new Error('cluster-agent-bindings must define both codecs');
}

const decode = def.decode;
const encode = def.encode;

describe('cluster agent binding codec', () => {
  it('decodes an empty agent selector as the "all agents" wildcard', () => {
    const row = decode({ metadata: { name: 'all' }, spec: { agentSelector: {}, commands: ['duty'] } });
    expect((row.spec as Record<string, unknown>).agents).toEqual(['*']);
  });

  it('leaves named agents alone when the selector is non-empty', () => {
    const row = decode({
      metadata: { name: 'sre' },
      spec: {
        agents: [{ name: 'pod-agent', namespace: 'default' }],
        agentSelector: { matchLabels: { team: 'sre' } },
      },
    });
    expect((row.spec as Record<string, unknown>).agents).toEqual([
      { name: 'pod-agent', namespace: 'default' },
    ]);
  });

  it('encodes the wildcard as an explicit empty selector', () => {
    const body = encode(
      {
        metadata: { name: 'all' },
        spec: { agents: [{ name: '*' }], agentSelector: undefined, commands: ['pod'] },
      },
      'update'
    );
    expect(body.spec).toEqual({ agentSelector: {}, commands: ['pod'] });
  });

  it('keeps a command group selector', () => {
    const commandSelector = {
      matchExpressions: [
        { key: 'agent.onexstack.io/group', operator: 'In', values: ['duty'] },
      ],
    };
    const body = encode(
      {
        metadata: { name: 'duty' },
        spec: { commandSelector, commands: ['oncall'] },
      },
      'update'
    );
    expect((body.spec as Record<string, unknown>).commandSelector).toEqual(commandSelector);
  });

  it('prunes an empty command selector', () => {
    const body = encode(
      {
        metadata: { name: 'duty' },
        spec: { commandSelector: { matchExpressions: [] }, commands: ['oncall'] },
      },
      'update'
    );
    expect((body.spec as Record<string, unknown>).commandSelector).toBeUndefined();
  });

  it('prunes an empty selector when only named agents are left', () => {
    const body = encode(
      {
        metadata: { name: 'sre' },
        spec: {
          agents: [{ name: 'pod-agent', namespace: 'default' }],
          agentSelector: { matchExpressions: [] },
        },
      },
      'update'
    );
    expect((body.spec as Record<string, unknown>).agentSelector).toBeUndefined();
    expect((body.spec as Record<string, unknown>).agents).toEqual([
      { name: 'pod-agent', namespace: 'default' },
    ]);
  });

  it('normalizes a namespace-prefixed catalog command to its bare name', () => {
    const row = decode({
      metadata: { name: 'test' },
      spec: { commands: ['helper-public/pod', 'duty'] },
    });
    expect((row.spec as Record<string, unknown>).commands).toEqual(['pod', 'duty']);

    const body = encode(
      { metadata: { name: 'test' }, spec: { commands: ['helper-public/pod'] } },
      'update'
    );
    expect((body.spec as Record<string, unknown>).commands).toEqual(['pod']);
  });
});

describe('agent binding codec', () => {
  const binding = getResourceDef('agent-bindings');

  it('normalizes legacy namespace-prefixed commands on read and write', () => {
    if (!binding?.decode || !binding.encode) throw new Error('agent-bindings codec missing');
    const row = binding.decode({
      metadata: { name: 'onex' },
      spec: { commands: ['helper-public/pod'] },
    });
    expect((row.spec as Record<string, unknown>).commands).toEqual(['pod']);

    const body = binding.encode(
      { metadata: { name: 'onex' }, spec: { commands: ['helper-public/pod'] } },
      'update'
    );
    expect((body.spec as Record<string, unknown>).commands).toEqual(['pod']);
  });
});

describe('invalidateAgentViews', () => {
  it('marks agent-derived views stale when a command changes', () => {
    const invalidate = vi.mocked(queryClient.invalidateQueries);
    invalidate.mockClear();

    invalidateAgentViews('custom-commands');

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['agent'],
      refetchType: 'none',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['chat', 'commands'],
      refetchType: 'none',
    });
  });

  it('does nothing for a resource that cannot change an agent view', () => {
    const invalidate = vi.mocked(queryClient.invalidateQueries);
    invalidate.mockClear();

    invalidateAgentViews('namespaces');

    expect(invalidate).not.toHaveBeenCalled();
  });
});
