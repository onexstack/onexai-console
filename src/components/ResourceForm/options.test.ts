import { describe, expect, it } from 'vitest';

import { authzBackendsPlaceholder, reconcileAuthzBackends, refOptionsFromRows } from './options';

const row = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  status: 'enabled',
  ...overrides,
});

/** helper-public / platform 的知识库对 default 的 Agent 放行。 */
const grants = [
  {
    namespace: 'helper-public',
    from: [{ group: 'agent.onexai.io', kind: 'Agent', namespace: 'default' }],
    to: [{ group: 'agent.onexai.io', kind: 'KnowledgeBase' }],
  },
  {
    namespace: 'platform',
    from: [{ group: 'agent.onexai.io', kind: 'Agent', namespace: 'default' }],
    to: [{ group: 'agent.onexai.io', kind: 'KnowledgeBase' }],
  },
];

/** 候选顺序由 sortNewestFirst 决定；这里只关心集合。 */
const values = (options: { value: string }[]) => options.map(option => option.value).sort();

const rows = [
  row({ name: 'local-kb', namespace: 'default' }),
  row({ name: 'shared-kb', namespace: 'helper-public' }),
  row({ name: 'other-kb', namespace: 'platform' }),
];

describe('refOptionsFromRows', () => {
  it('returns no candidates for an agent whose target namespace is unknown', () => {
    expect(
      refOptionsFromRows({
        rows,
        referrerKey: 'agents',
        resourceKey: 'knowledge-bases',
        grants,
      })
    ).toEqual([]);
  });

  it('makes local refs selectable and granted cross-namespace refs visible but disabled', () => {
    const options = refOptionsFromRows({
      rows,
      scopeNamespace: 'default',
      referrerKey: 'agents',
      resourceKey: 'knowledge-bases',
      grants,
    });

    expect(values(options)).toEqual(['helper-public/shared-kb', 'local-kb', 'platform/other-kb']);
    const local = options.find(option => option.value === 'local-kb');
    expect(local?.disabled).toBeUndefined();
    const shared = options.find(option => option.value === 'helper-public/shared-kb');
    expect(shared).toMatchObject({ disabled: true });
    expect(shared?.label).toContain('需能力绑定');
  });

  it('hides cross-namespace refs without a grant', () => {
    const options = refOptionsFromRows({
      rows,
      scopeNamespace: 'default',
      referrerKey: 'agents',
      resourceKey: 'knowledge-bases',
    });
    expect(values(options)).toEqual(['local-kb']);
  });

  it('keeps cross-namespace refs selectable for AgentBinding forms', () => {
    const options = refOptionsFromRows({
      rows,
      scopeNamespace: 'default',
      referrerKey: 'agent-bindings',
      resourceKey: 'knowledge-bases',
      grants,
    });
    expect(values(options)).toEqual(['helper-public/shared-kb', 'local-kb', 'platform/other-kb']);
    expect(options.every(option => option.disabled === undefined)).toBe(true);
  });

  it('keeps catalog command names bare, even across published namespaces', () => {
    // commandreg 把同一份目录发布到每个命名空间；命令名是全局裸名，行上的
    // namespace 不能进入选择值，否则 spec.commands 匹配不到目录。
    const options = refOptionsFromRows({
      rows: [
        row({ name: 'pod', namespace: 'helper-public', group: 'resource' }),
        row({ name: 'pod', namespace: 'default', group: 'resource' }),
        row({ name: 'assign', namespace: 'helper-public', group: 'duty' }),
      ],
      referrerKey: 'cluster-agent-bindings',
      resourceKey: 'chat-commands',
    });
    expect(values(options)).toEqual(['assign', 'pod']);
    expect(options.find(option => option.value === 'pod')?.label).toBe('pod');
  });

  it('fails closed when a namespaced referrer has no scope', () => {
    // 页头“全部空间”时，绑定表单不能展开所有空间的候选：没有引用方空间就
    // 无法判断授权，猜一个会写出后端拒绝的绑定。
    const options = refOptionsFromRows({
      rows,
      referrerKey: 'agent-bindings',
      resourceKey: 'knowledge-bases',
      grants,
    });
    expect(options).toEqual([]);
  });

  it('does not trust a grant whose group or referrer kind is wrong', () => {
    // 后端精确匹配 group/kind；前端若只看 namespace，就会把一条永远不生效的
    // grant 当成授权，出现“界面可选、后端拒绝”。
    const wrongGroup = [
      {
        namespace: 'helper-public',
        from: [{ group: 'wrong.example.io', kind: 'Agent', namespace: 'default' }],
        to: [{ group: 'agent.onexai.io', kind: 'KnowledgeBase' }],
      },
      {
        namespace: 'platform',
        from: [{ group: 'agent.onexai.io', kind: 'AgentBinding', namespace: 'default' }],
        to: [{ group: 'agent.onexai.io', kind: 'KnowledgeBase' }],
      },
    ];
    const options = refOptionsFromRows({
      rows,
      scopeNamespace: 'default',
      referrerKey: 'agent-bindings',
      resourceKey: 'knowledge-bases',
      grants: wrongGroup,
    });
    expect(values(options)).toEqual(['local-kb']);
  });

  it('treats a model as a shareable capability', () => {
    const modelRows = [
      row({ name: 'local-model', namespace: 'default' }),
      row({ name: 'shared-model', namespace: 'helper-public' }),
    ];
    const modelGrant = [
      {
        namespace: 'helper-public',
        from: [{ group: 'agent.onexai.io', kind: 'Agent', namespace: 'default' }],
        to: [{ group: 'agent.onexai.io', kind: 'Model', name: 'shared-model' }],
      },
    ];
    const options = refOptionsFromRows({
      rows: modelRows,
      scopeNamespace: 'default',
      referrerKey: 'agent-bindings',
      resourceKey: 'models',
      grants: modelGrant,
    });
    expect(values(options)).toEqual(['helper-public/shared-model', 'local-model']);
  });

  it('lets a cluster binding share only kinds the sharing table allows', () => {
    const options = refOptionsFromRows({
      rows: [
        row({ name: 'local-model', namespace: 'default' }),
        row({ name: 'shared-model', namespace: 'helper-public' }),
      ],
      referrerKey: 'cluster-agent-bindings',
      resourceKey: 'models',
    });
    expect(values(options)).toEqual(['default/local-model', 'helper-public/shared-model']);

    const commands = refOptionsFromRows({
      rows: [row({ name: 'shared-cmd', namespace: 'helper-public' })],
      referrerKey: 'cluster-agent-bindings',
      resourceKey: 'custom-commands',
    });
    expect(commands).toEqual([]);
  });

  it('never shares resource kinds the Agent spec requires local', () => {
    const options = refOptionsFromRows({
      rows: [
        row({ name: 'local-cmd', namespace: 'default' }),
        row({ name: 'shared-cmd', namespace: 'helper-public' }),
      ],
      scopeNamespace: 'default',
      referrerKey: 'agents',
      resourceKey: 'custom-commands',
      grants,
    });
    expect(values(options)).toEqual(['local-cmd']);
  });
});

describe('reconcileAuthzBackends', () => {
  it('treats none as exclusive: selecting it clears every concrete backend', () => {
    expect(reconcileAuthzBackends(['opa'], ['opa', 'none'])).toEqual(['none']);
  });

  it('drops none when a concrete backend is selected afterwards', () => {
    expect(reconcileAuthzBackends(['none'], ['none', 'opa'])).toEqual(['opa']);
  });

  it('keeps ordinary multiple selections untouched', () => {
    expect(reconcileAuthzBackends(['opa'], ['opa', 'casdoor'])).toEqual(['opa', 'casdoor']);
    expect(reconcileAuthzBackends(['opa', 'casdoor'], [])).toEqual([]);
  });
});

describe('authzBackendsPlaceholder', () => {
  const option = (value: string) => ({ value, label: value });

  it('names the backends that stay in effect when the field is left empty', () => {
    expect(authzBackendsPlaceholder([option('opa'), option('none')], false)).toBe(
      '留空使用部署默认（opa）'
    );
  });

  it('summarizes a long backend list instead of overflowing the field', () => {
    const options = ['a', 'b', 'c', 'd'].map(option);
    expect(authzBackendsPlaceholder(options, false)).toBe('留空使用部署默认（a / b 等 4 个）');
  });

  it('says so when the deployment registers no backends at all', () => {
    expect(authzBackendsPlaceholder([option('none')], false)).toContain('部署未启用授权后端');
  });
});
