import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  fetchAllRows,
  listAuthzBackends,
  listNamespaces,
  resourceRowsQueryKey,
} from '@/api/resourceDefs';
import { sortNewestFirst } from '@/lib/list-order';
import {
  REFERENCE_GRANT_FROM_KIND,
  REFERENCE_GRANT_GROUP,
  SHAREABLE_GRANT_KINDS,
} from '@/lib/reference-grant';

/** 一个下拉候选。 */
export interface SelectOption {
  value: string;
  label: string;
  /**
   * 行上的说明文字，已折叠为单行。
   *
   * 默认不进入 `label`：引用类下拉只显示名字。需要「名称 + 描述」的控件
   * （如命令选择器）自行把它拼进 `label` 并单独渲染一列。
   */
  description?: string;
  disabled?: boolean;
  /**
   * 行上的附加标签（如 Webhook 订阅的事件）。
   *
   * 由字段描述符的 `refBadges` 生成；不进入 `label`，否则搜索/已选标签会把
   * 它当成名字的一部分。渲染方负责画成 `Tag`。
   */
  badges?: { label: string; color?: string }[];
}

interface OptionState {
  options: SelectOption[];
  loading: boolean;
}

/**
 * 候选加载。
 *
 * 引用类字段的候选来自对应资源的全量列表（列表页已经取过时直接命中
 * `['res', key, 'all']` 缓存）。接口失败只降级为空候选 —— 允许手输的字段
 * 仍然可用，表单不会因为一个候选接口挂掉而无法提交。
 */

/**
 * 一类资源的全量行。
 *
 * 表单候选与智能创建共用这个 query key：智能创建需要拿到原始行（描述、labels、
 * namespace）才能打分和过滤，而 `useResourceOptions` 只保留下拉需要的字段。
 * 两处共用同一份缓存，手动表单挂载过的资源在智能页不会重复请求。
 */
export function useResourceRows(resourceKey?: string) {
  const key = resourceKey ?? '';
  return useQuery({
    // 直接观察全量行缓存；queryFn 用 fetchAllRows 而不是 listAllRows。后者自己
    // fetch 同一个键，外层会等待属于自己的 promise（见 resourceRowsQueryKey）。
    queryKey: resourceRowsQueryKey(key),
    queryFn: () => fetchAllRows(key),
    enabled: Boolean(resourceKey),
    // 候选要跟着资源的增删走。refetchOnMount: 'always' 让每次打开选择器都拿一份
    // 服务端列表；创建后的乐观行由 resourceDefs 的 pendingCreates 合并进来，
    // 不会因为这次重取而消失。窗口聚焦刷新覆盖「另一个标签页新建」的情况。
    staleTime: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    // 列表候选失败重试一次即可；默认的多次退避会让「正在读取候选」停留过久。
    retry: 1,
  });
}

/**
 * 另一类资源的名称候选。
 *
 * `scopeNamespace` 是引用方所在空间：
 * - 本空间的资源可见，选择值保持裸名字；
 * - 其他空间的资源只有在目标空间的 `ReferenceGrant` 放行引用方时才可见，选择值是
 *   `空间/名称`，与 REST 契约一致；
 * - 行上没有 `namespace` 的集群级资源（如模型）保持可见。
 *
 * `scopeNamespace` 为空（集群级绑定的表单）时所有资源都可见，且一律用
 * `空间/名称`——集群级对象没有可以默认的空间。
 *
 * Agent 表单是例外：Agent spec 只允许本地引用（管理面会拒绝任何带 namespace 的
 * 引用），所以作用域为空时**不出候选**，避免把用户的选择静默写成跨空间引用；
 * 被 ReferenceGrant 放行的跨空间资源仍会列出，但标记为「需能力绑定」并禁用选择。
 *
 * 过滤在本地做，不进入 queryKey：同一资源、不同字段的候选共用一次请求。
 */
/**
 * Agent 可以经 ReferenceGrant 使用、但必须通过 AgentBinding 注入的目标资源。
 *
 * 与控制器 `grantWildcard` 覆盖的类型保持一致：Skill / MCPServer / KnowledgeBase /
 * Prompt / Memory。CustomCommand、AgentTemplate、Agent（delegates）、Model 仍然
 * 只能同空间引用。
 */
const SHAREABLE_REF_RESOURCES = new Set([
  'skills',
  'mcps',
  'knowledge-bases',
  'prompts',
  'memories',
  // A model is a capability like the others: a grant may open one endpoint to
  // another namespace's agents. The controller and the runtime enforce the same
  // table, so a cross-namespace model is either admitted everywhere or refused
  // everywhere.
  'models',
]);

/** 资源键 → 授权目标 kind。 */
export const TARGET_KIND_BY_RESOURCE: Record<string, string> = {
  skills: 'Skill',
  mcps: 'MCPServer',
  'knowledge-bases': 'KnowledgeBase',
  prompts: 'Prompt',
  memories: 'Memory',
  'custom-commands': 'CustomCommand',
  'agent-templates': 'AgentTemplate',
  models: 'Model',
};

/** 授权目标 kind → 资源键（上面的反向映射）：生成器按 kind 拉取名称候选。 */
export const TARGET_RESOURCE_BY_KIND: Record<string, string> = Object.fromEntries(
  Object.entries(TARGET_KIND_BY_RESOURCE).map(([resourceKey, kind]) => [kind, resourceKey])
);

/**
 * 生成器「目标类型」下拉的候选；顺序沿用上面的表，只保留可共享 kind，
 * 避免生成一条永远不生效的 grant。
 */
export const REFERENCE_GRANT_TARGET_KINDS = Object.entries(TARGET_KIND_BY_RESOURCE)
  .filter(([, kind]) => (SHAREABLE_GRANT_KINDS as readonly string[]).includes(kind))
  .map(([resourceKey, kind]) => ({ resourceKey, kind }));

/**
 * 跨空间候选是否被 ReferenceGrant 放行。
 *
 * grant 住在目标空间，from 是引用方空间（kind 固定为 Agent：最终使用能力的是
 * Agent，即使引用写在 Binding 上）。to.name 为空表示该 kind 的全部对象。
 */
function granted(
  grants: Record<string, unknown>[],
  referrerNamespace: string,
  targetNamespace: string,
  targetKind: string,
  targetName: string
): boolean {
  if (!targetKind) return false;
  return grants.some(grant => {
    if (String(grant.namespace ?? '') !== targetNamespace) return false;
    const from = Array.isArray(grant.from) ? grant.from : [];
    const to = Array.isArray(grant.to) ? grant.to : [];
    const fromMatches = from.some(item => {
      const record = item as Record<string, unknown>;
      // The runtime matches the group too. A grant with a misspelled or empty
      // group is persisted but never admits anything, so showing it as usable
      // would produce exactly the "UI says allowed, server says no" error.
      if (String(record.group ?? '') !== REFERENCE_GRANT_GROUP) return false;
      return (
        String(record.namespace ?? '') === referrerNamespace &&
        String(record.kind ?? '') === REFERENCE_GRANT_FROM_KIND
      );
    });
    if (!fromMatches) return false;
    return to.some(item => {
      const record = item as Record<string, unknown>;
      if (String(record.group ?? '') !== REFERENCE_GRANT_GROUP) return false;
      if (String(record.kind ?? '') !== targetKind) return false;
      const name = String(record.name ?? '');
      return name === '' || name === targetName;
    });
  });
}

export interface ResourceOptionsQuery {
  /** 候选来源的资源键（如 `webhooks`）。 */
  resourceKey?: string;
  /** 只保留返回 true 的行；已保存的值不受影响。 */
  refFilter?: (row: Record<string, unknown>) => boolean;
  /** 引用方所在命名空间，决定跨空间候选与 `空间/名称` 取值。 */
  scopeNamespace?: string;
  /** 排除自身（编辑时）。 */
  excludeName?: string;
  /** 引用方资源键（`agents` 等），决定是否需要 ReferenceGrant。 */
  referrerKey?: string;
  /** 候选行上的附加标签（如 Webhook 的订阅事件）。 */
  badgeOf?: (row: Record<string, unknown>) => SelectOption['badges'];
}

/** 纯函数版本的候选构建入参：把网络查询与规则拆开，便于单测。 */
export interface RefOptionRowsQuery {
  rows: Record<string, unknown>[];
  refFilter?: (row: Record<string, unknown>) => boolean;
  scopeNamespace?: string;
  excludeName?: string;
  referrerKey?: string;
  resourceKey?: string;
  grants?: Record<string, unknown>[];
  badgeOf?: (row: Record<string, unknown>) => SelectOption['badges'];
}

/**
 * 行 + ReferenceGrant 规则 → 下拉候选。
 *
 * 规则全部在这里，hook 只负责取数。特别是 Agent 表单：本空间可选；grant 放行的
 * 跨空间项可见但 `disabled`（必须由 AgentBinding 注入）；未授权的跨空间项不出现。
 */
export function refOptionsFromRows({
  rows,
  refFilter,
  scopeNamespace,
  excludeName,
  referrerKey,
  resourceKey,
  grants = [],
  badgeOf,
}: RefOptionRowsQuery): SelectOption[] {
  const agentRefs = referrerKey === 'agents';
  const scope = scopeNamespace ?? '';
  const targetKind = TARGET_KIND_BY_RESOURCE[resourceKey ?? ''] ?? '';
  const shareable = SHAREABLE_REF_RESOURCES.has(resourceKey ?? '');
  // 命令目录（chat-commands）是编译期注册的全局名单：`Command` 对象上的
  // namespace 只是 commandreg 把同一份目录发布到各命名空间的产物，不是命令
  // 身份的一部分。拼成 `空间/命令` 会让 spec.commands 里的名字匹配不上目录，
  // resolve 时被当成 orphan 静默丢弃（/help 因此看不到该命令），所以这里始终
  // 使用裸命令名，同名副本由下面的 seen 去重收敛为一条。
  const globalName = resourceKey === 'chat-commands';
  // 去重键是选择值：不同空间的同名资源是两个不同的引用。
  const seen = new Set<string>();

  // 与资源列表页同一口径：创建时间倒序、名称倒序兜底。上游 `fetchAll` 已经排过，
  // 这里再显式排一次，保证候选顺序只由这个 hook 决定，不会因为未来换读取路径
  // 而悄悄漂移。
  return sortNewestFirst(
    rows.filter(row => !refFilter || refFilter(row)),
    'name'
  )
    .filter(row => !excludeName || String(row.name ?? '') !== excludeName)
    .filter(row => {
      const raw = typeof row.namespace === 'string' ? row.namespace : '';
      // 命令目录是全局名单：每个命名空间里的副本是同一份目录，不是跨空间引用。
      if (globalName) return true;
      // 引用方空间未知时失败关闭：跨空间候选不能靠“全部空间”猜一个引用方。
      // Agent 的本地引用例外，它本来就没有跨空间候选。集群级绑定是管理员
      // 直授，没有引用方空间，但仍只允许可共享的 kind。
      if (!scope) {
        if (referrerKey === 'cluster-agent-bindings') return shareable;
        return !agentRefs && !referrerKey;
      }
      if (!raw || raw === scope) return true;
      if (agentRefs) {
        // Agent spec 只允许本地引用；跨空间资源只展示（见下方 disabled），需要
        // 用户到「能力绑定」里注入。
        return shareable && granted(grants, scope, raw, targetKind, String(row.name ?? ''));
      }
      // 不可共享的 kind（自定义命令、Webhook 等）留在引用方空间。
      if (!shareable) return false;
      // ClusterAgentBinding 是管理员直授，等价 cluster-admin。
      if (referrerKey === 'cluster-agent-bindings') return true;
      if (!referrerKey) return false;
      return granted(grants, scope, raw, targetKind, String(row.name ?? ''));
    })
    .flatMap((row): SelectOption[] => {
      const name = String(row.name ?? row.secretId ?? '');
      const rawNamespace = typeof row.namespace === 'string' ? row.namespace : '';
      const crossNamespace = !globalName && Boolean(rawNamespace) && rawNamespace !== scope;
      const value = crossNamespace ? `${rawNamespace}/${name}` : name;
      if (!name || seen.has(value)) return [];
      seen.add(value);
      // 显示名与名称相同（内置命令目录常见）时不再重复一遍。
      const displayName =
        typeof row.displayName === 'string' && row.displayName !== name ? row.displayName : '';
      const disabled = row.status === 'disabled' ? '（停用）' : '';
      // 描述折叠成单行：下拉只给它一行高度，多行会把候选撑高。
      const description =
        typeof row.description === 'string' ? row.description.replace(/\s+/g, ' ').trim() : '';
      const badges = badgeOf?.(row);
      const baseLabel = displayName
        ? `${value}（${displayName}）${disabled}`
        : `${value}${disabled}`;
      // Agent 表单里的跨空间项可见但不可选：它确实“可用”，只是必须由
      // AgentBinding 注入，写进 Agent spec 会被后端拒绝。
      if (agentRefs && crossNamespace) {
        return [
          {
            value,
            label: `${baseLabel}（跨空间 · 需能力绑定）`,
            description: '在「能力编排 → 能力绑定」中引用',
            disabled: true,
          },
        ];
      }
      return [
        {
          value,
          label: baseLabel,
          ...(description ? { description } : {}),
          ...(badges?.length ? { badges } : {}),
        },
      ];
    });
}

export function useResourceOptions({
  resourceKey,
  refFilter,
  scopeNamespace,
  excludeName,
  referrerKey,
  badgeOf,
}: ResourceOptionsQuery = {}): OptionState {
  const query = useResourceRows(resourceKey);
  const agentRefs = referrerKey === 'agents';
  const shareable = SHAREABLE_REF_RESOURCES.has(resourceKey ?? '');
  // 授权行用于判断跨空间候选是否放行。Agent 的可共享引用同样需要它；集群级
  // Binding 是管理员直授，不需要查 grant。
  const grantRows = useResourceRows(
    referrerKey && referrerKey !== 'cluster-agent-bindings' && (!agentRefs || shareable)
      ? 'reference-grants'
      : undefined
  ).data;

  return {
    options: refOptionsFromRows({
      rows: query.data ?? [],
      refFilter,
      scopeNamespace,
      excludeName,
      referrerKey,
      resourceKey,
      grants: (grantRows ?? []) as Record<string, unknown>[],
      badgeOf,
    }),
    loading: query.isLoading,
  };
}

/**
 * 命名空间候选。
 *
 * 默认只给业务空间：后端把 `default` / `kube-*` 这类系统空间过滤掉了。
 * `includeSystem` 用于引用授权 —— Agent 可以住在 `default`（OneX 内置 Agent
 * 就在那里），ReferenceGrant 的引用方需要能选到它；目标空间也可能指向 `default`
 * 里的资源。
 */
/** 命名空间目录的共享查询；候选与默认空间读同一份响应。 */
function useNamespaceCatalog() {
  return useQuery({
    queryKey: ['form-options', 'namespaces'],
    queryFn: listNamespaces,
    staleTime: 30_000,
    retry: false,
  });
}

export function useNamespaceOptions(options?: { includeSystem?: boolean }): OptionState {
  const query = useNamespaceCatalog();
  const names = query.data?.names ?? [];
  const merged =
    options?.includeSystem && !names.includes('default') ? ['default', ...names] : names;
  return {
    options: merged.map(name => ({ value: name, label: name })),
    loading: query.isLoading,
  };
}

/**
 * 部署默认空间。
 *
 * 无宿主调试台在“全部空间”下、以及任何未声明 namespace 的写入都回落到它。
 * 读后端而不是在前端复制常量：两个默认值一旦漂移，引用判定就会在两边给出
 * 不同答案。
 */
export function useDefaultNamespace(): string {
  return useNamespaceCatalog().data?.defaultNamespace ?? '';
}

/** 授权后端候选；`none` 是关闭 Agent 级授权的哨兵，后端不返回，这里补上。 */
export function useAuthzBackendOptions(): OptionState {
  const query = useQuery({
    queryKey: ['form-options', 'authz-backends'],
    queryFn: listAuthzBackends,
    staleTime: 30_000,
    retry: false,
  });
  const options: SelectOption[] = (query.data ?? []).map(name => ({ value: name, label: name }));
  if (!options.some(option => option.value === 'none')) {
    options.push({ value: 'none', label: 'none（关闭 Agent 级授权）' });
  }
  return { options, loading: query.isLoading };
}

/**
 * 授权后端多选的变化归一化。
 *
 * `none` 是「关闭 Agent 级授权」的哨兵，与具体后端互斥：同时存在时后端会把
 * `none` 当成未知后端跳过，于是用户以为关掉了授权，实际仍按其余后端校验 ——
 * 安全语义正好相反。所以新增 `none` 时清空其余，新增具体后端时移除 `none`。
 */
export function reconcileAuthzBackends(
  previous: readonly string[],
  next: readonly string[]
): string[] {
  const chosen = next.filter(Boolean);
  if (!chosen.includes('none') || previous.includes('none')) {
    return chosen.filter(value => value !== 'none');
  }
  return ['none'];
}

/**
 * 授权后端控件的占位文案。
 *
 * 默认值不是一个空选择而是「部署默认」，所以占位必须把实际生效的后端说出来，
 * 否则用户会以为留空 = 不鉴权。
 */
export function authzBackendsPlaceholder(options: SelectOption[], loading: boolean): string {
  if (loading) return '加载中…';
  const backends = options.map(option => option.value).filter(value => value !== 'none');
  if (backends.length === 0) return '部署未启用授权后端；留空即使用部署默认';
  const preview =
    backends.length <= 3
      ? backends.join(' / ')
      : `${backends.slice(0, 2).join(' / ')} 等 ${backends.length} 个`;
  return `留空使用部署默认（${preview}）`;
}

/**
 * 标签建议：从**当前资源类型**已有行的 labels 里汇总 `k=v`。
 *
 * 候选与列表页共用 `['res', key, 'all']` 全量行缓存：在 /models/new 上出现的是
 * models 上的历史标签，在 /agents/new 上出现的是 agents 上的。`resourceKey`
 * 为空（或资源没有 labels）时候选为空，查询也不会发出。
 *
 * 读取失败只降级为空候选：useQuery 不会抛错，表单仍可手输并提交。
 */
export function useLabelOptions(resourceKey?: string): OptionState {
  const query = useResourceRows(resourceKey);
  const options = useMemo(() => {
    const seen = new Set<string>();
    for (const row of query.data ?? []) {
      const labels = row.labels;
      if (!labels || typeof labels !== 'object' || Array.isArray(labels)) continue;
      for (const [key, value] of Object.entries(labels as Record<string, unknown>)) {
        seen.add(`${key}=${String(value)}`);
      }
    }
    return [...seen].sort().map(text => ({ value: text, label: text }));
  }, [query.data]);
  return { options, loading: query.isLoading };
}
