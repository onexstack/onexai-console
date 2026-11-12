import type { PolicyResource } from '@/api/policies';

export interface KindOption {
  value: string;
  label: string;
  /** 该类型的资源名是否可以从固定枚举里选（角色）。 */
  names?: { value: string; label: string }[];
}

export const RESOURCE_KIND_OPTIONS: KindOption[] = [
  { value: 'namespace', label: '命名空间' },
  { value: 'agent', label: '智能体' },
  { value: 'mcp', label: 'MCP 服务' },
  { value: 'tool', label: '工具' },
  { value: 'skill', label: '技能' },
  { value: 'knowledgebase', label: '知识库' },
  { value: 'memory', label: '记忆库' },
  { value: 'prompt', label: '提示词' },
  { value: 'model', label: '模型' },
  { value: 'customcommand', label: '自定义命令' },
  { value: 'scheduledrun', label: '定时任务' },
  { value: 'webhook', label: 'Agent Webhook' },
  { value: 'runtimeprofile', label: 'Runtime Profile' },
  { value: 'sandboxtemplate', label: '沙箱模板' },
  { value: 'service', label: '服务（CMDB）' },
  { value: 'cluster', label: '集群' },
  { value: 'k8s-namespace', label: 'K8s 命名空间' },
  {
    value: 'role',
    label: '角色',
    names: [
      { value: 'admin', label: '管理员' },
      { value: 'sre', label: 'SRE' },
    ],
  },
  { value: '*', label: '全部资源类型' },
];

export const VERB_OPTIONS = [
  { value: 'read', label: '读：查看 / 使用智能体 / 调用只读工具' },
  { value: 'write', label: '写：创建 / 修改 / 删除 / 调用变更工具' },
];

export function kindLabel(kind: string): string {
  const found = RESOURCE_KIND_OPTIONS.find(option => option.value === kind);
  return found?.label ?? kind;
}

/** 资源的压缩展示：kind 后跟名称，全部用 *。 */
export function resourceSummary(resource: PolicyResource): string {
  if (resource.names.includes('*')) return `${kindLabel(resource.kind)}：全部`;
  return `${kindLabel(resource.kind)}：${resource.names.join(', ')}`;
}

export function verbLabel(verb: string): string {
  if (verb === 'read') return '读';
  if (verb === 'write') return '写';
  return verb;
}

/** 策略主体的种类名（展示用）。 */
export function subjectKindLabel(kind: string): string {
  switch (kind.trim().toLowerCase()) {
    case 'user':
      return '用户';
    case 'group':
      return '用户组';
    case 'serviceaccount':
      return '服务账号';
    case 'namespace':
      return '命名空间';
    case '*':
      return '所有主体';
    default:
      return kind;
  }
}
