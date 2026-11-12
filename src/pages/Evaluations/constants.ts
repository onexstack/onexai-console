/**
 * 评测中心的页面视图（占位）。
 *
 * 三个叶子就是三条真实路由；页内 TAB 只做导航，当前视图由 pathname 推导，
 * 不使用本地 state —— 刷新、深链、前进后退天然成立。后续接入评测能力时，
 * 在这里补充视图即可，侧栏与路由共用同一份声明。
 */
export type EvaluationsView = 'datasets' | 'tasks' | 'reports';

export interface EvaluationsViewDef {
  key: EvaluationsView;
  /** i18n key（中文原文即 key）。 */
  label: string;
  path: string;
}

export const EVALUATIONS_VIEWS: EvaluationsViewDef[] = [
  { key: 'datasets', label: '数据集', path: '/evaluations/datasets' },
  { key: 'tasks', label: '评测任务', path: '/evaluations/tasks' },
  { key: 'reports', label: '评测报告', path: '/evaluations/reports' },
];

export const DEFAULT_EVALUATIONS_VIEW: EvaluationsView = 'datasets';

/** 把 pathname 映射到 view；未知路径回退到第一个视图（路由已兜底重定向）。 */
export function viewFromPathname(pathname: string): EvaluationsView {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return EVALUATIONS_VIEWS.find(view => view.path === normalized)?.key ?? DEFAULT_EVALUATIONS_VIEW;
}

export function evaluationsPath(view: EvaluationsView): string {
  return EVALUATIONS_VIEWS.find(item => item.key === view)?.path ?? '/evaluations/datasets';
}
