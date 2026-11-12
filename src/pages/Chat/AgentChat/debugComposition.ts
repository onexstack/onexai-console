import type { AgentComposition } from '@/api/types';
import type { SmartDraft, SmartSelection } from '@/pages/ResourceForm/smartCreate/types';

/**
 * 调试台的能力组合纯函数。
 *
 * 组合的「同一性」由这里决定：能力列表与顺序无关（排序后比较），提示词顺序
 * 有关（它决定系统提示词的拼接顺序）。服务端的会话桶用同一套语义计算，所以
 * 前端据此判断「是否要开新会话」不会和后端不一致。
 */

export function emptyComposition(namespace?: string): AgentComposition {
  return {
    model: '',
    prompts: [],
    skills: [],
    mcps: [],
    knowledgeBases: [],
    customCommands: [],
    namespace,
  };
}

function normalizeNames(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** 去掉空值、去重；能力类排序，提示词保序。 */
export function normalizeComposition(composition: AgentComposition): AgentComposition {
  return {
    model: composition.model?.trim() ?? '',
    prompts: normalizeNames(composition.prompts),
    skills: [...normalizeNames(composition.skills)].sort(),
    mcps: [...normalizeNames(composition.mcps)].sort(),
    knowledgeBases: [...normalizeNames(composition.knowledgeBases)].sort(),
    customCommands: [...normalizeNames(composition.customCommands)].sort(),
    namespace: composition.namespace?.trim() || undefined,
  };
}

/** 稳定的组合指纹；用于判断选择器是否真的变了。 */
export function compositionHash(composition: AgentComposition): string {
  const normalized = normalizeComposition(composition);
  return JSON.stringify([
    normalized.model ?? '',
    normalized.prompts,
    normalized.skills,
    normalized.mcps,
    normalized.knowledgeBases,
    normalized.customCommands,
    // The referrer decides how bare names resolve and which grants apply, so
    // the same lists in two business lines are not the same conversation.
    normalized.namespace ?? '',
  ]);
}

export function compositionCounts(composition: AgentComposition): {
  prompts: number;
  skills: number;
  mcps: number;
  knowledgeBases: number;
  customCommands: number;
  total: number;
} {
  const prompts = composition.prompts.length;
  const skills = composition.skills.length;
  const mcps = composition.mcps.length;
  const knowledgeBases = composition.knowledgeBases.length;
  const customCommands = composition.customCommands.length;
  return {
    prompts,
    skills,
    mcps,
    knowledgeBases,
    customCommands,
    total: prompts + skills + mcps + knowledgeBases + customCommands,
  };
}

/** 选择器下方与消息气泡 Tooltip 的一行摘要。 */
export function compositionSummary(composition: AgentComposition): string {
  const counts = compositionCounts(composition);
  const model = composition.model ? `模型 ${composition.model}` : '模型 部署默认';
  return [
    composition.namespace ? `空间 ${composition.namespace}` : '空间 部署默认',
    model,
    `提示词 ${counts.prompts}`,
    `MCP ${counts.mcps}`,
    `命令 ${counts.customCommands}`,
    `Skill ${counts.skills}`,
    `知识库 ${counts.knowledgeBases}`,
  ].join(' · ');
}

/** 组合是否为空（没有提示词、能力或模型覆盖）。 */
export function isCompositionEmpty(composition: AgentComposition): boolean {
  const counts = compositionCounts(composition);
  return counts.total === 0 && !composition.model;
}

/**
 * 服务端会话 nonce。
 *
 * 只用于区分「同一组合下的不同会话」；组合本身还会进入服务端的桶键。随机
 * UUID 在浏览器里足够，降级到时间戳 + 随机串只是为了让旧 WebView 也能用。
 */
export function newSessionNonce(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // 非安全上下文：走下面的降级。
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 把组合翻译成「新建智能体」表单的草案。 */
export function buildSmartDraftFromComposition(input: {
  composition: AgentComposition;
  name: string;
  displayName: string;
  description: string;
}): SmartDraft {
  // An Agent spec names only its own namespace. A value from the referrer's
  // namespace becomes the bare name; anything from another namespace needs a
  // binding, so it is not silently written into the agent.
  const owner = input.composition.namespace ?? '';
  const localNames = (names: string[]): string[] =>
    normalizeNames(names).flatMap(entry => {
      const slash = entry.indexOf('/');
      if (slash < 0) return [entry];
      const namespace = entry.slice(0, slash);
      return namespace === owner ? [entry.slice(slash + 1)] : [];
    });
  const selection = (names: string[]): SmartSelection[] =>
    localNames(names).map(name => ({ name, reason: '来自调试台组合' }));

  return {
    name: input.name,
    displayName: input.displayName,
    description: input.description,
    // 空表示部署默认：新建表单的模型字段留空即可，不需要借用任何宿主的模型。
    // 跨空间的模型需要绑定注入，不能写进 Agent spec。
    model: localNames(input.composition.model ? [input.composition.model] : [])[0] ?? '',
    status: 'enabled',
    prompts: selection(input.composition.prompts),
    knowledgeBases: selection(input.composition.knowledgeBases),
    mcps: selection(input.composition.mcps),
    skills: selection(input.composition.skills),
    customCommands: selection(input.composition.customCommands),
    engine: 'debug',
  };
}
