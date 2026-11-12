/**
 * 点路径读写（`spec.enabled` 这类嵌套字段）。
 *
 * 列表/详情的开关只拿到一个字段路径，而写通路是「读整行 → 合并 patch → 整对象
 * PUT」。如果 patch 仍按顶层键做浅合并，`{ 'spec.enabled': false }` 会变成一行
 * 字面量键而不是嵌套字段，并且整个 `spec` 的其余内容还停留在旧值。这里把路径
 * 语义收在一处，读写两侧用同一套规则。
 */

/** 按 `a.b.c` 逐层读取；路径不存在时返回 `undefined`。 */
export function readPath(target: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, target);
}

/**
 * 按 `a.b.c` 写入，返回**新对象**。
 *
 * 路径上的父对象逐层复制，不修改入参：缓存里的行可能被别的观察者共享，原地改
 * 会让「值没变」的调用方也看到一次无声的变更。
 */
export function writePath(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const parts = path.split('.');
  const head = parts[0] ?? '';
  const rest = parts.slice(1);
  if (rest.length === 0) return { ...target, [head]: value };

  const child = target[head];
  const base =
    child && typeof child === 'object' && !Array.isArray(child)
      ? (child as Record<string, unknown>)
      : {};
  return { ...target, [head]: writePath(base, rest.join('.'), value) };
}

/**
 * 把 patch 应用到一行。
 *
 * 含 `.` 的键按嵌套路径写入；其余键保持原来的顶层浅合并语义 —— 表单保存仍
 * 按「整份顶层字段覆盖」工作，只有开关这类单字段 patch 走路径。
 */
export function applyPathPatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  let out = target;
  for (const [key, value] of Object.entries(patch)) {
    out = key.includes('.') ? writePath(out, key, value) : { ...out, [key]: value };
  }
  return out;
}
