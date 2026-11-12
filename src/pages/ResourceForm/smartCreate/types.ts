/** 智能创建里可推荐的五类资源；键同时是智能体表单的字段名。 */
export type SmartKind = 'knowledgeBases' | 'mcps' | 'skills' | 'customCommands' | 'models';

/** 一个可推荐的能力（模型也可以是候选）。 */
export interface SmartCandidate {
  kind: SmartKind;
  name: string;
  displayName: string;
  description: string;
  namespace: string;
  /** 模型的归属；共享构件为空。 */
  owner: string;
  /** labels 拼成的一行文本，仅用于本地匹配。 */
  labelsText: string;
  /** 类型相关的补充文本（provider/mode/allowedTools 等），用于匹配与展示。 */
  detail: string;
  /** 描述之外的领域信号（工具名、契约、别名等），只参与本地匹配。 */
  extra: string;
  /** 本地打分与命中理由；由 matcher 填充。 */
  score?: number;
  reasons?: string[];
}

/** 五类候选的目录。 */
export type SmartCatalog = Record<SmartKind, SmartCandidate[]>;

export type SmartCounts = Record<SmartKind, number>;

/** 一项被选中的能力。 */
export interface SmartSelection {
  name: string;
  reason: string;
}

export type SmartEngine = 'ai' | 'local' | 'debug' | 'template';

/** 模型 + 能力编排 + 文案的完整草案；确认前用户可改。 */
export interface SmartDraft {
  name: string;
  displayName: string;
  description: string;
  /** 空串表示使用部署默认模型。 */
  model: string;
  status: 'enabled' | 'disabled';
  /**
   * 系统提示词。智能创建本身不推荐提示词；调试台的「创建智能体」会带上
   * 当前组合，所以这里是可选的，旧调用方不必补字段。
   */
  prompts?: SmartSelection[];
  knowledgeBases: SmartSelection[];
  mcps: SmartSelection[];
  skills: SmartSelection[];
  customCommands: SmartSelection[];
  /**
   * 引用的智能体模版。只有「从模版创建」会填；能力仍由控制器从模版合并，
   * 这里只表达“引用谁”，不复制模版声明的能力。
   */
  templateRefs?: string[];
  engine: SmartEngine;
  /** 本地兜底或校验降级时给用户看的原因。 */
  notice?: string;
}

/** 能力类字段（不含 model）。 */
export type SmartSelectionKind = Exclude<SmartKind, 'models'>;

/** 每类资源的中文名、路由与列表键。 */
export const SMART_KINDS: {
  kind: SmartKind;
  resourceKey: string;
  label: string;
  newHref: string;
}[] = [
  {
    kind: 'knowledgeBases',
    resourceKey: 'knowledge-bases',
    label: '知识库',
    newHref: '/knowledge-bases/new',
  },
  { kind: 'mcps', resourceKey: 'mcps', label: 'MCP', newHref: '/mcps/new' },
  { kind: 'skills', resourceKey: 'skills', label: 'Skill', newHref: '/skills/new' },
  {
    kind: 'customCommands',
    resourceKey: 'custom-commands',
    label: '自定义命令',
    newHref: '/custom-commands/new',
  },
  { kind: 'models', resourceKey: 'models', label: '模型', newHref: '/models/new' },
];

/** 能力类（不含模型）的固定顺序。 */
export const SELECTION_KINDS: SmartSelectionKind[] = [
  'knowledgeBases',
  'mcps',
  'skills',
  'customCommands',
];

/** 每类最多推荐几项；模型单选。 */
export const SELECTION_LIMITS: Record<SmartSelectionKind, number> = {
  knowledgeBases: 3,
  mcps: 3,
  skills: 4,
  customCommands: 3,
};
