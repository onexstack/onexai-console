import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Descriptions,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import {
  approveCustomCommand,
  cancelScheduledExecution,
  getEffectiveAgent,
  invokeCustomCommand,
  listContextCommands,
  listContextSkills,
  listCustomCommandAudits,
  listScheduledExecutions,
  previewAgentBinding,
  testModel,
} from '@/api/agent';
import { listChatCommands } from '@/api/chat';
import { formatDate, formatDurationMs } from '@/lib/date';
import { fetchAllRows, resourceRowsQueryKey } from '@/api/resourceDefs';
import {
  buildSessionCommands,
  type CommandSource,
  type SessionCommandRow,
  type UnavailableCommandRow,
} from './sessionCommands';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import type {
  CustomCommandAudit,
  InvokeCustomCommandResponse,
  ScheduledExecution,
} from '@/api/types';

/**
 * 详情页的附加页签。
 *
 * 这些页签都要发请求（生效能力、执行记录、审计、预览、测试），描述符表达不了
 * 「一行一个字段」之外的交互，所以单独成组件；页面只按 key 取用。
 */

const MONO = { fontFamily: 'var(--font-family-code, monospace)', fontSize: 12 } as const;

// ─── 生效能力 ────────────────────────────────────────────────────────────────

const CAPABILITY_LABELS: Record<string, string> = {
  model: '模型',
  skills: 'Skill',
  mcps: 'MCP',
  knowledgeBases: '知识库',
  customCommands: '自定义命令',
  commands: '命令（内置 / skill:）',
  webhooks: 'Agent Webhook',
  templates: '模版',
  delegates: '子智能体',
};

/** 详情记录里的引用字段统一取成名称数组（兼容字符串与 `{name}` 形态）。 */
function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' && value ? [value] : [];
  return value
    .map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      const name = String(record.name ?? '');
      const namespace = String(record.namespace ?? '');
      if (!name) return '';
      return namespace ? `${namespace}/${name}` : name;
    })
    .filter(Boolean);
}

/**
 * 声明的引用与生效的能力是否指同一个对象。
 *
 * 生效集合里的跨空间引用是 `namespace/name`，而声明可能只写裸名（引用方所在
 * 空间）。裸名按“名字相同”匹配，带空间的声明才要求空间也相同。
 */
function sameRef(declared: string, effective: string): boolean {
  if (declared === effective) return true;
  const [declaredNamespace, declaredName] = declared.includes('/')
    ? declared.split('/')
    : ['', declared];
  const [effectiveNamespace, effectiveName] = effective.includes('/')
    ? effective.split('/')
    : ['', effective];
  return (
    declaredName === effectiveName &&
    (declaredNamespace === '' || declaredNamespace === effectiveNamespace)
  );
}

export function AgentEffectivePanel({
  name,
  record,
}: {
  name: string;
  record: Record<string, unknown>;
}) {
  const query = useQuery({
    queryKey: ['agent', name, 'effective'],
    queryFn: () => getEffectiveAgent(name),
    staleTime: 15_000,
  });

  if (query.isLoading) return <Spin />;
  if (query.isError) {
    return (
      <Alert
        type="error"
        showIcon
        title="读取生效能力失败"
        description={(query.error as Error).message}
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  }
  const data = query.data;
  if (!data) return <Empty description="没有生效能力数据" />;

  const capabilities = data.capabilities ?? {};
  const groups = Object.entries(CAPABILITY_LABELS).filter(([key]) => {
    const value = (capabilities as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });

  // 一个声明类别对应 /effective 里的哪个集合。返回 null 表示 /effective
  // 没有这一类（模型、提示词），无法判断，展示时不打生效状态。
  const effectiveFor = (label: string): string[] | null => {
    switch (label) {
      case 'Skill':
        return capabilities.skills ?? [];
      case 'MCP':
        return capabilities.mcps ?? [];
      case '知识库':
        return capabilities.knowledgeBases ?? [];
      case '自定义命令':
        return capabilities.customCommands ?? [];
      case '模版':
        return capabilities.templates ?? [];
      case '子智能体':
        return capabilities.delegates ?? [];
      case 'Agent Webhook':
        return capabilities.webhooks ?? [];
      default:
        return null;
    }
  };

  // 无论生效集合是否为空都摆出声明值：只看生效集合会漏掉“声明了但没解析到”
  // 的项，这正是最容易让人误判的地方。
  const declared = (
    [
      ['模型', namesOf(record.model)],
      ['模版', namesOf(record.templateRefs)],
      ['提示词', namesOf(record.prompts)],
      ['Skill', namesOf(record.skills)],
      ['MCP', namesOf(record.mcps)],
      ['知识库', namesOf(record.knowledgeBases)],
      ['自定义命令', namesOf(record.customCommands)],
      ['子智能体', namesOf(record.delegates)],
      ['Agent Webhook', namesOf(record.webhooks)],
    ] as [string, string[]][]
  ).filter(([, list]) => list.length > 0);

  const missing = declared.flatMap(([label, list]) => {
    const effective = effectiveFor(label);
    if (effective === null) return [];
    return list
      .filter(name => !effective.some(item => sameRef(name, item)))
      .map(name => `${label}/${name}`);
  });

  // 后端的 unresolved 覆盖 bindings/templates 贡献的引用；前端的 missing 只
  // 覆盖 Agent spec 里声明的引用。有后端列表时以它为准。
  const unresolved = data.unresolved ?? missing;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {groups.length === 0 ? (
        <Empty
          description={
            data.observed
              ? '控制器已观测到该智能体，但没有解析出任何生效能力'
              : '控制器尚未观测到该智能体'
          }
        />
      ) : (
        <Descriptions bordered size="small" column={1}>
          {groups.map(([key, label]) => {
            const value = (capabilities as Record<string, unknown>)[key];
            const list = Array.isArray(value) ? (value as string[]) : [];
            return (
              <Descriptions.Item key={key} label={label}>
                {list.length > 0 ? (
                  <Space size={[4, 4]} wrap>
                    {list.map(item => (
                      <Tag key={item}>{item}</Tag>
                    ))}
                  </Space>
                ) : (
                  String(value)
                )}
              </Descriptions.Item>
            );
          })}
        </Descriptions>
      )}

      {unresolved.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title="有引用没有生效"
          description={
            data.observed ? (
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <span>
                  同命名空间引用会直接解析；跨命名空间需要目标空间的 ReferenceGrant， 且 Agent spec
                  只写本地引用（跨空间能力由 AgentBinding / ClusterAgentBinding 注入）。
                </span>
                {unresolved.map(item => (
                  <Typography.Text key={item} code>
                    {item}
                  </Typography.Text>
                ))}
              </Space>
            ) : (
              '控制器尚未观测到该智能体的最新 spec，以下状态可能滞后。'
            )
          }
        />
      )}

      {declared.length > 0 && (
        <Descriptions bordered size="small" column={1} title="智能体声明的引用（含生效状态）">
          {declared.map(([label, list]) => {
            const effective = effectiveFor(label);
            return (
              <Descriptions.Item key={label} label={label}>
                <Space size={[4, 4]} wrap>
                  {list.map(item => {
                    const state =
                      effective === null
                        ? 'unknown'
                        : effective.some(name => sameRef(item, name))
                          ? 'ok'
                          : 'missing';
                    return (
                      <Tag
                        key={item}
                        color={
                          state === 'ok' ? 'green' : state === 'missing' ? 'orange' : undefined
                        }
                      >
                        {state === 'missing' ? '未生效 ' : ''}
                        {item}
                      </Tag>
                    );
                  })}
                </Space>
              </Descriptions.Item>
            );
          })}
        </Descriptions>
      )}

      <div>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          来源绑定
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          这是「它为什么有这些能力」的答案：每个能力编排贡献了什么。
          {data.bindings?.truncated ? '（列表已被截断）' : ''}
        </Typography.Paragraph>
        <Table
          size="small"
          rowKey="name"
          pagination={false}
          dataSource={data.bindings?.items ?? []}
          locale={{ emptyText: '没有能力编排覆盖这个智能体；能力来自智能体自身的字段。' }}
          columns={[
            { title: '绑定', dataIndex: 'name', key: 'name' },
            { title: 'Generation', dataIndex: 'generation', key: 'generation', width: 100 },
            { title: '提示词', dataIndex: 'prompt_count', key: 'prompt_count', width: 80 },
            { title: 'Skill', dataIndex: 'skill_count', key: 'skill_count', width: 70 },
            { title: 'MCP', dataIndex: 'mcp_count', key: 'mcp_count', width: 70 },
            {
              title: '知识库',
              dataIndex: 'knowledge_base_count',
              key: 'knowledge_base_count',
              width: 80,
            },
            { title: '命令', dataIndex: 'command_count', key: 'command_count', width: 70 },
          ]}
        />
      </div>
    </Space>
  );
}

// ─── 智能体模版使用方 ────────────────────────────────────────────────────────

/**
 * 智能体模版的反向视图：哪些 Agent 在 `spec.templateRefs` 里引用了它。
 *
 * 控制面没有「被谁引用」索引，这里从全量 Agent 行里过滤；观察的是智能体列表
 * 同一份 `['res','agents','all']` 缓存，不会额外打一次请求。
 */
export function AgentTemplateUsagePanel({ name, namespace }: { name: string; namespace?: string }) {
  const query = useQuery({
    queryKey: resourceRowsQueryKey('agents'),
    queryFn: () => fetchAllRows('agents'),
    staleTime: 30_000,
  });

  if (query.isLoading) return <Spin />;
  if (query.isError) {
    return (
      <Alert
        type="error"
        showIcon
        title="读取智能体失败"
        description={(query.error as Error).message}
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  }

  const rows = (query.data ?? []).filter(row => {
    const refs = row.templateRefs;
    if (!Array.isArray(refs) || !refs.map(String).includes(name)) return false;
    // 智能体模版只能被同命名空间的 Agent 引用；任一侧没有命名空间时不额外过滤。
    const agentNamespace = String(row.namespace ?? '');
    return !namespace || !agentNamespace || agentNamespace === namespace;
  });

  if (rows.length === 0) {
    return <Empty description="还没有智能体引用这个模版" />;
  }

  return (
    <Table
      size="small"
      rowKey={row => String(row.name ?? '')}
      pagination={false}
      dataSource={rows}
      columns={[
        {
          title: '智能体',
          dataIndex: 'name',
          render: (value: unknown) => (
            <Link to={`/agents/${encodeURIComponent(String(value ?? ''))}`}>
              {String(value ?? '')}
            </Link>
          ),
        },
        {
          title: '显示名',
          dataIndex: 'displayName',
          render: (value: unknown) => String(value ?? '') || '-',
        },
        {
          title: '命名空间',
          dataIndex: 'namespace',
          render: (value: unknown) => String(value ?? '') || '默认',
        },
        {
          title: '状态',
          dataIndex: 'status',
          render: (value: unknown) => (
            <Tag color={value === 'disabled' ? 'default' : 'green'}>
              {value === 'disabled' ? '停用' : '启用'}
            </Tag>
          ),
        },
      ]}
    />
  );
}

// ─── 会话命令 ────────────────────────────────────────────────────────────────

const COMMAND_SOURCE_META: Record<CommandSource, { text: string; color: string }> = {
  builtin: { text: '内置', color: 'blue' },
  skill: { text: '技能', color: 'purple' },
  custom: { text: '自定义', color: 'green' },
};

function tagList(value: unknown): ReactNode {
  const items = namesOf(value);
  if (items.length === 0) return '-';
  return (
    <Space size={[4, 4]} wrap>
      {items.map(item => (
        <Tag key={item}>{item}</Tag>
      ))}
    </Space>
  );
}

function commandExtras(row: SessionCommandRow): ReactNode {
  const parts: ReactNode[] = [];
  for (const alias of row.aliases ?? []) {
    parts.push(<Tag key={`alias:${alias}`}>{alias}</Tag>);
  }
  if (row.repo) {
    parts.push(
      <Typography.Text key="repo" type="secondary" style={{ fontSize: 12 }}>
        仓库：{row.repo}
      </Typography.Text>
    );
  }
  if (row.provider) {
    parts.push(
      <Typography.Text key="provider" type="secondary" style={{ fontSize: 12 }}>
        提供方：{row.provider}
      </Typography.Text>
    );
  }
  if (row.parameters && row.parameters.length > 0) {
    parts.push(
      <Typography.Text key="params" type="secondary" style={{ fontSize: 12 }}>
        {row.parameters.length} 个参数
      </Typography.Text>
    );
  }
  if (row.group) {
    parts.push(
      <Typography.Text key="group" type="secondary" style={{ fontSize: 12 }}>
        分组：{row.group}
      </Typography.Text>
    );
  }
  return parts.length > 0 ? (
    <Space size={[4, 4]} wrap>
      {parts}
    </Space>
  ) : (
    '-'
  );
}

export function AgentSessionCommandsPanel({
  name,
  record,
}: {
  name: string;
  record: Record<string, unknown>;
}) {
  const effective = useQuery({
    queryKey: ['agent', name, 'effective'],
    queryFn: () => getEffectiveAgent(name),
    staleTime: 15_000,
  });
  const chatCatalog = useQuery({
    queryKey: ['chat', 'commands', 'all'],
    queryFn: () => listChatCommands({ offset: 0, limit: 0 }),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const contextSkills = useQuery({
    queryKey: ['agent', name, 'context-skills'],
    queryFn: () => listContextSkills(name),
    staleTime: 30_000,
    retry: 1,
  });
  const contextCommands = useQuery({
    queryKey: ['agent', name, 'context-commands'],
    queryFn: () => listContextCommands(name),
    staleTime: 30_000,
    retry: 1,
  });

  const { callable, unavailable } = useMemo(
    () =>
      buildSessionCommands({
        capabilities: effective.data?.capabilities,
        chatCommands: chatCatalog.data?.items,
        contextSkills: contextSkills.data,
        contextCommands: contextCommands.data,
      }),
    [effective.data, chatCatalog.data, contextSkills.data, contextCommands.data]
  );

  if (effective.isLoading) return <Spin />;
  if (effective.isError) {
    return (
      <Alert
        type="error"
        showIcon
        title="读取会话命令失败"
        description={(effective.error as Error).message}
        action={<Button onClick={() => void effective.refetch()}>重试</Button>}
      />
    );
  }

  const data = effective.data;
  if (!data) return <Empty description="没有生效能力数据" />;

  const unobserved = data.observed === false;
  // 目录读取失败（data 仍为 undefined）才降级；有旧缓存时继续用旧数据。
  const downgraded = [
    chatCatalog.data === undefined && chatCatalog.isError ? '内置命令目录' : '',
    contextSkills.data === undefined && contextSkills.isError ? '技能目录' : '',
    contextCommands.data === undefined && contextCommands.isError ? '自定义命令目录' : '',
  ].filter(Boolean);
  const enriching = chatCatalog.isLoading || contextSkills.isLoading || contextCommands.isLoading;
  const namespace =
    typeof record.namespace === 'string' && record.namespace !== ''
      ? record.namespace
      : '默认命名空间';
  const observedText = data.observed === undefined ? '未知' : data.observed ? '已观测' : '尚未观测';

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        这里只列出当前会话里真正可以输入 `/命令名` 调用的命令。内置命令和技能命令来自能力编排的
        `spec.commands`（技能写 `skill:&lt;技能名&gt;`），自定义命令来自 `spec.customCommands`。
        同名时内置/技能优先，自定义命令不会被注册。
      </Typography.Paragraph>

      {downgraded.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title="部分目录读取失败，列表已降级为仅显示名称"
          description={`${downgraded.join('、')}读取失败；说明、用法和可用性可能不完整。`}
        />
      )}

      {unobserved && (
        <Alert
          type="warning"
          showIcon
          title="控制器尚未观测到该智能体"
          description="此时内置与技能命令尚未解析，customCommands 可能是智能体自身的声明值，不能当作可调用命令。请稍后刷新，并检查控制器状态。"
        />
      )}

      {!unobserved &&
        (callable.length > 0 ? (
          <Table
            size="small"
            rowKey="key"
            pagination={false}
            loading={enriching}
            dataSource={callable}
            columns={[
              {
                title: '命令',
                dataIndex: 'name',
                key: 'name',
                width: 220,
                render: (_value: unknown, row: SessionCommandRow) => (
                  <Typography.Text code>/{row.name}</Typography.Text>
                ),
              },
              {
                title: '来源',
                dataIndex: 'source',
                key: 'source',
                width: 90,
                render: (_value: unknown, row: SessionCommandRow) => (
                  <Tag color={COMMAND_SOURCE_META[row.source].color}>
                    {COMMAND_SOURCE_META[row.source].text}
                  </Tag>
                ),
              },
              {
                title: '说明',
                dataIndex: 'description',
                key: 'description',
                ellipsis: { showTitle: true },
                render: (_value: unknown, row: SessionCommandRow) =>
                  row.description ?? row.note ?? '-',
              },
              {
                title: '用法',
                dataIndex: 'usage',
                key: 'usage',
                width: 260,
                ellipsis: { showTitle: true },
                render: (_value: unknown, row: SessionCommandRow) =>
                  row.usage ? <Typography.Text code>{row.usage}</Typography.Text> : '-',
              },
              {
                title: '别名 / 附加信息',
                key: 'extras',
                render: (_value: unknown, row: SessionCommandRow) => commandExtras(row),
              },
            ]}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={8}>
                <span>
                  {unavailable.length > 0
                    ? '授予的命令当前都不可调用，原因见下表。'
                    : '还没有可用的会话命令。'}
                </span>
                <span>
                  请到「能力编排 → 能力设置」为覆盖这个智能体的绑定授予 spec.commands（如 bind，或
                  skill:&lt;技能名&gt;）或 spec.customCommands。
                  技能命令还需要技能仓库勾选「作为命令（asCmd=Yes）」并加载成功。
                </span>
                <Link to="/agent-bindings">
                  <Button type="primary">前往能力编排</Button>
                </Link>
              </Space>
            }
          />
        ))}

      {!unobserved && unavailable.length > 0 && (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            已授予但当前不可调用
          </Typography.Title>
          <Table
            size="small"
            rowKey="key"
            pagination={false}
            loading={enriching}
            dataSource={unavailable}
            columns={[
              {
                title: '授权项',
                dataIndex: 'grant',
                key: 'grant',
                width: 220,
                render: (_value: unknown, row: UnavailableCommandRow) => (
                  <Typography.Text code>{row.grant}</Typography.Text>
                ),
              },
              {
                title: '来源',
                dataIndex: 'source',
                key: 'source',
                width: 90,
                render: (_value: unknown, row: UnavailableCommandRow) => (
                  <Tag color={COMMAND_SOURCE_META[row.source].color}>
                    {COMMAND_SOURCE_META[row.source].text}
                  </Tag>
                ),
              },
              { title: '原因', dataIndex: 'reason', key: 'reason', width: 200 },
              {
                title: '排查建议',
                dataIndex: 'detail',
                key: 'detail',
                render: (_value: unknown, row: UnavailableCommandRow) => (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.detail}
                  </Typography.Text>
                ),
              },
            ]}
          />
        </Space>
      )}

      <Collapse
        size="small"
        defaultActiveKey={
          callable.length === 0 && unavailable.length === 0 ? ['diagnostics'] : undefined
        }
        items={[
          {
            key: 'diagnostics',
            label: '诊断信息',
            children: (
              <Descriptions size="small" bordered column={1}>
                <Descriptions.Item label="命名空间">{namespace}</Descriptions.Item>
                <Descriptions.Item label="控制器观测">{observedText}</Descriptions.Item>
                <Descriptions.Item label="Resolved Hash">
                  {data.resolvedHash || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="绑定数">{data.bindings?.total ?? 0}</Descriptions.Item>
                <Descriptions.Item label="智能体声明的 Skill">
                  {tagList(record.skills)}
                </Descriptions.Item>
                <Descriptions.Item label="已加载的技能命令（需 skill:<名字> 授予才可调用）">
                  {contextSkills.data === undefined
                    ? '目录不可用'
                    : tagList(contextSkills.data.map(item => item.name))}
                </Descriptions.Item>
                <Descriptions.Item label="历史 customCommands（声明值）">
                  {tagList(record.customCommands)}
                </Descriptions.Item>
                <Descriptions.Item label="绑定贡献的 commands">
                  {tagList(data.capabilities?.commands)}
                </Descriptions.Item>
                <Descriptions.Item label="绑定贡献的 customCommands">
                  {tagList(data.capabilities?.customCommands)}
                </Descriptions.Item>
              </Descriptions>
            ),
          },
        ]}
      />
    </Space>
  );
}

// ─── 定时任务执行记录 ────────────────────────────────────────────────────────

const EXECUTION_STATE: Record<string, { text: string; color: string }> = {
  // 控制器还没接管（或起不来）的 Job 没有 phase，后端报 pending。
  pending: { text: '等待中', color: 'gold' },
  running: { text: '运行中', color: 'blue' },
  completed: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'red' },
  canceled: { text: '已取消', color: 'default' },
};

/** 未终结的执行，页面需要继续轮询。 */
function isActiveExecution(state?: string): boolean {
  return state === 'pending' || state === 'running';
}

const EXECUTION_TRIGGER: Record<string, string> = {
  scheduled: '定时',
  manual: '手动',
};

export function ScheduledExecutionsPanel({ name }: { name: string }) {
  const queryClient = useQueryClient();
  const token = useSessionToken();
  const isAdmin = Boolean(decodeClaims(token)?.isAdmin);
  const [limit, setLimit] = useState(20);
  const query = useQuery({
    queryKey: ['res', 'scheduled-runs', name, 'executions', limit],
    queryFn: () => listScheduledExecutions(name, limit),
    staleTime: 10_000,
    // 只有未终结的执行会变化；终态后停掉轮询，避免页面长期空转。
    refetchInterval: current =>
      (current.state.data ?? []).some(row => isActiveExecution(row.state)) ? 5000 : false,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelScheduledExecution(name, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['res', 'scheduled-runs', name, 'executions'],
      });
    },
  });

  const columns = [
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 90,
      render: (value: string) => {
        const mapped = EXECUTION_STATE[value] ?? { text: value, color: 'default' };
        return <Tag color={mapped.color}>{mapped.text}</Tag>;
      },
    },
    {
      title: '触发',
      dataIndex: 'trigger',
      key: 'trigger',
      width: 80,
      render: (value?: string) => EXECUTION_TRIGGER[value ?? ''] ?? value ?? '-',
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      key: 'started_at',
      render: (value?: number) => (value ? formatDate(value) : '-'),
    },
    {
      title: '耗时',
      key: 'duration',
      width: 90,
      render: (_v: unknown, row: ScheduledExecution) =>
        formatDurationMs(row.started_at, row.finished_at),
    },
    {
      title: '运行 ID',
      dataIndex: 'run_id',
      key: 'run_id',
      render: (value?: string) => {
        if (!value) return '-';
        // 异步任务页是管理面；非管理员不渲染一个点了会 403 的入口。
        if (!isAdmin) return <code style={MONO}>{value}</code>;
        return (
          <Link to={`/async-tasks/${encodeURIComponent(value)}`}>
            <code style={MONO}>{value}</code>
          </Link>
        );
      },
    },
    {
      title: '失败原因',
      dataIndex: 'failure_reason',
      key: 'failure_reason',
      ellipsis: true,
      render: (v?: string) => v || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_v: unknown, row: ScheduledExecution) =>
        isActiveExecution(row.state) ? (
          <Popconfirm title="取消这次执行？" onConfirm={() => cancel.mutate(row.id)}>
            <Button
              type="link"
              size="small"
              danger
              style={{ padding: 0 }}
              loading={cancel.isPending}
            >
              取消
            </Button>
          </Popconfirm>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          上游只支持 `limit`，没有偏移分页——这里显示最近 N 条，不画分页控件。
        </Typography.Text>
        <Space>
          <Select
            size="small"
            value={limit}
            onChange={setLimit}
            options={[
              { value: 20, label: '最近 20 条' },
              { value: 50, label: '最近 50 条' },
              { value: 100, label: '最近 100 条' },
            ]}
          />
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
            刷新
          </Button>
        </Space>
      </div>
      <Table
        size="small"
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        columns={columns}
        pagination={false}
        locale={{ emptyText: '还没有执行记录' }}
      />
    </div>
  );
}

// ─── 自定义命令：调用与审计 ───────────────────────────────────────────────────

export function CustomCommandInvokePanel({ name }: { name: string }) {
  const [agent, setAgent] = useState('');
  const [params, setParams] = useState('{}');
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState<InvokeCustomCommandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const invoke = useMutation({
    mutationFn: () =>
      invokeCustomCommand(name, {
        agent: agent || undefined,
        params: JSON.parse(params) as Record<string, unknown>,
        dryRun,
      }) as Promise<InvokeCustomCommandResponse>,
    onSuccess: data => {
      setResult(data);
      setError(null);
    },
    onError: err => {
      setResult(null);
      setError(err instanceof Error ? err.message : '调用失败');
    },
  });

  const approve = useMutation({
    mutationFn: (decision: 'allow' | 'deny') =>
      approveCustomCommand(name, {
        approvalId: result?.status?.approval?.approvalId ?? '',
        decision,
        agent: result?.status?.approval?.agent,
      }),
  });

  const submit = () => {
    try {
      JSON.parse(params);
      setJsonError(null);
      invoke.mutate();
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : '参数不是合法 JSON');
    }
  };

  const approval = result?.status?.approval;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        title="这是管理面调用"
        description="调用会以指定智能体身份执行命令定义（prompt / HTTP / 工具调用）。建议先 dryRun 看判定与渲染结果。"
      />
      <Input
        addonBefore="智能体"
        placeholder="agent 名称（可留空）"
        value={agent}
        onChange={event => setAgent(event.target.value)}
      />
      <Input.TextArea
        rows={6}
        value={params}
        onChange={event => setParams(event.target.value)}
        placeholder='参数 JSON，如 {"service":"payment"}'
        style={MONO}
      />
      {jsonError && <Alert type="error" showIcon title={jsonError} />}
      <Space>
        <Button type="primary" loading={invoke.isPending} onClick={submit}>
          调用
        </Button>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />{' '}
          dryRun（只判定，不执行副作用）
        </label>
      </Space>

      {error && <Alert type="error" showIcon title="调用失败" description={error} />}

      {result && (
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="阶段">
            <Tag color={result.status?.phase === 'Succeeded' ? 'green' : 'orange'}>
              {result.status?.phase ?? '-'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="说明">{result.status?.message || '-'}</Descriptions.Item>
          <Descriptions.Item label="原因">{result.status?.reason || '-'}</Descriptions.Item>
          <Descriptions.Item label="警告">
            {(result.status?.warnings ?? []).length > 0 ? result.status?.warnings?.join('；') : '-'}
          </Descriptions.Item>
          {result.status?.phase === 'Denied' && (
            <Descriptions.Item label="判定错误">
              {result.status?.evaluationError || '-'}
            </Descriptions.Item>
          )}
        </Descriptions>
      )}

      {approval?.approvalId && approval.phase === 'pending' && (
        <Alert
          type="warning"
          showIcon
          title="这次调用被挂起，等待审批"
          description={
            <Space direction="vertical">
              <span>
                工具：{approval.tool || '-'} · MCP：{approval.mcpServer || '-'} · 审批 ID：
                <code style={MONO}>{approval.approvalId}</code>
              </span>
              <Space>
                <Button size="small" type="primary" onClick={() => approve.mutate('allow')}>
                  允许
                </Button>
                <Button size="small" danger onClick={() => approve.mutate('deny')}>
                  拒绝
                </Button>
              </Space>
            </Space>
          }
        />
      )}
    </Space>
  );
}

export function CustomCommandAuditsPanel({ name }: { name: string }) {
  const [phase, setPhase] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const query = useQuery({
    queryKey: ['res', 'custom-commands', 'audits', name, phase, page],
    queryFn: () =>
      listCustomCommandAudits({
        command: name,
        phase,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
    staleTime: 15_000,
  });

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Select
          allowClear
          size="small"
          placeholder="全部阶段"
          value={phase}
          onChange={value => {
            setPhase(value);
            setPage(1);
          }}
          style={{ width: 160 }}
          options={[
            { value: 'Succeeded', label: 'Succeeded' },
            { value: 'Failed', label: 'Failed' },
            { value: 'Denied', label: 'Denied' },
          ]}
        />
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
          刷新
        </Button>
      </Space>
      <Table
        size="small"
        rowKey={row => row.uid ?? `${row.createdAt}-${row.phase}`}
        loading={query.isLoading}
        dataSource={query.data?.items ?? []}
        locale={{ emptyText: '没有审计记录' }}
        pagination={{
          current: page,
          pageSize,
          total: query.data?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          {
            title: '时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 170,
            render: (value?: number) => formatDate(value ?? ''),
          },
          { title: '阶段', dataIndex: 'phase', key: 'phase', width: 100 },
          { title: '智能体', dataIndex: 'agent', key: 'agent', width: 140 },
          { title: '用户', dataIndex: 'userId', key: 'userId', width: 140 },
          {
            title: '耗时',
            dataIndex: 'durationMs',
            key: 'durationMs',
            width: 80,
            render: (v?: number) => (v ? `${v}ms` : '-'),
          },
          {
            title: '原因',
            dataIndex: 'reason',
            key: 'reason',
            ellipsis: true,
            render: (v?: string) => v || '-',
          },
        ]}
      />
    </div>
  );
}

// ─── 绑定预览 ────────────────────────────────────────────────────────────────

export function AgentBindingPreviewPanel({ record }: { record: Record<string, unknown> }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof previewAgentBinding>> | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const preview = useMutation({
    mutationFn: () =>
      previewAgentBinding({
        namespace: (record['namespace'] as string | undefined) ?? '',
        spec: (record['spec'] as Record<string, unknown> | undefined) ?? {},
      }),
    onSuccess: data => {
      setResult(data);
      setError(null);
    },
    onError: err => setError(err instanceof Error ? err.message : '预览失败'),
  });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        title="预览是 dry run"
        description="它回答「这条策略会选中哪些智能体、引用能解析出什么、缺了什么」，不写入任何对象。"
      />
      <Button type="primary" loading={preview.isPending} onClick={() => preview.mutate()}>
        运行预览
      </Button>
      {error && <Alert type="error" showIcon title="预览失败" description={error} />}
      {result && (
        <>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="匹配的智能体">
              {(result.matchedAgents ?? []).length > 0
                ? result.matchedAgents?.map(name => (
                    <Link
                      key={name}
                      to={`/agents/${encodeURIComponent(name)}`}
                      style={{ marginRight: 8 }}
                    >
                      <Tag color="blue">{name}</Tag>
                    </Link>
                  ))
                : '没有匹配到任何智能体'}
            </Descriptions.Item>
            {Object.entries(result.resolved ?? {}).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>
                {(value ?? []).length > 0
                  ? (value as string[]).map(item => <Tag key={item}>{item}</Tag>)
                  : '-'}
              </Descriptions.Item>
            ))}
            <Descriptions.Item label="缺失引用">
              {(result.missing ?? []).length > 0
                ? result.missing?.map(item => (
                    <Tag color="red" key={item}>
                      {item}
                    </Tag>
                  ))
                : '无'}
            </Descriptions.Item>
          </Descriptions>
        </>
      )}
    </Space>
  );
}

// ─── 模型测试 ────────────────────────────────────────────────────────────────

export function ModelTestAction({
  name,
  record,
}: {
  name: string;
  record: Record<string, unknown>;
}) {
  const { notification } = AntApp.useApp();

  // 结果放在页面右上角：操作列只有 170px 且不换行，任何内联文本都会向右溢出。
  const notifyFailure = (detail: string) => {
    notification.error({
      // 同一模型的重复测试替换上一条，而不是把通知越堆越高。
      key: `model-test-${name}`,
      title: '连接失败',
      description: (
        <Typography.Paragraph
          copyable={{ text: detail, tooltips: ['复制错误详情', '已复制'] }}
          style={{ margin: 0, wordBreak: 'break-word', color: 'inherit' }}
        >
          {detail}
        </Typography.Paragraph>
      ),
      duration: false,
      placement: 'topRight',
    });
  };

  const test = useMutation({
    mutationFn: () => testModel({ name, model: record as Record<string, unknown> }),
    onSuccess: data => {
      // `ok` 带 omitempty：失败时线上没有这个字段，必须按 === true 判成功。
      if (data.ok === true) {
        notification.success({
          key: `model-test-${name}`,
          title: '连接正常',
          description: `延迟 ${data.latencyMs ?? 0}ms`,
          duration: 3,
          placement: 'topRight',
        });
        return;
      }
      notifyFailure(data.message?.trim() || '上游未返回错误详情');
    },
    onError: error => {
      const detail =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : '请求失败，请稍后重试';
      notifyFailure(detail);
    },
  });

  return (
    <Button
      size="small"
      type="link"
      loading={test.isPending}
      onClick={() => test.mutate()}
      style={{ padding: 0 }}
    >
      测试连接
    </Button>
  );
}

export type { CustomCommandAudit };
