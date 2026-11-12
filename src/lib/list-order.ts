/**
 * 资源列表的默认行顺序：最新创建的在最前。
 *
 * # 为什么排序在浏览器里
 *
 * 资源 List 接口只有 `offset/limit`（或 `page/page_size`），没有排序参数；而
 * `ResourcePage` 本来就要把全量行拉到浏览器、再过滤并本地分页（见
 * `api/resourceDefs.ts` 的 `listAll`）。排序因此统一放在全量读取 `fetchAll`
 * 里，早于过滤与切片——否则只能排当前页，跨页顺序仍然是错的；列表页、表单
 * 候选和调试台组合也因此共用同一份顺序。
 *
 * # 为什么兜底用 ID 降序
 *
 * 历史种子数据可能没有创建时间（`createdAt` 为 0 或缺失）。这类行按 ID 降序
 * 兜底，保证：
 *
 * - 顺序仍然确定，不会因为排序算法或网络到达顺序而抖动；
 * - 「没有时间戳」不会被当成「比所有行都新」而排到第一页。
 *
 * 单条资源的创建时间相同（同一毫秒批量导入）时，ID 兜底同样给出稳定顺序。
 */

/**
 * 把线上 `createdAt` 的几种形态归一成毫秒时间戳。
 *
 * 同一个字段在不同链路上可能是：
 * - epoch 毫秒的 number（`core.WriteResponse` 直接序列化 int64）；
 * - 数字字符串（JSON 里把 64 位整数编成字符串时会这样）；
 * - RFC3339 时间串（chat 侧部分模型用 `time.Time`）。
 *
 * 非法值与空值都按 `0` 处理，交给 ID 兜底。
 */
export function toMillis(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return 0;
    // 先按数字解析：`Number('1700000000000')` 成立，`Date.parse` 却会把它当成
    // 一段无法识别的日期串。
    const numeric = Number(text);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * ID 字符串降序。
 *
 * 用码点比较而不是 `localeCompare`：ID 是标识符，不是给人阅读的词。码点序不受
 * 当前语言环境影响，并且与后端 `ORDER BY name/id DESC` 的口径一一对应。
 */
export function compareIdDesc(a: unknown, b: unknown): number {
  const left = a == null ? '' : String(a);
  const right = b == null ? '' : String(b);
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

/** 单行排序算子：创建时间倒序，相同/缺失时 ID 倒序。 */
export function compareNewestFirst(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  idKey: string,
  createdAtKey = 'createdAt'
): number {
  const delta = toMillis(b[createdAtKey]) - toMillis(a[createdAtKey]);
  if (delta !== 0) return delta;
  return compareIdDesc(a[idKey], b[idKey]);
}

/**
 * 返回按「最新创建在前」排好序的新数组，不改动入参。
 *
 * `rows` 的元素通常已经解码成视图行；`idKey` 是资源声明的业务主键
 * （agent 资源是 `name`，工单是 `ticket_id`，等等）。
 */
export function sortNewestFirst<T>(rows: readonly T[], idKey: string): T[] {
  return [...rows].sort((a, b) =>
    compareNewestFirst(a as Record<string, unknown>, b as Record<string, unknown>, idKey)
  );
}
