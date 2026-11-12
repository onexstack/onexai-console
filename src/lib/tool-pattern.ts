/**
 * 工具名与「工具模式」的匹配。
 *
 * 允许/审批列表里既能写精确工具名，也能写通配模式：
 * `*`（全部）、`delete_*`（前缀）、`*_admin`（后缀）、`get_*_by_id`（中缀）。
 * 前端用它把「需审批的工具」候选收敛到「允许的工具」范围内，并清理收窄后
 * 已经失效的旧选择；后端按同一套语义执行，两边不能有分歧。
 */

const PATTERN_CACHE = new Map<string, RegExp>();

/** 把工具模式编译成正则：只把 `*` 当通配，其余字符原样匹配。 */
function compile(pattern: string): RegExp {
  const cached = PATTERN_CACHE.get(pattern);
  if (cached) return cached;

  const source = pattern
    .split('*')
    .map(part => part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
    .join('.*');
  const regexp = new RegExp(`^${source}$`);
  // 模式来自用户的标签输入，种类有限；设个上限避免长期停留在页面上时无限增长。
  if (PATTERN_CACHE.size >= 500) PATTERN_CACHE.clear();
  PATTERN_CACHE.set(pattern, regexp);
  return regexp;
}

/** 工具名是否命中模式：精确名、`*` 或含 `*` 的通配。 */
export function matchesToolPattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  return compile(pattern).test(name);
}
