/**
 * 命令分组（命令目录标签）与绑定的 `spec.commandSelector` 之间的换算。
 *
 * 命令目录里每个 Command 都带 `agent.onexstack.io/group=<key>`（后端
 * `command.LabelGroup`），所以「授予整组命令」可以用一个普通的 LabelSelector
 * 表达，而不必把组内命令逐个列进 `spec.commands`。分组留在 selector 里，
 * 以后目录新增的命令会自动落进同一组。
 *
 * 「命令」控件把分组当成一个特殊选项（`group:<key>`），与 `custom:` 前缀的
 * 自定义命令、普通命令名并列；表单提交时再拆回三个线上字段。
 */

/** 命令目录记录分组的标签键，与后端 `command.LabelGroup` 保持一致。 */
export const COMMAND_GROUP_LABEL_KEY = 'agent.onexstack.io/group';

/** 分组选项的值前缀。命令名是 DNS 名、不含 `:`，所以前缀不会与真命令冲突。 */
export const COMMAND_GROUP_PREFIX = 'group:';

/**
 * 分组 key → 中文名。
 *
 * 与后端 `command.Group.Label` 是同一套展示文案；这里复制一份是因为控制台
 * 不该为一句文案多打一次接口。未知 key 原样显示，不会因为后端加了新分组而
 * 从候选里消失。
 */
const COMMAND_GROUP_LABELS: Record<string, string> = {
  core: '基础',
  duty: '值班',
  ai: 'AI 助手',
  msg: '消息',
  job: '任务',
  'builtin-agent': '内置智能体',
  skill: 'Skill',
  custom: '自定义',
  resource: '资源',
  platform: '平台',
};

/** 分组的中文名；未知分组回退到 key。 */
export function commandGroupLabel(key: string): string {
  return COMMAND_GROUP_LABELS[key] ?? key;
}

/**
 * 候选里的分组顺序，与后端目录的声明顺序一致（`command.catalog`）。
 * 未知分组排在后面并按字母序，避免新分组插进熟悉的位置。
 */
const COMMAND_GROUP_ORDER = Object.keys(COMMAND_GROUP_LABELS);

/** 按目录顺序比较两个分组 key。 */
export function compareCommandGroups(a: string, b: string): number {
  const indexA = COMMAND_GROUP_ORDER.indexOf(a);
  const indexB = COMMAND_GROUP_ORDER.indexOf(b);
  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
  if (indexA !== -1) return -1;
  if (indexB !== -1) return 1;
  return a.localeCompare(b);
}

/** 值是否是一个分组选项。 */
export function isCommandGroupValue(value: string): boolean {
  return value.startsWith(COMMAND_GROUP_PREFIX);
}

/** 从分组选项值里取出分组 key。 */
export function commandGroupKey(value: string): string {
  return isCommandGroupValue(value) ? value.slice(COMMAND_GROUP_PREFIX.length) : value;
}

/** 表单里分组选项的展示文案，如「值班组」。 */
export function commandGroupTagLabel(key: string): string {
  return `${commandGroupLabel(key)}组`;
}

interface SelectorExpression {
  key?: string;
  operator?: string;
  values?: string[];
}

interface SelectorShape {
  matchLabels?: Record<string, string>;
  matchExpressions?: SelectorExpression[];
}

function asSelector(value: unknown): SelectorShape {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as SelectorShape;
}

/**
 * 从 selector 里取出被选中的分组 key。
 *
 * 只认 `agent.onexstack.io/group` 的精确匹配（`matchLabels` 或 `In`）；其他
 * 表达式是操作者的高级条件，原样保留、不在这里解释。
 */
export function commandGroupsOf(selector: unknown): string[] {
  const parsed = asSelector(selector);
  const out: string[] = [];

  const labelValue = parsed.matchLabels?.[COMMAND_GROUP_LABEL_KEY];
  if (typeof labelValue === 'string' && labelValue !== '') out.push(labelValue);

  for (const expression of parsed.matchExpressions ?? []) {
    if (!expression || expression.key !== COMMAND_GROUP_LABEL_KEY) continue;
    if (expression.operator !== 'In') continue;
    for (const value of expression.values ?? []) {
      if (typeof value === 'string' && value !== '') out.push(value);
    }
  }

  return Array.from(new Set(out)).sort();
}

/** 分组 key 列表 → 表单里 `group:` 选项值。 */
export function commandGroupValuesOf(selector: unknown): string[] {
  return commandGroupsOf(selector).map(key => `${COMMAND_GROUP_PREFIX}${key}`);
}

/**
 * 把表单里选中的分组写回 selector，并保留原有的非分组表达式。
 *
 * 返回 `undefined` 表示整条 selector 不再需要：空的 `matchLabels` /
 * `matchExpressions` 与「没有选择器」等价，而空对象会被 Kubernetes 读成
 * 「匹配全部」——那会把整个命令目录授予出去，绝不能在保存时附带。
 */
export function mergeCommandSelector(
  base: unknown,
  groupKeys: string[]
): Record<string, unknown> | undefined {
  const parsed = asSelector(base);

  const matchLabels: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.matchLabels ?? {})) {
    if (key === COMMAND_GROUP_LABEL_KEY) continue;
    if (typeof value === 'string') matchLabels[key] = value;
  }

  const matchExpressions: SelectorExpression[] = [];
  for (const expression of parsed.matchExpressions ?? []) {
    if (expression?.key === COMMAND_GROUP_LABEL_KEY && expression.operator === 'In') continue;
    matchExpressions.push(expression);
  }

  const keys = Array.from(new Set(groupKeys.filter(Boolean))).sort();
  if (keys.length > 0) {
    matchExpressions.push({
      key: COMMAND_GROUP_LABEL_KEY,
      operator: 'In',
      values: keys,
    });
  }

  const out: Record<string, unknown> = {};
  if (Object.keys(matchLabels).length > 0) out.matchLabels = matchLabels;
  if (matchExpressions.length > 0) out.matchExpressions = matchExpressions;
  return Object.keys(out).length > 0 ? out : undefined;
}
