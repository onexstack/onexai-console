/**
 * Agent 引用的本地校验。
 *
 * 管理面契约：Agent spec 只允许本地引用（`ObjectReference.namespace` 必须为空）。
 * 跨空间能力通过 AgentBinding / ClusterAgentBinding 注入，控制器再用目标空间的
 * `ReferenceGrant` 裁决。前端在提交前把这条规则翻译成字段级中文错误，避免用户
 * 只看到后端那句 `knowledgeBases[0] must be local to the agent`。
 *
 * 校验对象是 `normalizeSubmit` 之后的线上形状：数组/单值都是
 * `{ name, namespace? }` 对象。
 */

interface AgentRefField {
  key: string;
  label: string;
}

/** Agent spec 里所有“引用”字段；顺序即报错优先级。 */
const AGENT_REF_FIELDS: AgentRefField[] = [
  { key: 'skills', label: 'Skill' },
  { key: 'mcps', label: 'MCP' },
  { key: 'knowledgeBases', label: '知识库' },
  { key: 'prompts', label: '提示词' },
  { key: 'memoryRef', label: '记忆库' },
  { key: 'customCommands', label: '自定义命令' },
  { key: 'delegates', label: '子智能体' },
  { key: 'templateRefs', label: '模版' },
  { key: 'model', label: '模型' },
];

export interface AgentRefIssue {
  /** 顶层字段键，可直接交给表单的 `revealField`。 */
  field: string;
  message: string;
}

function refsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
    );
  }
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

/**
 * 返回第一处跨空间引用；全部合法时返回 null。
 *
 * 这里不做“与 Agent 同 namespace 就放行”的例外：REST 契约要求本地引用写裸名，
 * 显式带上与目标空间相同的 namespace 也会被拒绝。
 */
export function findForeignAgentRef(values: Record<string, unknown>): AgentRefIssue | null {
  for (const { key, label } of AGENT_REF_FIELDS) {
    for (const ref of refsOf(values[key])) {
      const namespace = typeof ref.namespace === 'string' ? ref.namespace.trim() : '';
      if (!namespace) continue;
      const name = typeof ref.name === 'string' ? ref.name : '';
      const target = name ? `${namespace}/${name}` : namespace;
      return {
        field: key,
        message: `${label}引用「${target}」是跨空间引用；Agent 只能引用本空间资源，请通过「能力编排 → 能力绑定」注入。`,
      };
    }
  }
  return null;
}
