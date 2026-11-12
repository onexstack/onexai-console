/**
 * 新建表单里让「显示名」默认跟随「名称」。
 *
 * 语义：名称变化时，只要用户还没亲手改过显示名，就拿名称作为显示名。用户一旦
 * 编辑过显示名（包括清空），本次新建会话内不再自动覆盖 —— 手动值永远优先。
 *
 * 这里只计算「应该写入哪个字段、写什么值」，真正写表单由调用方完成：各表单的
 * `FormInstance` 字段类型不同（有的带字面量联合），统一在这里收口会制造无谓的
 * 类型体操。
 */

export interface DisplayNameKeys {
  /** 身份字段：`name` / `username` / `spec.name`。 */
  nameKey: string;
  /** 显示名字段：`displayName` / `display_name` / `spec.displayName`。 */
  displayNameKey: string;
}

/** 一次「显示名跟随名称」的表单写入。 */
export interface DisplayNamePatch {
  /** 目标字段路径；点分键已展开成 antd 的 NamePath。 */
  name: string | string[];
  value: string;
}

/** `spec.displayName` → `['spec', 'displayName']`；顶层键保持字符串。 */
function pathOf(key: string): string | string[] {
  return key.includes('.') ? key.split('.') : key;
}

/** 本次变更里是否包含这个（可能是嵌套的）字段。 */
function hasPath(changed: Record<string, unknown>, key: string): boolean {
  let cursor: unknown = changed;
  for (const part of key.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return true;
}

function valueAt(changed: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, changed);
}

/**
 * 根据本次表单变更算出要写入的显示名；不需要写入时返回 null。
 *
 * `changed` 是 antd `onValuesChange` 的第一个参数。`edited` 由调用方以 ref
 * 保存：用户手改显示名时这里会置为 true，之后名称变更不再覆盖。
 */
export function displayNamePatch(
  changed: Record<string, unknown>,
  keys: DisplayNameKeys,
  edited: { current: boolean }
): DisplayNamePatch | null {
  if (hasPath(changed, keys.displayNameKey)) {
    edited.current = true;
    return null;
  }
  if (edited.current || !hasPath(changed, keys.nameKey)) return null;

  const next = valueAt(changed, keys.nameKey);
  if (typeof next !== 'string') return null;
  return { name: pathOf(keys.displayNameKey), value: next };
}
