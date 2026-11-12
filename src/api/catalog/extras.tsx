import type { ReactNode } from 'react';
import { App, Button, Popconfirm, Space, Tag } from 'antd';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TabsProps } from 'antd';

import {
  AgentBindingPreviewPanel,
  AgentEffectivePanel,
  AgentSessionCommandsPanel,
  AgentTemplateUsagePanel,
  CustomCommandAuditsPanel,
  CustomCommandInvokePanel,
  ModelTestAction,
  ScheduledExecutionsPanel,
} from '@/components/panels';
import { platformBinding, triggerScheduledRun } from '@/api/agent';
import { reembedMemory } from '@/api/memory';
import { A2ACardPanel, A2ASkillsPanel } from '@/components/panels/A2APanels';
import { A2ADebugPanel } from '@/components/panels/A2ADebugPanel';
import { A2AInvocationsPanel } from '@/components/panels/A2AInvocationsPanel';
import KnowledgeRetrievalTestPanel from '@/components/knowledge/KnowledgeRetrievalTestPanel';
import MemoryAuditPanel from '@/components/memory/MemoryAuditPanel';
import MemoryEntriesPanel from '@/components/memory/MemoryEntriesPanel';
import MemoryEvalPanel from '@/components/memory/MemoryEvalPanel';
import MemoryRetrievalTestPanel from '@/components/memory/MemoryRetrievalTestPanel';
import MemoryStatsPanel from '@/components/memory/MemoryStatsPanel';
import { WebhookTestAction } from '@/components/WebhookTestDrawer';
import { decodeClaims } from '@/auth/claims';
import { getToken } from '@/auth/tokenStore';
import { setNamespace } from '@/runtime';
import { buildDraftFromTemplate } from '@/pages/ResourceForm/smartCreate/templateDraft';

/**
 * 资源目录的「非字段」扩展：附加页签、详情操作、行操作。
 *
 * 页面只查这张表，不再写 `if (key === 'agents')`。新增资源时，纯展示部分留在
 * `resources.tsx` 的字段描述里；要发请求的部分放这里。
 */

interface DetailCtx {
  id: string;
  record: Record<string, unknown>;
  refresh: () => void;
}

interface ListCtx {
  id: string;
  record: Record<string, unknown>;
  refresh: () => void;
}

/** 详情页附加页签。 */
export function extraTabs(key: string, ctx: DetailCtx): NonNullable<TabsProps['items']> {
  switch (key) {
    case 'agents': {
      const agent = ctx.record as {
        kind?: string;
        execution?: { mode?: string };
      };
      const isA2A = agent.kind === 'external' || agent.execution?.mode === 'a2a';
      return [
        ...(isA2A
          ? [
              {
                key: 'a2a-card',
                label: 'AgentCard',
                children: <A2ACardPanel record={ctx.record} />,
              },
              {
                key: 'a2a-skills',
                label: '技能',
                children: <A2ASkillsPanel record={ctx.record} />,
              },
              {
                key: 'a2a-debug',
                label: '调试',
                children: <A2ADebugPanel name={ctx.id} />,
              },
              {
                key: 'a2a-invocations',
                label: '调用记录',
                children: <A2AInvocationsPanel name={ctx.id} />,
              },
            ]
          : []),
        {
          key: 'effective',
          label: '生效能力',
          children: <AgentEffectivePanel name={ctx.id} record={ctx.record} />,
        },
        {
          key: 'session-commands',
          label: '会话命令',
          children: <AgentSessionCommandsPanel name={ctx.id} record={ctx.record} />,
        },
      ];
    }
    case 'scheduled-runs':
      return [
        {
          key: 'executions',
          label: '执行记录',
          children: <ScheduledExecutionsPanel name={ctx.id} />,
        },
      ];
    case 'custom-commands':
      return [
        { key: 'invoke', label: '调用', children: <CustomCommandInvokePanel name={ctx.id} /> },
        { key: 'audits', label: '审计', children: <CustomCommandAuditsPanel name={ctx.id} /> },
      ];
    case 'agent-templates':
      return [
        {
          key: 'usage',
          label: '引用它的智能体',
          children: (
            <AgentTemplateUsagePanel
              name={ctx.id}
              namespace={
                typeof ctx.record.namespace === 'string' ? ctx.record.namespace : undefined
              }
            />
          ),
        },
      ];
    case 'agent-bindings':
      return [
        {
          key: 'preview',
          label: '预览',
          children: <AgentBindingPreviewPanel record={ctx.record} />,
        },
      ];
    case 'knowledge-bases':
      return [
        {
          key: 'retrieval-test',
          label: '召回测试',
          children: (
            <KnowledgeRetrievalTestPanel
              name={ctx.id}
              knowledgeBase={{
                platform: typeof ctx.record.platform === 'string' ? ctx.record.platform : undefined,
                topK: typeof ctx.record.topK === 'number' ? ctx.record.topK : undefined,
                scoreThreshold:
                  typeof ctx.record.scoreThreshold === 'number'
                    ? ctx.record.scoreThreshold
                    : undefined,
              }}
            />
          ),
        },
      ];
    case 'memories': {
      const admin = decodeClaims(getToken())?.isAdmin === true;
      return [
        {
          key: 'entries',
          label: '记忆条目',
          children: <MemoryEntriesPanel memory={ctx.id} record={ctx.record} />,
        },
        {
          key: 'retrieval',
          label: '检索测试',
          children: (
            <MemoryRetrievalTestPanel
              memory={ctx.id}
              sessionScoped={ctx.record.subjectMode === 'session'}
            />
          ),
        },
        {
          key: 'stats',
          label: '统计',
          children: (
            <MemoryStatsPanel
              memory={ctx.id}
              sessionScoped={ctx.record.subjectMode === 'session'}
            />
          ),
        },
        ...(admin
          ? [
              {
                key: 'eval',
                label: '评测',
                children: (
                  <MemoryEvalPanel
                    memory={ctx.id}
                    sessionScoped={ctx.record.subjectMode === 'session'}
                  />
                ),
              },
              {
                key: 'audit',
                label: '审计',
                children: <MemoryAuditPanel memory={ctx.id} />,
              },
            ]
          : []),
      ];
    }
    default:
      return [];
  }
}

/** 详情页操作条上的附加按钮。 */
export function extraActions(key: string, ctx: DetailCtx): ReactNode {
  if (key === 'agents') {
    // Platform and external agents are both chat targets now: an external one
    // is executed by its peer, a native one by the engine. The detail page is
    // where a person lands after registration, so the entry belongs here too.
    return (
      <Link to={`/chat?agent=${encodeURIComponent(ctx.id)}`}>
        <Button>对话</Button>
      </Link>
    );
  }
  if (key === 'memories') {
    const admin = decodeClaims(getToken())?.isAdmin === true;
    return admin ? <ReembedAction memory={ctx.id} /> : null;
  }
  if (key === 'webhooks') {
    return (
      <WebhookTestAction
        name={ctx.id}
        type={String(ctx.record.type ?? 'run')}
        namespace={typeof ctx.record.namespace === 'string' ? ctx.record.namespace : undefined}
        appearance="button"
      />
    );
  }
  if (key !== 'scheduled-runs') return null;
  return (
    <>
      <TriggerRunAction name={ctx.id} refresh={ctx.refresh} appearance="button" />
      <PauseResumeAction id={ctx.id} record={ctx.record} appearance="button" />
    </>
  );
}

/** Rebuilds stale embeddings in bounded batches. */
function ReembedAction({ memory }: { memory: string }) {
  const { message } = App.useApp();

  const check = useMutation({
    mutationFn: () => reembedMemory(memory, { dryRun: true, limit: 50 }),
    onSuccess: result => {
      message.info(`待重建 ${(result.scanned ?? 0) + (result.remaining ?? 0)} 条`);
    },
    onError: err => message.error(err instanceof Error ? err.message : '检查失败'),
  });

  const rebuild = useMutation({
    mutationFn: () => reembedMemory(memory, { limit: 50 }),
    onSuccess: result => {
      message.success(
        `已重建 ${result.updated ?? 0} 条，失败 ${result.failed ?? 0} 条，剩余 ${result.remaining ?? 0} 条`
      );
    },
    onError: err => message.error(err instanceof Error ? err.message : '重建失败'),
  });

  return (
    <Space>
      <Button size="small" loading={check.isPending} onClick={() => check.mutate()}>
        检查待重建
      </Button>
      <Popconfirm
        title="重建该记忆库的向量索引？"
        description="按当前 Embedding 模型分批重算，最多处理 50 条；可重复执行直到剩余为 0。"
        okText="开始"
        cancelText="取消"
        onConfirm={() => rebuild.mutate()}
      >
        <Button size="small" loading={rebuild.isPending}>
          重建索引
        </Button>
      </Popconfirm>
    </Space>
  );
}

/**
 * 「从模版创建智能体」。
 *
 * 模版是命名空间内的资源，智能体必须建在同一空间：表单不渲染 namespace 字段，
 * 提交时从页头的业务空间补齐，引用候选也按这个空间过滤。所以先把页头切到模版
 * 所在空间，再跳到新建页并预填对模版的引用（能力仍由控制器从模版合并）。
 *
 * 停用的模版不贡献行为，不作为入口。
 */
function CreateAgentFromTemplateAction({ template }: { template: Record<string, unknown> }) {
  const navigate = useNavigate();
  if (template.status === 'disabled') return null;

  const start = () => {
    const namespace = typeof template.namespace === 'string' ? template.namespace : '';
    if (namespace) setNamespace(namespace);
    navigate('/agents/new', { state: { draft: buildDraftFromTemplate(template) } });
  };

  return (
    <Button size="small" type="link" style={{ padding: 0 }} onClick={start}>
      创建智能体
    </Button>
  );
}

/**
 * 资源键 → 策略里的 resource_kind，用于列表行的「授权」入口。
 *
 * 这里只保留仍然需要行内授权入口的资源。模型、知识库、记忆库、Skill、MCP、
 * 提示词、自定义命令这类目录资源的授权统一走「策略」页面，列表行不再提供
 * 「授权」按钮，避免每行都挤一个跳转且语义重复的入口。
 */
const AUTHORIZABLE_KINDS: Record<string, string> = {
  agents: 'agent',
  namespaces: 'namespace',
  webhooks: 'webhook',
  'scheduled-runs': 'scheduledrun',
  'runtime-profiles': 'runtimeprofile',
  'sandbox-templates': 'sandboxtemplate',
};

/** 列表行上的附加操作。 */
export function rowActions(key: string, ctx: ListCtx): ReactNode {
  switch (key) {
    case 'agent-templates':
      return <CreateAgentFromTemplateAction template={ctx.record} />;
    case 'agents':
      return (
        <>
          <Link to={`/chat?agent=${encodeURIComponent(ctx.id)}`}>
            <Button size="small" type="link" style={{ padding: 0 }}>
              对话
            </Button>
          </Link>
          <AuthorizeAction
            kind={AUTHORIZABLE_KINDS[key]}
            name={ctx.id}
            namespace={typeof ctx.record.namespace === 'string' ? ctx.record.namespace : undefined}
          />
        </>
      );
    case 'oncall-groups':
      // 排班、代班、成员轮转都在组详情页；列表行给一个显式入口，
      // 不能只依赖「名称」列那个不显眼的链接。
      return (
        <Link to={`/oncall-groups/${encodeURIComponent(ctx.id)}`}>
          <Button size="small" type="link" style={{ padding: 0 }}>
            排班
          </Button>
        </Link>
      );
    case 'scheduled-runs':
      return (
        <>
          <TriggerRunAction name={ctx.id} refresh={ctx.refresh} />
          <PauseResumeAction id={ctx.id} record={ctx.record} />
          <AuthorizeAction
            kind={AUTHORIZABLE_KINDS[key]}
            name={ctx.id}
            namespace={typeof ctx.record.namespace === 'string' ? ctx.record.namespace : undefined}
          />
        </>
      );
    case 'models':
      return <ModelTestAction name={ctx.id} record={ctx.record} />;
    case 'webhooks':
      return (
        <>
          <WebhookTestAction
            name={ctx.id}
            type={String(ctx.record.type ?? 'run')}
            namespace={typeof ctx.record.namespace === 'string' ? ctx.record.namespace : undefined}
          />
          <AuthorizeAction
            kind={AUTHORIZABLE_KINDS[key]}
            name={ctx.id}
            namespace={typeof ctx.record.namespace === 'string' ? ctx.record.namespace : undefined}
          />
        </>
      );
    default: {
      const kind = AUTHORIZABLE_KINDS[key];
      return kind ? (
        <AuthorizeAction
          kind={kind}
          name={ctx.id}
          namespace={typeof ctx.record.namespace === 'string' ? ctx.record.namespace : undefined}
        />
      ) : null;
    }
  }
}

/**
 * 「授权」入口：跳转整页策略编辑器，并预填这个资源。
 *
 * 只预填资源，不预填主体：一条策略通常是“给谁这个资源”，主体必须由管理员
 * 有意识地选择，而不是从前一行沿袭。预填值放在 URL 里，刷新/分享都成立。
 */
function AuthorizeAction({
  kind,
  name,
  namespace,
}: {
  kind?: string;
  name: string;
  namespace?: string;
}) {
  const navigate = useNavigate();
  if (!kind) return null;
  // A namespaced resource is addressed canonically as `namespace/name`; a bare
  // name in a policy matches that object in *any* namespace, which is broader
  // than the row the operator clicked.
  const resourceName = namespace && kind !== 'namespace' ? `${namespace}/${name}` : name;
  const params = new URLSearchParams({ kind });
  params.append('name', resourceName);
  return (
    <Button
      size="small"
      type="link"
      style={{ padding: 0 }}
      onClick={() => navigate(`/policies/new?${params.toString()}`)}
    >
      授权
    </Button>
  );
}

/** 行操作里保持紧凑的文字按钮；详情页操作条用常规按钮。 */
type ActionAppearance = 'link' | 'button';

function appearanceProps(appearance: ActionAppearance) {
  return appearance === 'link'
    ? ({ size: 'small', type: 'link', style: { padding: 0 } } as const)
    : {};
}

function TriggerRunAction({
  name,
  refresh,
  appearance = 'link',
}: {
  name: string;
  refresh: () => void;
  appearance?: ActionAppearance;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => triggerScheduledRun(name),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({
        queryKey: ['res', 'scheduled-runs', name, 'executions'],
      });
    },
  });
  return (
    <Popconfirm
      title="立即运行这个定时任务？"
      description="它会真实执行智能体和工具，不只是演练。"
      onConfirm={() => mutation.mutate()}
    >
      <Button {...appearanceProps(appearance)} loading={mutation.isPending}>
        立即运行
      </Button>
    </Popconfirm>
  );
}

/**
 * 暂停 / 恢复定时任务。
 *
 * paused 与 status 必须一起提交：服务端的 suspend 是两者的或。整行写回时
 * 只改 paused 会把旧的 status=disabled 带回去，表现成「恢复后仍在暂停」。
 * 这里显式带上 status，缓存补丁也会同时更新列表上的状态 Tag。
 */
function PauseResumeAction({
  id,
  record,
  appearance = 'link',
}: {
  id: string;
  record: Record<string, unknown>;
  appearance?: ActionAppearance;
}) {
  const { message } = App.useApp();
  const paused = record.paused === true || record.status === 'disabled';
  const mutation = useMutation({
    mutationFn: async () => {
      const update = platformBinding('scheduled-runs').api.update;
      if (!update) throw new Error('这个定时任务不可写');
      await update(id, {
        paused: !paused,
        status: paused ? 'enabled' : 'disabled',
      });
    },
    onSuccess: () => {
      // Do not refetch here: the read side is an informer cache and a GET
      // right after the write can still return the old row. `saveOne` has
      // already patched the list/item caches and reconciles with the server
      // once the cache catches up.
      message.success(paused ? '已恢复定时任务' : '已暂停定时任务');
    },
    onError: error => message.error((error as Error).message),
  });
  return (
    <Button
      {...appearanceProps(appearance)}
      loading={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {paused ? '恢复' : '暂停'}
    </Button>
  );
}

/** 列表上用于提示「不可写」的只读徽标（少数资源用）。 */
export function ReadOnlyTag() {
  return <Tag bordered={false}>只读</Tag>;
}
