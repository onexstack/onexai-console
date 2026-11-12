import { agentClient, request } from './client';
import { AGENT } from './endpoints';

/**
 * 授权策略（AuthorizationRule）。
 *
 * 后端同时支持两种书写形状：旧的单主体/单资源字段（subjectType/subjectIds、
 * resourceKind/resourceNames）和新的复数形状（subjects[]、resources[]）。读取
 * 时统一归一化到复数形状；写入时，如果策略恰好能表达成单形状，就同时写旧字段，
 * 兼容仍在读旧字段的客户端和规则源。
 */
export interface PolicySubject {
  kind: string;
  name: string;
  namespace?: string;
}

export interface PolicyResource {
  kind: string;
  names: string[];
}

export interface AuthorizationPolicy {
  name: string;
  subjectType?: string;
  subjectIds?: string[];
  resourceKind?: string;
  resourceNames?: string[];
  resourceAttributes?: string;
  agentNames?: string[];
  verbs: string[];
  effect: 'allow' | 'deny';
  status: 'enabled' | 'disabled';
  description?: string;
  owner?: string;
  createdAt?: number;
  updatedAt?: number;
  subjectNamespace?: string;
  subjects?: PolicySubject[];
  resources?: PolicyResource[];
}

export interface PolicyInput {
  name: string;
  subjects: PolicySubject[];
  resources: PolicyResource[];
  verbs: string[];
  effect: 'allow' | 'deny';
  status: 'enabled' | 'disabled';
  description?: string;
  agentNames?: string[];
  resourceAttributes?: string;
  subjectNamespace?: string;
}

export interface PolicyListParams {
  offset?: number;
  limit?: number;
  subjectId?: string;
  subjectType?: string;
  resourceKind?: string;
  resourceName?: string;
  effect?: string;
  enabled?: string;
}

export interface PolicyListResult {
  total: number;
  items: AuthorizationPolicy[];
}

const SUBJECT_KIND_ALIASES: Record<string, string> = {
  user: 'User',
  group: 'Group',
  serviceaccount: 'ServiceAccount',
  namespace: 'namespace',
  '*': '*',
};

/** 主体的规范 kind（展示与写入都用它）。 */
export function normalizeSubjectKind(kind: string): string {
  return SUBJECT_KIND_ALIASES[kind.trim().toLowerCase()] ?? kind.trim();
}

/** 旧字段 → 复数主体。 */
export function subjectsOf(policy: AuthorizationPolicy): PolicySubject[] {
  if (policy.subjects?.length) {
    return policy.subjects.map(subject => ({ ...subject }));
  }
  if (policy.subjectNamespace) {
    return [{ kind: 'namespace', name: policy.subjectNamespace }];
  }
  const kind = normalizeSubjectKind(policy.subjectType ?? '');
  if (!kind) return [];
  return (policy.subjectIds ?? []).map(name => ({ kind, name }));
}

/** 旧字段 → 复数资源。 */
export function resourcesOf(policy: AuthorizationPolicy): PolicyResource[] {
  if (policy.resources?.length) {
    return policy.resources.map(resource => ({ ...resource, names: [...resource.names] }));
  }
  if (!policy.resourceKind) return [];
  return [{ kind: policy.resourceKind, names: [...(policy.resourceNames ?? [])] }];
}

/** 读接口返回的统一视图。 */
export function normalizePolicy(policy: AuthorizationPolicy): AuthorizationPolicy {
  return { ...policy, subjects: subjectsOf(policy), resources: resourcesOf(policy) };
}

/** 写入体：复数形状 + 能表达时双写旧字段。 */
export function policyPayload(input: PolicyInput): Record<string, unknown> {
  const subjects = input.subjects.map(subject => ({
    kind: normalizeSubjectKind(subject.kind),
    name: subject.name.trim(),
    ...(subject.namespace ? { namespace: subject.namespace } : {}),
  }));
  const resources = input.resources.map(resource => ({
    kind: resource.kind,
    names: resource.names.filter(Boolean),
  }));

  const payload: Record<string, unknown> = {
    name: input.name,
    subjects,
    resources,
    verbs: input.verbs,
    effect: input.effect,
    status: input.status,
    description: input.description ?? '',
    ...(input.agentNames?.length ? { agentNames: input.agentNames } : {}),
    ...(input.resourceAttributes?.trim()
      ? { resourceAttributes: input.resourceAttributes.trim() }
      : {}),
    ...(input.subjectNamespace ? { subjectNamespace: input.subjectNamespace } : {}),
  };

  // 单主体类型 → 双写 subjectType/subjectIds。
  const kinds = new Set(subjects.map(subject => subject.kind));
  if (kinds.size === 1 && !input.subjectNamespace) {
    payload.subjectType = [...kinds][0];
    payload.subjectIds = subjects.map(subject => subject.name);
  }
  // 单资源 → 双写 resourceKind/resourceNames。
  const only = resources.length === 1 ? resources[0] : undefined;
  if (only) {
    payload.resourceKind = only.kind;
    payload.resourceNames = only.names;
  }
  return payload;
}

export async function listPolicies(params: PolicyListParams = {}): Promise<PolicyListResult> {
  const data = await request<{ authzRules?: AuthorizationPolicy[]; count?: number }>(agentClient, {
    url: AGENT.authzRules,
    method: 'GET',
    params,
  });
  // 策略名是唯一标识。控制面偶尔会返回同名的重复对象（镜像/多命名空间），
  // 列表按名称去重，避免 React key 冲突和重复计数；详情按名称读取不受影响。
  const items = (data.authzRules ?? []).map(normalizePolicy);
  const byName = new Map<string, AuthorizationPolicy>();
  for (const policy of items) {
    // 保留首次出现的行，后面的同名对象不覆盖它。
    if (!byName.has(policy.name)) byName.set(policy.name, policy);
  }
  return { total: byName.size, items: [...byName.values()] };
}

export async function getPolicy(name: string): Promise<AuthorizationPolicy> {
  const data = await request<{ authzRule?: AuthorizationPolicy }>(agentClient, {
    url: `${AGENT.authzRules}/${encodeURIComponent(name)}`,
    method: 'GET',
  });
  if (!data.authzRule) throw new Error(`策略 ${name} 的响应里没有资源体`);
  return normalizePolicy(data.authzRule);
}

export async function createPolicy(input: PolicyInput): Promise<AuthorizationPolicy> {
  const data = await request<{ authzRule?: AuthorizationPolicy }>(agentClient, {
    url: AGENT.authzRules,
    method: 'POST',
    data: { authzRule: policyPayload(input) },
  });
  if (!data.authzRule) throw new Error('创建策略的响应里没有资源体');
  return normalizePolicy(data.authzRule);
}

export async function updatePolicy(input: PolicyInput): Promise<AuthorizationPolicy> {
  const data = await request<{ authzRule?: AuthorizationPolicy }>(agentClient, {
    url: `${AGENT.authzRules}/${encodeURIComponent(input.name)}`,
    method: 'PUT',
    data: { authzRule: policyPayload(input) },
  });
  if (!data.authzRule) throw new Error('更新策略的响应里没有资源体');
  return normalizePolicy(data.authzRule);
}

export async function deletePolicy(name: string): Promise<void> {
  await request<Record<string, never>>(agentClient, {
    url: `${AGENT.authzRules}/${encodeURIComponent(name)}`,
    method: 'DELETE',
  });
}
