import {
  normalizeSubjectKind,
  resourcesOf,
  subjectsOf,
  type AuthorizationPolicy,
  type PolicyInput,
  type PolicySubject,
} from '@/api/policies';
import type { AccountUser, FeishuBinding } from '@/api/types';

/**
 * 权限视图的纯数据层。
 *
 * 策略的主体是「身份别名」而不是账号 ID：同一个人可能以账号 UUID、登录名、
 * 飞书 user_id、open_id 出现。这里只做「哪些策略命中某个主体」与「主体能看到
 * 哪些资源」的近似计算，供详情页展示；最终判定始终由服务端 OPA 完成。
 */

export type UserRow = AccountUser & { feishu?: FeishuBinding };

/** 一条策略与某个主体的命中关系。 */
export interface PolicyMatch {
  policy: AuthorizationPolicy;
  /** direct：直接点名；group：经由用户组；wildcard：所有主体。 */
  source: 'direct' | 'group' | 'wildcard';
  /** source=group 时命中的组名。 */
  via?: string;
}

export interface SubjectScope {
  /** 用户的全部身份别名（账号 ID、登录名、飞书 user_id、open_id）。 */
  aliases?: string[];
  /** 用户所在的用户组名。 */
  groupNames?: string[];
  /** 用户组主体自身。 */
  groupName?: string;
}

/** 用户可能出现在策略里的全部身份别名。 */
export function userAliasesOf(user: UserRow | null | undefined): string[] {
  if (!user) return [];
  const aliases = [user.id, user.username, user.feishu?.lark_user_id, user.feishu?.open_id];
  return [...new Set(aliases.filter((value): value is string => Boolean(value?.trim())))];
}

const SOURCE_RANK: Record<PolicyMatch['source'], number> = {
  direct: 3,
  group: 2,
  wildcard: 1,
};

/**
 * 找出命中某个主体的全部策略。
 *
 * 同一策略可能既直接点名又经由用户组命中；按策略名去重，保留更强的来源
 * （direct > group > wildcard）。
 */
export function matchPolicies(policies: AuthorizationPolicy[], scope: SubjectScope): PolicyMatch[] {
  const aliases = new Set(scope.aliases ?? []);
  const groups = new Set(
    [...(scope.groupNames ?? []), ...(scope.groupName ? [scope.groupName] : [])].filter(Boolean)
  );
  const byName = new Map<string, PolicyMatch>();

  const remember = (match: PolicyMatch) => {
    const current = byName.get(match.policy.name);
    if (!current || SOURCE_RANK[match.source] > SOURCE_RANK[current.source]) {
      byName.set(match.policy.name, match);
    }
  };

  for (const policy of policies) {
    for (const subject of subjectsOf(policy)) {
      const kind = normalizeSubjectKind(subject.kind);
      if (subject.name === '*') {
        remember({ policy, source: 'wildcard' });
        continue;
      }
      if (kind === 'User' && aliases.has(subject.name)) {
        remember({ policy, source: 'direct' });
        continue;
      }
      if (kind === 'Group' && groups.has(subject.name)) {
        remember({ policy, source: 'group', via: subject.name });
      }
    }
  }

  return [...byName.values()].sort((left, right) =>
    left.policy.name.localeCompare(right.policy.name)
  );
}

/** 读到的策略 → 可写回的完整输入；patch 只覆盖指定字段。 */
export function policyToInput(
  policy: AuthorizationPolicy,
  patch: Partial<PolicyInput> = {}
): PolicyInput {
  return {
    name: policy.name,
    subjects: policy.subjects?.length
      ? policy.subjects.map(subject => ({ ...subject }))
      : subjectsOf(policy),
    resources: policy.resources?.length
      ? policy.resources.map(resource => ({ ...resource, names: [...resource.names] }))
      : resourcesOf(policy),
    verbs: policy.verbs?.length ? [...policy.verbs] : ['read'],
    effect: policy.effect ?? 'allow',
    status: policy.status ?? 'enabled',
    description: policy.description ?? '',
    agentNames: policy.agentNames ?? [],
    resourceAttributes: policy.resourceAttributes ?? '',
    subjectNamespace: policy.subjectNamespace,
    ...patch,
  };
}

/** 把一个账号的全部别名追加为主体，按 kind/name 去重。 */
export function subjectsForUser(user: UserRow, existing: PolicySubject[]): PolicySubject[] {
  const out = existing.map(subject => ({ ...subject }));
  const seen = new Set(out.map(subject => `${normalizeSubjectKind(subject.kind)}/${subject.name}`));
  for (const alias of userAliasesOf(user)) {
    const key = `User/${alias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'User', name: alias });
  }
  return out;
}

/** 从主体列表里移除指定 kind 的一组名称。 */
export function removeSubjectNames(
  subjects: PolicySubject[],
  kind: string,
  names: Iterable<string>
): PolicySubject[] {
  const targetKind = normalizeSubjectKind(kind);
  const removed = new Set(names);
  return subjects.filter(subject => {
    if (normalizeSubjectKind(subject.kind) !== targetKind) return true;
    return !removed.has(subject.name);
  });
}

/** 「可操作资源」表的一行。 */
export interface UsableResourceRow {
  key: string;
  kind: string;
  /** 资源名；`*` 表示该类型的全部资源（含后续新增）。 */
  name: string;
  verbs: string[];
  /** 来源策略名，便于解释这条权限从哪来。 */
  sources: string[];
}

interface ResourceAccumulator {
  kind: string;
  name: string;
  verbs: Set<string>;
  sources: Set<string>;
}

function resourceKey(kind: string, name: string) {
  return `${kind}/${name}`;
}

/**
 * 由命中策略近似推导主体「可操作的资源」。
 *
 * - 只看启用中的策略；
 * - allow 的资源按 kind/name 合并动词；
 * - deny 命中同 kind/name 或同 kind 的 `*` 时，扣掉对应动词；
 * - `*` 资源单独成行，展示为「全部（含后续新增）」。
 *
 * 这不是最终判定：策略之间的优先级、命名空间继承、资源属性条件都由服务端
 * OPA 计算，这里只帮助管理员看清「大致授权了什么」。
 */
export function deriveUsableResources(matches: PolicyMatch[]): UsableResourceRow[] {
  const allowed = new Map<string, ResourceAccumulator>();
  const denied: { kind: string; names: Set<string>; verbs: Set<string> }[] = [];

  for (const { policy, source } of matches) {
    if (policy.status === 'disabled') continue;
    const verbs = policy.verbs?.length ? policy.verbs : ['read'];
    for (const resource of resourcesOf(policy)) {
      const names = resource.names.length ? resource.names : ['*'];
      if (policy.effect === 'deny') {
        denied.push({ kind: resource.kind, names: new Set(names), verbs: new Set(verbs) });
        continue;
      }
      for (const name of names) {
        const key = resourceKey(resource.kind, name);
        const current = allowed.get(key) ?? {
          kind: resource.kind,
          name,
          verbs: new Set<string>(),
          sources: new Set<string>(),
        };
        for (const verb of verbs) current.verbs.add(verb);
        current.sources.add(source === 'group' ? `${policy.name}（用户组）` : policy.name);
        allowed.set(key, current);
      }
    }
  }

  for (const deny of denied) {
    for (const entry of allowed.values()) {
      if (entry.kind !== deny.kind) continue;
      if (!deny.names.has('*') && !deny.names.has(entry.name)) continue;
      for (const verb of deny.verbs) entry.verbs.delete(verb);
    }
  }

  return [...allowed.values()]
    .filter(entry => entry.verbs.size > 0)
    .map(entry => ({
      key: resourceKey(entry.kind, entry.name),
      kind: entry.kind,
      name: entry.name,
      verbs: [...entry.verbs],
      sources: [...entry.sources],
    }))
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name)
        : left.kind.localeCompare(right.kind)
    );
}
