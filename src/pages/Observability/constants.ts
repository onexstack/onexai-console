import { DEFAULT_MONITOR_RANGE, MONITOR_RANGES, type MonitorRangeKey } from '@/components/metrics';

/**
 * 观测中心的页面视图。
 *
 * 侧栏的 5 个叶子就是 5 条真实路由；页面内不再渲染页签，current view 由
 * pathname 推导，不使用本地 state——刷新、深链、前进后退天然成立。
 */
export type ObservabilityView = 'overview' | 'runs' | 'tokens' | 'agents' | 'failures';

export interface ObservabilityViewDef {
  key: ObservabilityView;
  label: string;
  path: string;
}

export const OBSERVABILITY_VIEWS: ObservabilityViewDef[] = [
  { key: 'overview', label: '观测总览', path: '/observability' },
  { key: 'runs', label: '运行分析', path: '/observability/runs' },
  { key: 'tokens', label: 'Token 用量', path: '/observability/tokens' },
  { key: 'agents', label: '智能体健康', path: '/observability/agents' },
  { key: 'failures', label: '异常与失败', path: '/observability/failures' },
];

export const DEFAULT_OBSERVABILITY_VIEW: ObservabilityView = 'overview';

/** 把 pathname 映射到 view；先去掉末尾斜杠，避免 `/observability/` 落到 404。 */
export function viewFromPathname(pathname: string): ObservabilityView {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (
    OBSERVABILITY_VIEWS.find(view => view.path === normalized)?.key ?? DEFAULT_OBSERVABILITY_VIEW
  );
}

/** 时间范围白名单：URL 被手改成未知值时回退默认 1 小时。 */
export function parseRange(raw: string | null): MonitorRangeKey {
  return MONITOR_RANGES.some(range => range.key === raw)
    ? (raw as MonitorRangeKey)
    : DEFAULT_MONITOR_RANGE;
}

export function positiveInt(raw: string | null, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
