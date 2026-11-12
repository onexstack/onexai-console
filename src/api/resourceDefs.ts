import { queryClient } from './queryClient';
import { agentClient, chatClient, ApiError, request } from './client';
import { AGENT, CHAT } from './endpoints';
import { sortNewestFirst } from '@/lib/list-order';
import { applyPathPatch, readPath } from '@/lib/object-path';
import { SCENARIO_LABEL_KEY, isScenarioAgent } from '@/lib/scenario';
import type {
  AgentBindingPreview,
  ContextCustomCommand,
  ContextSkill,
  CustomCommandAudit,
  EffectiveAgent,
  McpTestResult,
  ModelTestResult,
  ScheduledExecution,
} from './types';

/**
 * 声明式资源的接线表。
 *
 * 页面只认 `ResourceDef`，不关心上游的列表键、包体键、分页参数和编码差异。
 * 19 类资源里 17 类在 agent 服务，2 类在 chat 服务；两类 chat 资源的形状与
 * 其余不同（裸数组、page/page_size、布尔是字符串），差异全部收在各自的
 * `decode`/`encode`/`listMode` 里。
 */

export type ResourceService = 'agent' | 'chat';

/**
 * 列表形状：
 * - `offset`：agent 资源与 chat 命令目录，`?offset&limit`，`limit=0` 为全量；
 * - `page`：工单，`?page&page_size`，服务端过滤；
 * - `bare`：值班组，直接返回数组。
 */
export type ListMode = 'offset' | 'page' | 'bare';

export interface ListParams {
  page: number;
  pageSize: number;
  filters?: Record<string, string[]>;
  search?: Record<string, string[]>;
}

/** 与非泛型部分分开，避免 `decode` 的逆变把 `ResourceDef<T>` 排除在公共函数之外。 */
export interface ResourceDefBase {
  /** 路由段，也是资源目录的键。 */
  key: string;
  service: ResourceService;
  base: string;
  /** 列表响应里的集合键。 */
  listKey: string;
  /** 单条响应里的资源键。 */
  itemKey: string;
  idKey: string;
  writable: boolean;
  listMode: ListMode;
  /**
   * 写-only 字段：请求要带，但绝不能补进本地缓存。
   *
   * 更新后的缓存补丁来自请求体；把明文令牌留在 React Query 的 row 里，会让它
   * 出现在任何读这一行的页面/调试工具里。
   */
  writeOnlyFields?: string[];
  /** 表单值 → 线上行。 */
  encode?: (body: Record<string, unknown>, mode: 'create' | 'update') => Record<string, unknown>;
  /** 服务端分页时把列筛选翻译成查询参数。 */
  extraParams?: (filters?: Record<string, string[]>) => Record<string, unknown>;
}

export interface ResourceDef<T = Record<string, unknown>> extends ResourceDefBase {
  /** 线上行 → 视图行。 */
  decode?: (row: Record<string, unknown>) => T;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const bool = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

/** 值班组的线上形态。 */
type OncallWire = Record<string, unknown> & {
  agents?: string;
  isSplitByBizLine?: string;
  generateWeeklyRpt?: string;
};

/**
 * 把线上布尔字符串解成 boolean；解不出来时保持 undefined。
 *
 * `agents` 线下是 JSON 数组，视图里只保留第一个：控制台每组的智能体是单选，
 * 历史多选值在打开表单时收敛为第一个（字段说明里会告诉用户保存后的结果）。
 */
function decodeOncall(row: OncallWire): Record<string, unknown> {
  let agent: string | undefined;
  if (typeof row.agents === 'string' && row.agents !== '') {
    try {
      const parsed: unknown = JSON.parse(row.agents);
      if (Array.isArray(parsed)) {
        agent = parsed.map(String).find(name => name !== '');
      }
    } catch {
      agent = undefined;
    }
  }
  return {
    ...row,
    agents: agent,
    isSplitByBizLine: bool(row.isSplitByBizLine),
    generateWeeklyRpt: bool(row.generateWeeklyRpt),
  };
}

/**
 * 视图里的单值收回线上的 JSON 数组；布尔字段仍写字符串。
 *
 * 数组是防御性的：表单旧缓存、直接调用 codec 的地方都可能传来数组。
 */
function encodeOncall(body: Record<string, unknown>): Record<string, unknown> {
  const { agents, ...rest } = body;
  const raw = Array.isArray(agents) ? agents.find(value => String(value) !== '') : agents;
  const agent = typeof raw === 'string' ? raw.trim() : '';
  return {
    ...rest,
    agents: JSON.stringify(agent ? [agent] : []),
    isSplitByBizLine: body.isSplitByBizLine === true ? 'true' : 'false',
    generateWeeklyRpt: body.generateWeeklyRpt === true ? 'true' : 'false',
  };
}

/**
 * 删掉 JSON 里的空值，但保留 `false` 与 `0`。
 *
 * 表单会为每个没填的字段写入 `undefined`，序列化后留下一层空对象；空的
 * LabelSelector 尤其危险——Kubernetes 把 `{}` 解释为「匹配全部资源」。所以空
 * 对象、空数组、空串都要删掉，而 `enabled: false`、`ttlDays: 0` 必须留下。
 */
function pruneEmpty(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(pruneEmpty).filter(item => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const pruned = pruneEmpty(item);
      if (pruned !== undefined) out[key] = pruned;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  if (value === undefined || value === null || value === '') return undefined;
  return value; // false、0、非空字符串
}

/** 智能体模版的 spec 在线上是 JSON 字符串；表单按嵌套对象编辑。 */
function decodeAgentTemplate(row: Record<string, unknown>): Record<string, unknown> {
  // 未来后端若改成结构化返回，直接使用，不重复解析。
  if (row.spec && typeof row.spec === 'object' && !Array.isArray(row.spec)) {
    return { ...row, spec: row.spec };
  }
  const raw = typeof row.spec === 'string' ? row.spec.trim() : '';
  if (!raw) return { ...row, spec: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...row, spec: {}, __specInvalid: raw };
    }
    return { ...row, spec: parsed };
  } catch {
    // 服务端写入前会校验 JSON；但历史/手工写入的脏数据不该让页面崩掉，也不该
    // 在保存时被静默清空——留下原文，由 encode 拒绝保存。
    return { ...row, spec: {}, __specInvalid: raw };
  }
}

/**
 * 表单值 → 线上 spec 字符串。
 *
 * 顶层 `status` 是界面上唯一的状态入口：后端在 `spec` 非空时忽略信封上的
 * status、只认 `spec.enabled`，所以这里必须把两者同步，否则列表/详情上的
 * 状态开关会看起来无效。
 */
function encodeAgentTemplate(body: Record<string, unknown>): Record<string, unknown> {
  const { spec, status, __specInvalid, ...rest } = body;
  if (__specInvalid !== undefined && __specInvalid !== '') {
    // 解析失败时表单是空的，直接保存会把整段 spec 清空；宁可报错让人去修。
    throw new Error('模版内容不是合法 JSON，无法通过表单保存；请先用 kubectl 修复该模版的 spec');
  }
  const parsed =
    spec && typeof spec === 'object' && !Array.isArray(spec)
      ? { ...(spec as Record<string, unknown>) }
      : {};

  if (status === 'enabled' || status === 'disabled') {
    parsed.enabled = status === 'enabled';
  } else if (parsed.enabled === undefined) {
    // 新建时状态开关未被动过（值为 undefined）：默认启用。
    parsed.enabled = true;
  }

  // 空对象是合法的 JSON Schema（表示「任意值」），不能被 prune 掉。
  const outputSchema = parsed.outputSchema;
  const cleaned = (pruneEmpty(parsed) ?? {}) as Record<string, unknown>;
  if (outputSchema !== undefined) cleaned.outputSchema = outputSchema;

  return { ...rest, spec: JSON.stringify(cleaned) };
}

/**
 * 清掉 spec 里空的 LabelSelector。
 *
 * selector 是结构体，表单把 matchExpressions 清空后会留下一个空对象；而
 * Kubernetes/控制器把 `{}` 解释为「匹配全部资源」，这是一个会把定向授权静默
 * 放大成全量授权的默认值。留空必须表示「没有选择器」，所以这里把整个键删掉。
 */
function pruneEmptySelector(spec: Record<string, unknown>, field: string): void {
  const selector = spec[field];
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(selector as Record<string, unknown>)) {
    // 表单清空时值是 undefined；空 matchExpressions / 空 matchLabels 与
    // 「没有选择器」等价。
    if (value === undefined) continue;
    if (key === 'matchExpressions' && Array.isArray(value) && value.length === 0) continue;
    if (
      key === 'matchLabels' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      continue;
    }
    cleaned[key] = value;
  }

  if (Object.keys(cleaned).length === 0) delete spec[field];
  else spec[field] = cleaned;
}

/**
 * `spec.commands` 里的名字必须与编译期命令目录里的裸名一致（`pod`、
 * `skill:<名字>`），命令名本身不可能包含 `/`。
 *
 * 历史版本的表单在集群级绑定里把 `Command` 对象所在的命名空间拼进了值
 * （`helper-public/pod`）：controller 把同一份目录发布到每个命名空间，副本上的
 * namespace 只是发布位置。带着前缀的名字在 resolve 时匹配不到目录，会被当成
 * orphan 静默丢弃，`/help` 因此看不到该命令。读取与写回都收敛成裸名，存量
 * 对象打开编辑页保存一次即修复。
 */
function normalizeCommandNames(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .map(String)
    .map(name => {
      const at = name.lastIndexOf('/');
      return at >= 0 ? name.slice(at + 1) : name;
    })
    .filter(name => name !== '');
}

/**
 * 智能体绑定的视图行：收敛历史命令名。
 *
 * 与提交体同一套规则（见 `normalizeCommandNames`），让详情页/编辑页看到的就是
 * 实际会生效的裸命令名。
 */
function decodeAgentBinding(row: Record<string, unknown>): Record<string, unknown> {
  const spec = row.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return row;

  const out = { ...(spec as Record<string, unknown>) };
  if (out.commands !== undefined) out.commands = normalizeCommandNames(out.commands);
  return { ...row, spec: out };
}

/**
 * 智能体绑定的提交体：清掉空的 selector（见 `pruneEmptySelector`）。
 *
 * 只处理 selector 与命令名：其余字段的空值语义由上游的零值规则决定，不在这里猜。
 */
function encodeAgentBinding(body: Record<string, unknown>): Record<string, unknown> {
  const spec = body.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return body;

  const out = { ...(spec as Record<string, unknown>) };
  if (out.commands !== undefined) out.commands = normalizeCommandNames(out.commands);
  pruneEmptySelector(out, 'selector');
  // 空命令选择器与「不按标签授予」等价；留下 `{}` 会被上游读成匹配全部命令。
  pruneEmptySelector(out, 'commandSelector');
  return { ...body, spec: out };
}

/** 智能体多选里的「全部」候选值，与表单控件使用的值一致。 */
const ALL_AGENTS = '*';

/** 表单值可能是 `'*'`，也可能已经被 `normalizeSubmit` 包成 `{name:'*'}`。 */
function isAllAgentsRef(value: unknown): boolean {
  if (typeof value === 'string') return value === ALL_AGENTS;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return (value as Record<string, unknown>).name === ALL_AGENTS;
  }
  return false;
}

/**
 * 平台能力编排（集群级）的提交体。
 *
 * `spec.agentSelector` 有两种空值语义，控件用智能体列表里的「全部智能体（*）」
 * 候选区分：
 * - 选中 `*`：显式提交 `{}`，表示目标命名空间内（含以后新建）的全部智能体；
 * - 未选 `*`：空的 matchLabels / matchExpressions 等价于没有选择器，整个删掉，
 *   避免上游把 `{}` 读成「全部」。
 */
function encodeClusterAgentBinding(body: Record<string, unknown>): Record<string, unknown> {
  const spec = body.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return body;

  const out = { ...(spec as Record<string, unknown>) };
  if (out.commands !== undefined) out.commands = normalizeCommandNames(out.commands);

  const agents = Array.isArray(out.agents) ? out.agents : [];
  const selectAllAgents = agents.some(isAllAgentsRef);
  const named = agents.filter(ref => !isAllAgentsRef(ref));

  if (selectAllAgents) {
    // `*` 覆盖点名列表；显式写空 selector 必须发生在 prune 之后。
    delete out.agents;
    out.agentSelector = {};
  } else {
    if (named.length > 0) out.agents = named;
    else delete out.agents;
    pruneEmptySelector(out, 'agentSelector');
  }
  // 命令选择器没有「匹配全部」这种合法含义，空值一律删掉。
  pruneEmptySelector(out, 'commandSelector');
  return { ...body, spec: out };
}

/**
 * 平台能力编排（集群级）的视图行：`agentSelector: {}` 还原成「全部智能体（*）」。
 *
 * 不这么做的话，打开编辑页再保存会把空选择器删掉，绑定要么校验失败，要么从
 * 「全部智能体」静默缩成「只授点到名的智能体」。
 */
function decodeClusterAgentBinding(row: Record<string, unknown>): Record<string, unknown> {
  const spec = row.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return row;

  const out = { ...(spec as Record<string, unknown>) };
  if (out.commands !== undefined) out.commands = normalizeCommandNames(out.commands);

  const selector = out.agentSelector;
  const selectAllAgents =
    selector !== undefined &&
    selector !== null &&
    typeof selector === 'object' &&
    !Array.isArray(selector) &&
    Object.keys(selector as Record<string, unknown>).length === 0;

  // 点名列表在「全部智能体」下是冗余的，视图里只保留 `*`，避免用户看到
  // 一个既选了全部、又列了几个名字的列表。
  if (selectAllAgents) out.agents = [ALL_AGENTS];
  return { ...row, spec: out };
}

/**
 * 定时任务的暂停只有一个口径：paused。
 *
 * 服务端从 paused 派生 status（CronJob 的 suspend），但 PUT 是整行覆盖，
 * 前端「读整行 → 合并 → 写回」会把当前的 status 一起带回。只改 paused 时，
 * 旧的 status=disabled 仍会让后端判定为 suspended，表现成「点恢复没反应」。
 * 因此所有写路径都在这里把两者同步，且不再提供独立的 status 开关。
 */
function encodeScheduledRun(body: Record<string, unknown>): Record<string, unknown> {
  const paused = body.paused === true;
  return { ...body, paused, status: paused ? 'disabled' : 'enabled' };
}

/**
 * 场景开关的 wire 映射。
 *
 * 「场景」不是后端字段，而是 Agent 标签 `onexai.io/scenario=true`。表单与
 * 详情页用 `scenario` 布尔值表达它；decode 从 labels 派生，encode 在写回前
 * 转回 labels 并把派生字段剥离——否则 Agent API 会收到一个它不认识的字段。
 */
function decodeAgent(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    scenario: isScenarioAgent(row as { labels?: Record<string, string> }),
  };
}

function encodeAgent(body: Record<string, unknown>): Record<string, unknown> {
  const { scenario, ...rest } = body;
  if (typeof scenario !== 'boolean') return rest;

  const rawLabels = rest.labels;
  const labels =
    rawLabels && typeof rawLabels === 'object' && !Array.isArray(rawLabels)
      ? { ...(rawLabels as Record<string, string>) }
      : {};
  if (scenario) labels[SCENARIO_LABEL_KEY] = 'true';
  else delete labels[SCENARIO_LABEL_KEY];

  return { ...rest, labels };
}

/** 17 类 agent 声明式资源。 */
export const AGENT_RESOURCE_DEFS: Record<string, ResourceDef> = {
  agents: {
    key: 'agents',
    service: 'agent',
    base: AGENT.agents,
    listKey: 'agents',
    itemKey: 'agent',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
    decode: decodeAgent,
    encode: encodeAgent,
  },
  'agent-templates': {
    key: 'agent-templates',
    service: 'agent',
    base: AGENT.agentTemplates,
    listKey: 'agentTemplates',
    itemKey: 'agentTemplate',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
    decode: decodeAgentTemplate,
    encode: encodeAgentTemplate,
  },
  'agent-bindings': {
    key: 'agent-bindings',
    service: 'agent',
    base: AGENT.agentBindings,
    listKey: 'agentBindings',
    itemKey: 'agentBinding',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
    decode: decodeAgentBinding,
    encode: encodeAgentBinding,
  },
  // 集群级：没有 namespace 列，受众是 spec.namespaces 里显式列出的租户。
  'cluster-agent-bindings': {
    key: 'cluster-agent-bindings',
    service: 'agent',
    base: AGENT.clusterAgentBindings,
    listKey: 'clusterAgentBindings',
    itemKey: 'clusterAgentBinding',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
    decode: decodeClusterAgentBinding,
    encode: encodeClusterAgentBinding,
  },
  'runtime-profiles': {
    key: 'runtime-profiles',
    service: 'agent',
    base: AGENT.runtimeProfiles,
    listKey: 'runtimeProfiles',
    itemKey: 'runtimeProfile',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  'runtime-hostings': {
    key: 'runtime-hostings',
    service: 'agent',
    base: AGENT.runtimeHostings,
    listKey: 'runtimeHostings',
    itemKey: 'runtimeHosting',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  'sandbox-templates': {
    key: 'sandbox-templates',
    service: 'agent',
    base: AGENT.sandboxTemplates,
    listKey: 'sandboxTemplates',
    itemKey: 'sandboxTemplate',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  'custom-commands': {
    key: 'custom-commands',
    service: 'agent',
    base: AGENT.customCommands,
    listKey: 'customCommands',
    itemKey: 'customCommand',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  webhooks: {
    key: 'webhooks',
    service: 'agent',
    base: AGENT.webhooks,
    listKey: 'webhooks',
    itemKey: 'webhook',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
    // 令牌只写给服务端，不补进本地缓存。
    writeOnlyFields: ['authToken'],
  },
  'scheduled-runs': {
    key: 'scheduled-runs',
    service: 'agent',
    base: AGENT.scheduledRuns,
    listKey: 'scheduledRuns',
    itemKey: 'scheduledRun',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
    encode: encodeScheduledRun,
  },
  skills: {
    key: 'skills',
    service: 'agent',
    base: AGENT.skills,
    listKey: 'skills',
    itemKey: 'skill',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  'reference-grants': {
    key: 'reference-grants',
    service: 'agent',
    base: AGENT.referenceGrants,
    listKey: 'referenceGrants',
    itemKey: 'referenceGrant',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  mcps: {
    key: 'mcps',
    service: 'agent',
    base: AGENT.mcps,
    listKey: 'mcps',
    itemKey: 'mcp',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  'knowledge-bases': {
    key: 'knowledge-bases',
    service: 'agent',
    base: AGENT.knowledgeBases,
    listKey: 'knowledgeBases',
    itemKey: 'knowledgeBase',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  memories: {
    key: 'memories',
    service: 'agent',
    base: AGENT.memories,
    listKey: 'memories',
    itemKey: 'memory',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  prompts: {
    key: 'prompts',
    service: 'agent',
    base: AGENT.prompts,
    listKey: 'prompts',
    itemKey: 'prompt',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  models: {
    key: 'models',
    service: 'agent',
    base: AGENT.models,
    listKey: 'models',
    itemKey: 'model',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  secrets: {
    key: 'secrets',
    service: 'agent',
    base: AGENT.secrets,
    listKey: 'secrets',
    itemKey: 'secret',
    idKey: 'secretId',
    writable: true,
    listMode: 'offset',
  },
  'authz-rules': {
    key: 'authz-rules',
    service: 'agent',
    base: AGENT.authzRules,
    listKey: 'authzRules',
    itemKey: 'authzRule',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
  // 命名空间 = 控制面 Namespace + 平台维护的展示信息。列表同时是各资源
  // 「命名空间」字段的候选来源。
  namespaces: {
    key: 'namespaces',
    service: 'agent',
    base: AGENT.namespaces,
    listKey: 'namespaces',
    itemKey: 'namespace',
    idKey: 'name',
    writable: true,
    listMode: 'offset',
  },
};

/** chat 的资源：两类可写资源，外加一个只读的命令目录。 */
export const CHAT_RESOURCE_DEFS: Record<string, ResourceDef> = {
  /**
   * 命令目录（只读投影，编译期注册，服务端由 commandreg 对账）。
   *
   * 只用于「智能体绑定 → 命令」的候选：它让内置命令（bind、skill:<名字> 等）
   * 和自定义命令出现在同一个选择器里。刻意不加入 `RESOURCE_SPECS`，所以不会
   * 生成列表页。
   */
  'chat-commands': {
    key: 'chat-commands',
    service: 'chat',
    base: CHAT.chatCommands,
    listKey: 'commands',
    itemKey: 'command',
    idKey: 'name',
    writable: false,
    listMode: 'offset',
  },
  'oncall-groups': {
    key: 'oncall-groups',
    service: 'chat',
    base: CHAT.oncallGroups,
    listKey: '',
    itemKey: '',
    idKey: 'name',
    writable: true,
    listMode: 'bare',
    decode: decodeOncall,
    encode: body => encodeOncall(body),
  },
  tickets: {
    key: 'tickets',
    service: 'chat',
    base: CHAT.tickets,
    listKey: 'tickets',
    itemKey: '',
    idKey: 'ticket_id',
    writable: false,
    listMode: 'page',
    extraParams: filters => {
      const first = (key: string) => filters?.[key]?.[0];
      return {
        status: first('status'),
        group_id: first('group_id'),
        assignee_id: first('assignee_id'),
      };
    },
  },
};

export const RESOURCE_DEFS: Record<string, ResourceDef> = {
  ...AGENT_RESOURCE_DEFS,
  ...CHAT_RESOURCE_DEFS,
};

export function getResourceDef(key: string): ResourceDef | undefined {
  return RESOURCE_DEFS[key];
}

// ─── 列表过滤（全量模式）────────────────────────────────────────────────────

function matchesFilters(row: Record<string, unknown>, filters?: Record<string, string[]>): boolean {
  if (!filters) return true;
  return Object.entries(filters).every(([key, values]) => {
    if (values.length === 0) return true;
    const actual = row[key];
    if (Array.isArray(actual)) return values.some(v => actual.map(String).includes(v));
    return values.includes(String(actual ?? ''));
  });
}

function matchesSearch(row: Record<string, unknown>, search?: Record<string, string[]>): boolean {
  if (!search) return true;
  return Object.entries(search).every(([key, values]) => {
    if (values.length === 0) return true;
    const actual = String(row[key] ?? '').toLowerCase();
    return values.some(v => actual.includes(v.toLowerCase()));
  });
}

// ─── 读取 ────────────────────────────────────────────────────────────────────

function clientOf(def: ResourceDefBase) {
  return def.service === 'agent' ? agentClient : chatClient;
}

/** 一次服务端全量读取，不合并本标签页里尚未确认的新行。 */
async function fetchAllServer<T>(def: ResourceDef<T>): Promise<T[]> {
  if (def.listMode === 'page') {
    // 工单没有「全量」模式：它必须服务端分页。
    throw new Error(`${def.key} 不支持全量读取`);
  }
  const data = await request<unknown>(clientOf(def), {
    url: def.base,
    method: 'GET',
    params: def.listMode === 'offset' ? { offset: 0, limit: 0 } : undefined,
  });
  if (Array.isArray(data)) return data.map(row => (def.decode ? def.decode(row) : row)) as T[];
  const envelope = data as Record<string, unknown>;
  const rows = (envelope[def.listKey] ?? []) as Record<string, unknown>[];
  return rows.map(row => (def.decode ? def.decode(row) : row)) as T[];
}

/**
 * 本标签页里刚创建、但服务端列表还没确认的行。
 *
 * 后端 List 读的是 informer（或 PG 投影），POST 成功只保证对象已写入控制面，
 * 不保证这次读取已经能看到它。旧实现创建后只 invalidate：紧接着的重取可能
 * 拿到不含新行的旧列表，再被 30 秒缓存住，于是「刚建的 MCP 不见了」。
 *
 * 这里把创建响应里的行先记下来，任何一次列表读取都把它并进去，直到后台对账
 * 在服务端列表里看到同一个 id。删除会取消对应条目，避免幽灵行。
 */
const pendingCreates = new Map<string, Map<string, Row>>();

function rememberPendingCreate<T>(def: ResourceDef<T>, id: string, row: T): void {
  let bucket = pendingCreates.get(def.key);
  if (!bucket) {
    bucket = new Map();
    pendingCreates.set(def.key, bucket);
  }
  bucket.set(id, row as unknown as Row);
}

function forgetPendingCreate(key: string, id: string): void {
  const bucket = pendingCreates.get(key);
  if (!bucket) return;
  bucket.delete(id);
  if (bucket.size === 0) pendingCreates.delete(key);
}

function mergePendingCreates<T>(def: ResourceDef<T>, rows: T[]): T[] {
  const bucket = pendingCreates.get(def.key);
  if (!bucket || bucket.size === 0) return rows;
  const present = new Set(rows.map(row => String((row as unknown as Row)[def.idKey])));
  const missing: T[] = [];
  for (const [id, row] of bucket) {
    if (!present.has(id)) missing.push(row as T);
  }
  return missing.length > 0 ? [...missing, ...rows] : rows;
}

/**
 * 一类资源的全量行，已按列表页口径排好序。
 *
 * 顺序是**数据层契约**：最新创建在前，创建时间相同或缺失时按 ID 倒序兜底
 * （见 `sortNewestFirst`）。列表页、表单候选、调试台组合共用这一条读取，
 * 不再各自决定顺序；需要分页的列表页直接切片即可。
 *
 * 排序放在合并 `pendingCreates` **之后**：本标签页刚建、服务端列表还没确认
 * 的行也要落在正确的位置，而不是永远堆在队首。
 */
async function fetchAll<T>(def: ResourceDef<T>): Promise<T[]> {
  return sortNewestFirst(mergePendingCreates(def, await fetchAllServer(def)), def.idKey);
}

const allQueryKey = (key: string) => ['res', key, 'all'] as const;

/**
 * 全量行在 React Query 里的缓存键。
 *
 * 要**观察**一份全量行时，把它交给 `useQuery`，`queryFn` 用
 * {@link fetchAllRows}：
 *
 * ```ts
 * useQuery({
 *   queryKey: resourceRowsQueryKey('agents'),
 *   queryFn: () => fetchAllRows('agents'),
 *   staleTime: 30_000,
 * });
 * ```
 *
 * **不要**在 `useQuery` 的 `queryFn` 里再调 {@link listAllRows} 且复用同一个键：
 * 内层的 `queryClient.fetchQuery` 看到这条查询已经在拉取，会把**外层自己的**
 * fetch promise 返回给外层 —— 外层在等自己，永远停在 loading（页面一直转圈、
 * 且不会发出任何请求）。
 */
export function resourceRowsQueryKey(key: string): ReturnType<typeof allQueryKey> {
  return allQueryKey(key);
}

/**
 * 读取一类资源的全量行，供 `useQuery` 的 `queryFn` 直接使用。
 *
 * 与 {@link listAllRows} 读同一份数据，区别只在于缓存归谁管：这一条由调用方的
 * 观察者负责缓存与失效，因此不会出现「同一键上的自等待」死锁。
 */
export async function fetchAllRows(key: string): Promise<Record<string, unknown>[]> {
  const def = RESOURCE_DEFS[key];
  if (!def) return [];
  return fetchAll(def);
}

/**
 * 读取一类资源的全量行，供下拉候选与其它**命令式**调用使用。
 *
 * 走的是 `['res', key, 'all']` 缓存：别处已经取过时这里不会重复请求，
 * 创建/删除后的失效也会同时作用到候选上。它自己就是一个请求，**只能**在
 * 组件渲染/事件回调里 await，不能拿来当观察同一键的 `useQuery` 的 `queryFn`
 * （见 {@link resourceRowsQueryKey} 的自等待说明）。
 */
export async function listAllRows(key: string): Promise<Record<string, unknown>[]> {
  const def = RESOURCE_DEFS[key];
  if (!def) return [];
  return queryClient.fetchQuery({
    queryKey: allQueryKey(key),
    queryFn: () => fetchAll(def),
    staleTime: 30_000,
  });
}

async function listAll<T>(
  def: ResourceDef<T>,
  params: ListParams
): Promise<{ total: number; items: T[] }> {
  const all = await queryClient.fetchQuery({
    queryKey: allQueryKey(def.key),
    queryFn: () => fetchAll(def),
    staleTime: 30_000,
  });
  // `fetchAll` 已经按列表页口径排好序；`filter` 保持原有顺序，直接切片即可。
  const filtered = all.filter(
    row =>
      matchesFilters(row as Record<string, unknown>, params.filters) &&
      matchesSearch(row as Record<string, unknown>, params.search)
  );
  const start = (params.page - 1) * params.pageSize;
  return { total: filtered.length, items: filtered.slice(start, start + params.pageSize) };
}

async function listPaged<T>(
  def: ResourceDef<T>,
  params: ListParams
): Promise<{ total: number; items: T[] }> {
  const data = await request<Record<string, unknown>>(clientOf(def), {
    url: def.base,
    method: 'GET',
    params: {
      page: params.page,
      page_size: params.pageSize,
      ...(def.extraParams?.(params.filters) ?? {}),
    },
  });
  const rows = (data[def.listKey] ?? []) as Record<string, unknown>[];
  return {
    total: Number(data.total ?? 0),
    items: rows.map(row => (def.decode ? def.decode(row) : row)) as T[],
  };
}

async function getOne<T>(def: ResourceDef<T>, id: string): Promise<T> {
  const data = await request<unknown>(clientOf(def), {
    url: `${def.base}/${encodeURIComponent(id)}`,
    method: 'GET',
  });
  if (def.listMode === 'bare' || !def.itemKey) {
    const row = data as Record<string, unknown>;
    return (def.decode ? def.decode(row) : row) as T;
  }
  const row = (data as Record<string, unknown>)[def.itemKey] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(200, 'EmptyEnvelope', `${def.itemKey} ${id} 的响应里没有资源体`);
  return (def.decode ? def.decode(row) : row) as T;
}

// ─── 写入 ────────────────────────────────────────────────────────────────────

function wrap(def: ResourceDefBase, body: Record<string, unknown>): Record<string, unknown> {
  return def.itemKey ? { [def.itemKey]: body } : body;
}

/**
 * 这些资源的写入会改变 Agent 的生效能力、会话命令或 MCP 工具：
 * 命令定义、绑定、Agent 自身、模板，以及 MCP Server。
 */
const AGENT_VIEW_AFFECTING = new Set([
  'agents',
  'agent-bindings',
  'cluster-agent-bindings',
  'custom-commands',
  'agent-templates',
  'mcps',
]);

/**
 * 标记 Agent 相关派生视图为脏。
 *
 * `['agent']` 前缀覆盖生效能力、context-commands、context-skills；
 * `['chat','commands']` 前缀覆盖会话命令目录与命令树。
 * 用 `refetchType: 'none'`：后端读接口走 informer 缓存，写后立即重取可能仍是旧值，
 * 交给下一次挂载、聚焦或 staleTime 到期时再取。
 */
export function invalidateAgentViews(key: string): void {
  if (!AGENT_VIEW_AFFECTING.has(key)) return;
  for (const queryKey of [['agent'], ['chat', 'commands']]) {
    void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
  }
}

function invalidate(key: string): void {
  void queryClient.invalidateQueries({ queryKey: ['res', key] });
  // 命名空间的增删改也要刷新各处「命名空间」下拉的候选缓存。
  if (key === 'namespaces') {
    void queryClient.invalidateQueries({ queryKey: ['form-options', 'namespaces'] });
  }
  invalidateAgentViews(key);
}

type Row = Record<string, unknown>;

/** 只保留真正提交的键：`undefined` 不是一次「改成空值」的写入。 */
function definedPatch(body: Record<string, unknown>, writeOnly?: string[]): Row {
  const patch: Row = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && !writeOnly?.includes(key)) patch[key] = value;
  }
  return patch;
}

/** 缓存里的视图值与请求里的视图值是否等价（容忍 `'true'` 与 `true`）。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return String(a) === String(b);
}

/**
 * 把 patch 合并进一行；值没变时返回原对象，避免无意义的重渲染。
 *
 * 比较与写入都走点路径：开关的 patch 键可能是 `spec.enabled`，按顶层键比较会
 * 永远判定「变了」，按顶层键写入则会把嵌套字段写成一行字面量键。
 */
function mergeCachedRow(prev: unknown, patch: Row): unknown {
  if (!prev || typeof prev !== 'object') return prev;
  const row = prev as Row;
  const changed = Object.entries(patch).some(
    ([key, value]) => !sameValue(readPath(row, key), value)
  );
  return changed ? applyPathPatch(row, patch) : row;
}

/**
 * 写成功后用请求里的新值修补两处缓存，不触发任何请求。
 *
 * 后端 Get/List 走 informer 缓存，写后立即重取可能还是旧值；先本地落地，
 * 再由 {@link reconcileAfterSave} 在后台把服务端的确认行写回来。
 *
 * 缓存不存在时跳过：凭空拼接一行只会让详情页缺字段。
 */
function patchResourceCaches<T>(def: ResourceDef<T>, originalId: string, patch: Row): void {
  if (Object.keys(patch).length === 0) return;

  const itemKey = ['res', def.key, 'item', originalId] as const;
  if (queryClient.getQueryData(itemKey) !== undefined) {
    queryClient.setQueryData<T>(itemKey, prev => mergeCachedRow(prev, patch) as T);
  }

  const allKey = allQueryKey(def.key);
  if (queryClient.getQueryData(allKey) !== undefined) {
    queryClient.setQueryData<T[]>(allKey, prev => {
      if (!Array.isArray(prev)) return prev;
      let changed = false;
      const next = prev.map(item => {
        // 按**原始 id** 匹配：就地改名时列表行的 id 即将变成新名字。
        if (String((item as unknown as Row)[def.idKey]) !== String(originalId)) return item;
        const merged = mergeCachedRow(item, patch) as T;
        if (merged !== item) changed = true;
        return merged;
      });
      return changed ? next : prev;
    });
  }
}

/** 对账确认后写入服务端的整行；列表里新旧 id 都匹配，兼容改名。 */
function writeConfirmedRow<T>(
  def: ResourceDef<T>,
  originalId: string,
  currentId: string,
  row: Row
): void {
  const itemKey = ['res', def.key, 'item', originalId] as const;
  if (queryClient.getQueryData(itemKey) !== undefined) {
    queryClient.setQueryData<T>(itemKey, row as T);
  }

  const allKey = allQueryKey(def.key);
  if (queryClient.getQueryData(allKey) !== undefined) {
    const ids = new Set([String(originalId), String(currentId)]);
    queryClient.setQueryData<T[]>(allKey, prev => {
      if (!Array.isArray(prev)) return prev;
      let changed = false;
      const next = prev.map(item => {
        if (!ids.has(String((item as unknown as Row)[def.idKey]))) return item;
        changed = true;
        return row as T;
      });
      return changed ? next : prev;
    });
  }
}

/** 同一资源的连续写入只让最后一轮对账生效，避免旧轮询把开关写回旧值。 */
const reconcileTokens = new Map<string, number>();
let reconcileSeq = 0;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 后台对账：写成功后轮询 GET，等服务端 informer 追上本次 patch 再写回确认行。
 *
 * 不 await、不弹错——开关的 loading 在 PUT 返回后结束，这里只负责收敛缓存。
 * 10 秒仍未追平就只把缓存标脏（`refetchType: 'none'`，不立即请求），下一次
 * 自然读取拿真相。
 */
function reconcileAfterSave<T>(
  def: ResourceDef<T>,
  originalId: string,
  currentId: string,
  patch: Row
): void {
  if (Object.keys(patch).length === 0) return;

  const tokenKey = `${def.key}:${originalId}`;
  const token = ++reconcileSeq;
  reconcileTokens.set(tokenKey, token);

  void (async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await sleep(1_000);
      if (reconcileTokens.get(tokenKey) !== token) return;
      let row: Row;
      try {
        row = (await getOne(def, currentId)) as Row;
      } catch {
        // 404/网络抖动：服务端可能还没追上，继续等到超时。
        continue;
      }
      if (reconcileTokens.get(tokenKey) !== token) return;
      if (!Object.entries(patch).every(([key, value]) => sameValue(readPath(row, key), value))) {
        continue;
      }
      writeConfirmedRow(def, originalId, currentId, row);
      reconcileTokens.delete(tokenKey);
      return;
    }

    if (reconcileTokens.get(tokenKey) === token) {
      reconcileTokens.delete(tokenKey);
      void queryClient.invalidateQueries({ queryKey: ['res', def.key], refetchType: 'none' });
    }
  })();
}

/** 把创建响应里的行写进全量列表与详情缓存；不存在全量缓存时不凭空造列表。 */
function insertCreatedRow<T>(def: ResourceDef<T>, id: string, row: T): void {
  const allKey = allQueryKey(def.key);
  if (queryClient.getQueryData(allKey) !== undefined) {
    queryClient.setQueryData<T[]>(allKey, prev => {
      if (!Array.isArray(prev)) return prev;
      return [row, ...prev.filter(item => String((item as unknown as Row)[def.idKey]) !== id)];
    });
  }
  queryClient.setQueryData<T>(['res', def.key, 'item', id], row);
}

/**
 * 创建后的后台对账：轮询服务端全量列表，直到出现这个 id。
 *
 * 与 {@link reconcileAfterSave} 的区别是对象不同——刚创建的行不在旧列表里，
 * 不是「字段还没追上」。轮询期间 {@link pendingCreates} 保证任何一次列表读取
 * 都包含它；确认后移除 pending 并写回服务端列表。超时只标脏、保留乐观行：
 * 创建已经返回 200，让它凭空消失比保留一个可能多活一会儿的行更糟。
 */
function reconcileAfterCreate<T>(def: ResourceDef<T>, id: string): void {
  const tokenKey = `${def.key}:${id}`;
  const token = ++reconcileSeq;
  reconcileTokens.set(tokenKey, token);

  void (async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await sleep(1_000);
      if (reconcileTokens.get(tokenKey) !== token) return;
      let rows: T[];
      try {
        rows = await fetchAllServer(def);
      } catch {
        continue;
      }
      if (reconcileTokens.get(tokenKey) !== token) return;
      const confirmed = rows.find(item => String((item as unknown as Row)[def.idKey]) === id);
      if (!confirmed) continue;

      forgetPendingCreate(def.key, id);
      // 同一资源可能还有另一个刚创建、也尚未确认的行：保留它。
      queryClient.setQueryData<T[]>(allQueryKey(def.key), mergePendingCreates(def, rows));
      queryClient.setQueryData<T>(['res', def.key, 'item', id], confirmed);
      reconcileTokens.delete(tokenKey);
      return;
    }

    if (reconcileTokens.get(tokenKey) === token) {
      reconcileTokens.delete(tokenKey);
      void queryClient.invalidateQueries({ queryKey: ['res', def.key], refetchType: 'none' });
    }
  })();
}

async function createOne<T>(def: ResourceDef<T>, body: Record<string, unknown>): Promise<T> {
  const payload = def.encode ? def.encode(body, 'create') : body;
  const data = await request<Record<string, unknown>>(clientOf(def), {
    url: def.base,
    method: 'POST',
    data: wrap(def, payload),
  });
  const row = (def.itemKey ? data[def.itemKey] : data) as Record<string, unknown> | undefined;
  const saved = (row ? (def.decode ? def.decode(row) : row) : payload) as T;

  // Page-mode resources have no full-list cache, so the generic invalidation is
  // all they get. Everything else gets the write-through treatment above.
  if (def.listMode !== 'page') {
    const id = String((saved as unknown as Row)[def.idKey] ?? '');
    if (id) {
      rememberPendingCreate(def, id, saved);
      insertCreatedRow(def, id, saved);
      reconcileAfterCreate(def, id);
    }
  }
  invalidate(def.key);
  return saved;
}

/**
 * 读整行 → 合并改动 → 整行写回。
 *
 * 上游的更新是整行覆盖（`Select("*").Updates`），请求里没提到的字段会被写成
 * 零值，而不是「保持不变」。只发改动会静默清空其余列，所以必须先读回整行。
 */
async function saveOne<T>(
  def: ResourceDef<T>,
  id: string,
  body: Record<string, unknown>
): Promise<T> {
  const current = (await getOne(def, id)) as Record<string, unknown>;
  // 点路径键（列表/详情的单字段开关）落到嵌套字段；其余键仍是顶层覆盖，
  // 表单全量保存的语义不变。
  const merged = applyPathPatch(current, body);
  const payload = def.encode ? def.encode(merged, 'update') : merged;
  const data = await request<Record<string, unknown>>(clientOf(def), {
    url: `${def.base}/${encodeURIComponent(id)}`,
    method: 'PUT',
    data: wrap(def, payload),
  });

  // 不能在这里 invalidate：后端读接口走 informer 缓存，写后立即重取可能仍是
  // 旧值，会把刚切过去的开关打回来。先按请求值修补缓存，由后台对账收敛。
  const patch = definedPatch(body, def.writeOnlyFields);
  patchResourceCaches(def, id, patch);
  invalidateAgentViews(def.key);

  if (def.key === 'namespaces') {
    void queryClient.invalidateQueries({ queryKey: ['form-options', 'namespaces'] });
  }

  const row = (def.itemKey ? data[def.itemKey] : data) as Record<string, unknown> | undefined;
  const saved = row ? ((def.decode ? def.decode(row) : row) as Record<string, unknown>) : undefined;
  // 就地改名时，轮询要用响应里的新名字去 GET。
  const currentId = String(saved?.[def.idKey] ?? id);
  reconcileAfterSave(def, id, currentId, patch);

  // PUT 响应盖在 patch 之下：即使服务端回显了旧值，也不能覆盖本次写入。
  // patch 里的点路径键同样要落到嵌套字段，不能作为字面量键留在返回行上。
  return applyPathPatch((saved ?? current) as Record<string, unknown>, patch) as T;
}

async function removeOne(def: ResourceDefBase, id: string): Promise<void> {
  await request<void>(clientOf(def), {
    url: `${def.base}/${encodeURIComponent(id)}`,
    method: 'DELETE',
  });
  // A create reconcile still polling for this id must not resurrect the row
  // after the delete succeeded.
  reconcileTokens.delete(`${def.key}:${id}`);
  forgetPendingCreate(def.key, id);
  invalidate(def.key);
  queryClient.removeQueries({ queryKey: ['res', def.key, 'item', id] });
}

/** 交给 `ResourcePage` / 详情页的读接口。 */
export function resourceApi<T = Record<string, unknown>>(def: ResourceDef<T>) {
  return {
    list: (params: ListParams) =>
      def.listMode === 'page' ? listPaged(def, params) : listAll(def, params),
    get: (id: string) => getOne(def, id),
    ...(def.writable
      ? {
          // 列表内的状态开关走这里：`saveOne` 会先读回整行再合并，未提到的字段
          // 不会被整行覆盖成零值。只接受顶层字段的 patch（见 switchField 注释）。
          update: async (id: string, patch: Record<string, unknown> = {}) => {
            await saveOne(def, id, patch);
          },
          remove: (id: string) => removeOne(def, id),
          removeBatch: async (ids: string[]) => {
            const results = await Promise.allSettled(ids.map(id => removeOne(def, id)));
            const failed = results.find(r => r.status === 'rejected');
            if (failed) throw (failed as PromiseRejectedResult).reason;
          },
        }
      : {}),
  };
}

/** 交给表单的写接口。 */
export function resourceWriter<T = Record<string, unknown>>(def: ResourceDef<T>) {
  return {
    writable: def.writable,
    create: (body: Record<string, unknown>) => createOne(def, body),
    save: (id: string, body: Record<string, unknown>) => saveOne(def, id, body),
  };
}

// ─── 子资源与动作（浏览器 Bearer 可达）──────────────────────────────────────

export async function getEffectiveAgent(name: string): Promise<EffectiveAgent> {
  return request<EffectiveAgent>(agentClient, {
    url: agentSubResource('effective', name),
    method: 'GET',
  });
}

function agentSubResource(kind: 'effective' | 'contextSkills' | 'contextCommands', name: string) {
  const encoded = encodeURIComponent(name);
  switch (kind) {
    case 'effective':
      return `${AGENT.agents}/${encoded}/effective`;
    case 'contextSkills':
      return `${AGENT.agents}/${encoded}/context-skills`;
    case 'contextCommands':
      return `${AGENT.agents}/${encoded}/context-commands`;
  }
}

export async function listContextSkills(name: string): Promise<ContextSkill[]> {
  const data = await request<{ skills?: ContextSkill[] }>(agentClient, {
    url: agentSubResource('contextSkills', name),
    method: 'GET',
  });
  return data.skills ?? [];
}

export async function listContextCommands(name: string): Promise<ContextCustomCommand[]> {
  const data = await request<{ customCommands?: ContextCustomCommand[] }>(agentClient, {
    url: agentSubResource('contextCommands', name),
    method: 'GET',
  });
  return data.customCommands ?? [];
}

export async function previewAgentBinding(body: {
  namespace?: string;
  spec: Record<string, unknown>;
}): Promise<AgentBindingPreview> {
  return request<AgentBindingPreview>(agentClient, {
    url: AGENT.agentBindingPreview,
    method: 'POST',
    data: body,
  });
}

export async function testModel(body: {
  name?: string;
  model?: Record<string, unknown>;
}): Promise<ModelTestResult> {
  return request<ModelTestResult>(agentClient, {
    url: AGENT.modelTest,
    method: 'POST',
    data: body,
  });
}

/**
 * 取回一个模型的 API Key 明文。
 *
 * 只有归属人或管理员会拿到它；服务端返回空串是真实答案（没有存储密钥，
 * 或当前部署还原不出明文），不是「还没取到」——页面要把它画成「不可查看」。
 * 这是一个按需接口：Get / List 永远不带明文，避免一次列表加载把整页密钥带进内存。
 */
export async function revealModelAPIKey(name: string): Promise<string> {
  const data = await request<{ api_key?: string }>(agentClient, {
    url: AGENT.modelApiKey(name),
    method: 'GET',
  });
  const value = data.api_key ?? '';
  // `enc:v1:` 是服务端的存储密文，不是可用的明文。正常部署下 Reveal 已经解密；
  // 这里兜底，避免旧版/异常响应把密文当成密钥画到页面上。
  return value.startsWith('enc:v1:') ? '' : value;
}

/**
 * 取回服务凭据的 Secret Key 明文（管理员）。
 *
 * 与模型一样，空串是服务端的真实答案：该凭据没有存密钥。
 */
export async function revealSecretKey(secretId: string): Promise<string> {
  const data = await request<{ secret_key?: string }>(agentClient, {
    url: AGENT.secretReveal(secretId),
    method: 'GET',
  });
  return data.secret_key ?? '';
}

/**
 * 测试一个尚未落库的 MCP server：拨号、列出工具、断开。
 *
 * 请求体就是表单当前值（`MCP` 形状），后端不会持久化。和模型测试一样，
 * `ok=false` 是 200 响应，代表端点不可达而不是接口坏了。
 */
export async function testMcp(body: { mcp: Record<string, unknown> }): Promise<McpTestResult> {
  return request<McpTestResult>(agentClient, {
    url: AGENT.mcpTest,
    method: 'POST',
    data: body,
  });
}

export async function listScheduledExecutions(
  name: string,
  limit = 20
): Promise<ScheduledExecution[]> {
  const data = await request<{ executions?: ScheduledExecution[] }>(agentClient, {
    url: `${AGENT.scheduledRuns}/${encodeURIComponent(name)}/executions`,
    method: 'GET',
    params: { limit },
  });
  return data.executions ?? [];
}

export async function triggerScheduledRun(name: string): Promise<ScheduledExecution> {
  const data = await request<{ execution?: ScheduledExecution }>(agentClient, {
    url: `${AGENT.scheduledRuns}/${encodeURIComponent(name)}/trigger`,
    method: 'POST',
    data: {},
  });
  void queryClient.invalidateQueries({ queryKey: ['res', 'scheduled-runs'] });
  return data.execution ?? (data as unknown as ScheduledExecution);
}

export async function cancelScheduledExecution(name: string, id: string): Promise<void> {
  await request<void>(agentClient, {
    url: `${AGENT.scheduledRuns}/${encodeURIComponent(name)}/executions/${encodeURIComponent(id)}/cancel`,
    method: 'POST',
    data: {},
  });
  void queryClient.invalidateQueries({ queryKey: ['res', 'scheduled-runs', name, 'executions'] });
}

export async function listCustomCommandAudits(query: {
  command?: string;
  agent?: string;
  userId?: string;
  phase?: string;
  offset?: number;
  limit?: number;
}): Promise<{ total: number; items: CustomCommandAudit[] }> {
  const data = await request<{ audits?: CustomCommandAudit[]; count?: number }>(agentClient, {
    url: AGENT.customCommandAudits,
    method: 'GET',
    params: query,
  });
  return { total: data.count ?? 0, items: data.audits ?? [] };
}

export async function invokeCustomCommand(
  name: string,
  body: Record<string, unknown>
): Promise<unknown> {
  return request(agentClient, {
    url: `${AGENT.customCommands}/${encodeURIComponent(name)}/invoke`,
    method: 'POST',
    data: body,
  });
}

export async function approveCustomCommand(
  name: string,
  body: { approvalId: string; decision: 'allow' | 'deny'; agent?: string }
): Promise<unknown> {
  return request(agentClient, {
    url: `${AGENT.customCommands}/${encodeURIComponent(name)}/approve`,
    method: 'POST',
    data: body,
  });
}

/** 命名空间目录：候选列表与部署默认空间。 */
export interface NamespaceCatalog {
  names: string[];
  /**
   * 部署默认空间：不带 namespace 的资源落到这里，无引用方运行也按它判定。
   * 由后端返回，控制台不再硬编码某个业务线名字。
   */
  defaultNamespace: string;
}

/** 命名空间候选：控制面的 Kubernetes Namespace。 */
export async function listNamespaces(): Promise<NamespaceCatalog> {
  // 命名空间接口返回的是行对象；也接受裸字符串，兼容只关心名字的旧实现。
  type Wire = string | { name?: string };
  const data = await request<{ namespaces?: Wire[]; defaultNamespace?: string }>(agentClient, {
    url: AGENT.namespaces,
    method: 'GET',
    params: { offset: 0, limit: 0 },
  });
  return {
    names: (data.namespaces ?? [])
      .map(item => (typeof item === 'string' ? item : (item.name ?? '')))
      .filter(Boolean),
    defaultNamespace: data.defaultNamespace ?? '',
  };
}

/**
 * Agent.authzBackends 可引用的已启用授权后端。
 *
 * 响应里不含 `none`：它是 Agent 级关闭授权的哨兵值，由界面单独补成选项。
 */
export async function listAuthzBackends(): Promise<string[]> {
  const data = await request<{ backends?: string[] }>(agentClient, {
    url: AGENT.authzBackends,
    method: 'GET',
  });
  return data.backends ?? [];
}

/** 供界面判断「服务端是否真的给了这个字段」。 */
export const fieldIsString = str;
