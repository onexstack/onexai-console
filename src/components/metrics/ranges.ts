/**
 * 监控窗口的预设范围与桶大小。
 *
 * `from` 每次请求现算，`to` 为当前时刻，窗口自然向前滚动；调用方不要把
 * `from/to` 写进 React Query 的 key，否则每次渲染都会得到一个新 key。
 */

export type MonitorRangeKey = '1h' | '6h' | '24h' | '7d';

export interface MonitorRangeDef {
  key: MonitorRangeKey;
  label: string;
  spanMs: number;
  stepMs: number;
}

export const MONITOR_RANGES: MonitorRangeDef[] = [
  { key: '1h', label: '1小时', spanMs: 3_600_000, stepMs: 60_000 },
  { key: '6h', label: '6小时', spanMs: 6 * 3_600_000, stepMs: 300_000 },
  { key: '24h', label: '24小时', spanMs: 24 * 3_600_000, stepMs: 1_800_000 },
  { key: '7d', label: '7天', spanMs: 7 * 24 * 3_600_000, stepMs: 3_600_000 },
];

export const DEFAULT_MONITOR_RANGE: MonitorRangeKey = '1h';

const DEFAULT_RANGE_DEF: MonitorRangeDef = MONITOR_RANGES[0] as MonitorRangeDef;

export const AUTO_REFRESH_MS = 30_000;

export function monitorRangeDef(key: MonitorRangeKey): MonitorRangeDef {
  return MONITOR_RANGES.find(range => range.key === key) ?? DEFAULT_RANGE_DEF;
}

/** 当前窗口：每次请求现算，`to` 为当前时刻，窗口自然向前滚动。 */
export function monitorWindow(range: MonitorRangeDef): { from: number; to: number; step: number } {
  const to = Date.now();
  return { from: to - range.spanMs, to, step: range.stepMs };
}
