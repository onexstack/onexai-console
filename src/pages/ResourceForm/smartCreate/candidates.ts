import { useMemo } from 'react';

import type { SessionClaims } from '@/auth/claims';
import { useResourceRows } from '@/components/ResourceForm/options';

import { SMART_KINDS, type SmartCandidate, type SmartCatalog, type SmartKind } from './types';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function labelsText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}=${String(item)}`)
    .join(' ');
}

/** 停用（或命令关闭）的资源不进入推荐。 */
function isEnabled(kind: SmartKind, row: Record<string, unknown>): boolean {
  if (row.status === 'disabled') return false;
  if (kind === 'customCommands' && row.enabled === false) return false;
  return true;
}

/**
 * 模型多一层归属过滤。
 *
 * 运行时的 `resolveRequestedModel` 只允许「无归属」或「归属本人」的模型；管理员
 * 没有豁免。因此这里对所有人一致过滤，避免推荐一个到创建后运行必然 403 的端点。
 */
function modelUsable(row: Record<string, unknown>, claims: SessionClaims | null): boolean {
  if (row.hasAPIKey === false) return false;
  const owner = str(row.owner);
  if (!owner) return true;
  return owner === claims?.userId || owner === claims?.name;
}

function detailOf(kind: SmartKind, row: Record<string, unknown>): string {
  switch (kind) {
    case 'models': {
      const capabilities = Array.isArray(row.capabilities) ? row.capabilities.map(String) : [];
      return [str(row.provider), str(row.model), ...capabilities].filter(Boolean).join(' · ');
    }
    case 'knowledgeBases':
      return str(row.platform);
    case 'mcps': {
      const tools = Array.isArray(row.allowedTools) ? row.allowedTools.map(String) : [];
      return [str(row.protocol), tools.length > 0 ? tools.join(', ') : '']
        .filter(Boolean)
        .join(' · ');
    }
    case 'skills':
      return [str(row.provider), str(row.mode)].filter(Boolean).join(' · ');
    case 'customCommands': {
      const aliases = Array.isArray(row.aliases) ? row.aliases.map(String) : [];
      return [str(row.type), aliases.length > 0 ? aliases.join(', ') : '']
        .filter(Boolean)
        .join(' · ');
    }
    default:
      return '';
  }
}

/** 本地匹配使用的补充文本：描述之外的领域信号（工具名、契约、别名等）。 */
function extraOf(kind: SmartKind, row: Record<string, unknown>): string {
  switch (kind) {
    case 'models':
      return [
        str(row.provider),
        str(row.model),
        ...(Array.isArray(row.capabilities) ? row.capabilities.map(String) : []),
      ]
        .filter(Boolean)
        .join(' ');
    case 'knowledgeBases':
      return str(row.platform);
    case 'mcps':
      return [
        ...(Array.isArray(row.allowedTools) ? row.allowedTools.map(String) : []),
        ...(Array.isArray(row.requireApprovals) ? row.requireApprovals.map(String) : []),
        str(row.url),
      ]
        .filter(Boolean)
        .join(' ');
    case 'skills':
      return [str(row.contract), str(row.entrypoint), str(row.provider), str(row.mode)]
        .filter(Boolean)
        .join(' ');
    case 'customCommands':
      return [
        str(row.usage),
        str(row.type),
        ...(Array.isArray(row.aliases) ? row.aliases.map(String) : []),
      ]
        .filter(Boolean)
        .join(' ');
    default:
      return '';
  }
}

/**
 * 候选只保留目标空间的资源。
 *
 * 智能创建最终写进 Agent spec 的是裸名；跨空间同名资源若混进目录，按裸名去重
 * 时会互相遮蔽，确认后还会指向错误的对象。空 scope（目标空间未确定）时返回
 * 空目录，由页面先要求用户选业务空间。
 */
function inScope(row: Record<string, unknown>, scope: string): boolean {
  if (!scope) return false;
  const namespace = str(row.namespace);
  // 无 namespace 的集群级行保持可见（模型等由后端规则再兜底）。
  return namespace === '' || namespace === scope;
}

function toCandidates(
  kind: SmartKind,
  rows: Record<string, unknown>[],
  claims: SessionClaims | null,
  scope: string
): SmartCandidate[] {
  // 引用值是裸名字；目录已经限定到单一空间，不存在跨空间同名歧义。
  const seen = new Set<string>();
  return rows
    .filter(row => inScope(row, scope))
    .filter(row => isEnabled(kind, row))
    .filter(row => kind !== 'models' || modelUsable(row, claims))
    .flatMap((row): SmartCandidate[] => {
      const name = str(row.name) || str(row.secretId);
      if (!name || seen.has(name)) return [];
      seen.add(name);
      return [
        {
          kind,
          name,
          displayName: str(row.displayName) || name,
          description: str(row.description),
          namespace: str(row.namespace),
          owner: str(row.owner),
          labelsText: labelsText(row.labels),
          detail: detailOf(kind, row),
          extra: extraOf(kind, row),
        },
      ];
    });
}

export interface SmartCandidatesState {
  catalog: SmartCatalog;
  counts: Record<SmartKind, number>;
  /** 已存在的智能体名：用于新建前的重名校验。 */
  existingAgentNames: Set<string>;
  loading: boolean;
  /** 第一处加载失败；其余分组仍可用于推荐。 */
  error: string | null;
  refetch: () => void;
}

/**
 * 五类候选 + 智能体名查重。
 *
 * query key 与 `useResourceOptions` 完全一致（`['res', key, 'all']`），所以手动
 * 表单已经取过的资源在这里直接命中缓存；两者不会各自发一遍列表请求。
 */
export function useSmartCandidates(
  claims: SessionClaims | null,
  scope: string
): SmartCandidatesState {
  // Hooks must be called unconditionally and outside loops; the list is fixed.
  const knowledgeBases = useResourceRows('knowledge-bases');
  const mcps = useResourceRows('mcps');
  const skills = useResourceRows('skills');
  const customCommands = useResourceRows('custom-commands');
  const models = useResourceRows('models');
  const agents = useResourceRows('agents');

  const catalog = useMemo(
    () => ({
      knowledgeBases: toCandidates(
        'knowledgeBases',
        knowledgeBases.data ?? [],
        claims,
        scope
      ),
      mcps: toCandidates('mcps', mcps.data ?? [], claims, scope),
      skills: toCandidates('skills', skills.data ?? [], claims, scope),
      customCommands: toCandidates(
        'customCommands',
        customCommands.data ?? [],
        claims,
        scope
      ),
      models: toCandidates('models', models.data ?? [], claims, scope),
    }),
    [
      knowledgeBases.data,
      mcps.data,
      skills.data,
      customCommands.data,
      models.data,
      claims,
      scope,
    ]
  );

  const counts = useMemo(() => {
    const out = {} as Record<SmartKind, number>;
    for (const item of SMART_KINDS) out[item.kind] = catalog[item.kind].length;
    return out;
  }, [catalog]);

  const existingAgentNames = useMemo(
    () => new Set((agents.data ?? []).map(row => str(row.name)).filter(Boolean)),
    [agents.data]
  );

  const firstError =
    knowledgeBases.error ??
    mcps.error ??
    skills.error ??
    customCommands.error ??
    models.error ??
    agents.error;
  const queries = [knowledgeBases, mcps, skills, customCommands, models, agents];

  return {
    catalog,
    counts,
    existingAgentNames,
    loading: queries.some(query => query.isLoading),
    error: firstError instanceof Error ? firstError.message : firstError ? '候选加载失败' : null,
    refetch: () => {
      for (const query of queries) void query.refetch();
    },
  };
}
