/**
 * 引用授权（ReferenceGrant）的线上形状与可视化生成器共用的纯函数。
 *
 * 线上 REST 形状是**顶层** `from` / `to`（没有 `spec` 包装）：
 * - from: `[{ group, kind, namespace }]`，三项都必填，故意没有 name；
 * - to:   `[{ group, kind, name? }]`，name 为空表示该 kind 的全部对象。
 *
 * grant 住在目标命名空间；页面表单里的 `namespace` 字段就是目标空间，
 * 所以 `to.name` 的候选对象也来自这个空间。
 *
 * group 与 from.kind 在界面和线上都是固定值，行状态里不保存：
 * - group 只有 `agent.onexai.io`；
 * - from.kind 运行期只认 `Agent`（其它 kind 能落库但永远不会生效）。
 */

/** 平台资源组的唯一取值（`pkg/apis/agent/register.go` 的 GroupName）。 */
export const REFERENCE_GRANT_GROUP = 'agent.onexai.io';

/** 引用方类型：运行期只认 Agent，其它 kind 能落库但永远不会生效。 */
export const REFERENCE_GRANT_FROM_KIND = 'Agent';

/**
 * 可跨空间的目标类型。
 *
 * 与后端 `pkg/apis/agent/sharing` 的 Shareable 表一致：自定义命令以调用方
 * 权限执行，Webhook / RuntimeProfile 等按对象所在空间寻址，它们都不能被
 * ReferenceGrant 打开。生成器与手写 JSON 都只接受这一组。
 */
export const SHAREABLE_GRANT_KINDS = [
  'MCPServer',
  'Skill',
  'KnowledgeBase',
  'Prompt',
  'Memory',
  'Model',
] as const;

/** 一条 from 的线上形态。 */
export type GrantFromItem = { group: string; kind: string; namespace: string };

/** 一条 to 的线上形态；name 省略表示该 kind 的全部对象。 */
export type GrantToItem = { group: string; kind: string; name?: string };

/** 生成器里的 from 行；group/kind 固定，`id` 只用于 React key。 */
export interface GrantFromRow {
  id: string;
  namespace: string;
}

/** 生成器里的 to 行；group 固定，`name === ''` 表示「全部对象」。 */
export interface GrantToRow {
  id: string;
  kind: string;
  name: string;
}

let rowSeq = 0;

function nextRowId(): string {
  rowSeq += 1;
  return `grant-row-${rowSeq}`;
}

export function newFromRow(patch: Partial<Omit<GrantFromRow, 'id'>> = {}): GrantFromRow {
  return { id: nextRowId(), namespace: '', ...patch };
}

export function newToRow(patch: Partial<Omit<GrantToRow, 'id'>> = {}): GrantToRow {
  return { id: nextRowId(), kind: '', name: '', ...patch };
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return String(value);
}

/**
 * 把表单值或线上值拆成对象数组。
 *
 * 表单里是 JSON 字符串（`initialValues` / 用户手输），线上是数组；两种都接受。
 * `invalid` 只表示「整体不是 JSON 数组，或数组里混了非对象项」，不表示业务字段
 * 缺失 —— 后者由 `fromGrantIssue` / `toGrantIssue` 负责。
 */
function asItems(value: unknown): { items: Record<string, unknown>[]; invalid: boolean } {
  let list: unknown[];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) return { items: [], invalid: true };
      list = parsed;
    } catch {
      return { items: [], invalid: true };
    }
  } else {
    return { items: [], invalid: false };
  }

  let invalid = false;
  const items: Record<string, unknown>[] = [];
  for (const item of list) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      items.push(item as Record<string, unknown>);
    } else {
      invalid = true;
    }
  }
  return { items, invalid };
}

/** 解析 from：只取 namespace（group/kind 固定），未知值由序列化统一收敛。 */
export function parseFromRows(value: unknown): { rows: GrantFromRow[]; invalid: boolean } {
  const { items, invalid } = asItems(value);
  return {
    invalid,
    rows: items.map(item => newFromRow({ namespace: text(item.namespace) })),
  };
}

/** 解析 to：保留未知 kind/name，避免编辑已有数据时静默丢值；group 固定。 */
export function parseToRows(value: unknown): { rows: GrantToRow[]; invalid: boolean } {
  const { items, invalid } = asItems(value);
  return {
    invalid,
    rows: items.map(item => newToRow({ kind: text(item.kind), name: text(item.name) })),
  };
}

/** 行 → 线上 from：group/kind 固定，丢掉空行并按 namespace 去重。 */
export function buildFromItems(rows: GrantFromRow[]): GrantFromItem[] {
  const seen = new Set<string>();
  const items: GrantFromItem[] = [];
  for (const row of rows) {
    const namespace = row.namespace.trim();
    if (!namespace || seen.has(namespace)) continue;
    seen.add(namespace);
    items.push({
      group: REFERENCE_GRANT_GROUP,
      kind: REFERENCE_GRANT_FROM_KIND,
      namespace,
    });
  }
  return items;
}

/** 行 → 线上 to：group 固定，name 为空时省略该键（= 全部对象），按 kind+name 去重。 */
export function buildToItems(rows: GrantToRow[]): GrantToItem[] {
  const seen = new Set<string>();
  const items: GrantToItem[] = [];
  for (const row of rows) {
    const kind = row.kind.trim();
    const name = row.name.trim();
    if (!kind) continue;
    const key = JSON.stringify([kind, name]);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(
      name ? { group: REFERENCE_GRANT_GROUP, kind, name } : { group: REFERENCE_GRANT_GROUP, kind }
    );
  }
  return items;
}

export function buildFromJson(rows: GrantFromRow[]): string {
  return JSON.stringify(buildFromItems(rows), null, 2);
}

export function buildToJson(rows: GrantToRow[]): string {
  return JSON.stringify(buildToItems(rows), null, 2);
}

/** 引用方抽屉里「确定」前的检查；返回第一条问题，`null` 表示可以生成。 */
export function fromGrantIssue(rows: GrantFromRow[]): string | null {
  if (rows.length === 0) return '请至少添加一条引用方（from）';
  for (const [index, row] of rows.entries()) {
    if (!row.namespace.trim()) return `引用方第 ${index + 1} 行请选择命名空间`;
  }
  return null;
}

/** 目标抽屉里「确定」前的检查；返回第一条问题，`null` 表示可以生成。 */
export function toGrantIssue(rows: GrantToRow[]): string | null {
  if (rows.length === 0) return '请至少添加一条目标（to）';
  for (const [index, row] of rows.entries()) {
    if (!row.kind.trim()) return `目标第 ${index + 1} 行请选择类型`;
  }
  return null;
}

/**
 * 提交前的结构校验（手写 JSON 也走这里）。
 *
 * 只校验形状：必须是数组、元素必须是对象、必填字符串非空；不校验 group/kind
 * 枚举，也不校验 DNS 格式 —— 后端不认枚举，且历史数据可能含未知值，格式校验
 * 仍由后端兜底。
 */
export function validateGrantPayload(
  values: Record<string, unknown>
): { field?: 'from' | 'to'; message: string } | null {
  const check = (
    field: 'from' | 'to',
    label: string,
    required: readonly string[]
  ): { field: 'from' | 'to'; message: string } | null => {
    const list = values[field];
    if (!Array.isArray(list) || list.length === 0) {
      return { field, message: `${label}至少需要一项` };
    }
    for (const [index, item] of list.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { field, message: `${label}第 ${index + 1} 项必须是对象` };
      }
      for (const prop of required) {
        const value = (item as Record<string, unknown>)[prop];
        if (typeof value !== 'string' || value.trim() === '') {
          return { field, message: `${label}第 ${index + 1} 项缺少 ${prop}` };
        }
      }
    }
    return null;
  };

  const shape =
    check('from', '引用方（from）', ['group', 'kind', 'namespace']) ??
    check('to', '目标（to）', ['group', 'kind']);
  if (shape) return shape;

  // 后端的 grant 匹配是精确的：group/kind 写错的对象会落库但永远不会生效。
  // 在提交前拦住它，避免用户看到“已授权”却仍被运行期拒绝。
  for (const [index, item] of (values.from as Array<Record<string, unknown>>).entries()) {
    if (item.group !== REFERENCE_GRANT_GROUP) {
      return { field: 'from', message: `引用方第 ${index + 1} 项 group 必须是 ${REFERENCE_GRANT_GROUP}` };
    }
    if (item.kind !== REFERENCE_GRANT_FROM_KIND) {
      return { field: 'from', message: `引用方第 ${index + 1} 项 kind 必须是 ${REFERENCE_GRANT_FROM_KIND}` };
    }
  }
  for (const [index, item] of (values.to as Array<Record<string, unknown>>).entries()) {
    if (item.group !== REFERENCE_GRANT_GROUP) {
      return { field: 'to', message: `目标第 ${index + 1} 项 group 必须是 ${REFERENCE_GRANT_GROUP}` };
    }
    if (!(SHAREABLE_GRANT_KINDS as readonly string[]).includes(String(item.kind))) {
      return { field: 'to', message: `目标第 ${index + 1} 项的 kind 不能跨空间共享` };
    }
  }
  return null;
}
