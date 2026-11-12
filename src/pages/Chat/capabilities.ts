import type { CapabilitySelection, EffectiveAgent, SelectableCapability } from '@/api/types';

/**
 * 测试模式的能力选择。
 *
 * 这里只做纯计算，不碰 React 状态：面板、输入框提示和消息气泡都要回答
 * 「这次选了哪些」这个问题，把它们放在一处才不会有三个口径。
 */

export const SELECTABLE_CAPABILITIES: SelectableCapability[] = [
  'skills',
  'mcps',
  'knowledgeBases',
  'customCommands',
];

export const CAPABILITY_LABELS: Record<SelectableCapability, string> = {
  skills: 'Skill',
  mcps: 'MCP',
  knowledgeBases: '知识库',
  customCommands: '自定义命令',
};

type Capabilities = NonNullable<EffectiveAgent['capabilities']>;

function namesOf(capabilities: Capabilities | undefined, kind: SelectableCapability): string[] {
  return capabilities?.[kind] ?? [];
}

/** 空选择：四类都不启用。 */
export function emptySelection(): CapabilitySelection {
  return { skills: [], mcps: [], knowledgeBases: [], customCommands: [] };
}

/** 生效能力全集。没有数据时是空选择。 */
export function fullSelection(capabilities: Capabilities | undefined): CapabilitySelection {
  return {
    skills: [...namesOf(capabilities, 'skills')],
    mcps: [...namesOf(capabilities, 'mcps')],
    knowledgeBases: [...namesOf(capabilities, 'knowledgeBases')],
    customCommands: [...namesOf(capabilities, 'customCommands')],
  };
}

/**
 * 是否比生效能力更窄。
 *
 * 逐类比较选中数量即可：选择只可能来自生效列表，所以「数量相同」等价于
 * 「集合相同」。空能力集与空选择都不算窄。
 */
export function isNarrowed(
  selection: CapabilitySelection,
  capabilities: Capabilities | undefined
): boolean {
  return SELECTABLE_CAPABILITIES.some(
    kind => selection[kind].length !== namesOf(capabilities, kind).length
  );
}

/** 选中的与可用的总数（四类合计）。 */
export function selectionCounts(
  selection: CapabilitySelection,
  capabilities: Capabilities | undefined
): { selected: number; total: number } {
  let selected = 0;
  let total = 0;
  for (const kind of SELECTABLE_CAPABILITIES) {
    selected += selection[kind].length;
    total += namesOf(capabilities, kind).length;
  }
  return { selected, total };
}

/** 请求体里的形状；复制数组，避免调用方后续修改影响已发出的语义。 */
export function toRequestSelection(selection: CapabilitySelection): CapabilitySelection {
  return {
    skills: [...selection.skills],
    mcps: [...selection.mcps],
    knowledgeBases: [...selection.knowledgeBases],
    customCommands: [...selection.customCommands],
  };
}

/** 消息气泡的 Tooltip：`Skill 2/3 · MCP 1/2 · …`。 */
export function selectionSummary(selection: CapabilitySelection): string {
  return SELECTABLE_CAPABILITIES.map(
    kind => `${CAPABILITY_LABELS[kind]} ${selection[kind].length}`
  ).join(' · ');
}
