import dayjs from 'dayjs';

import { ADMIN_RUN_STATE, ADMIN_RUN_TRIGGER } from '@/api/agentRuns';

/**
 * 监控/观测共用的展示格式化。
 *
 * 时间桶由服务端按 step 切好，这里只把桶起点格式化成横轴标签；不做任何时区
 * 换算，浏览器本地时区就是用户读图时的时区。
 */

export type ChartTheme = 'light' | 'dark';

export interface ChartPalette {
  success: string;
  failed: string;
  canceled: string;
  active: string;
  prompt: string;
  completion: string;
  grid: string;
  axis: string;
  text: string;
  surface: string;
  durationRamp: string[];
}

/**
 * 状态色刻意不红绿相邻：堆叠顺序固定为成功、活跃、已取消、失败，让最常见的
 * 成功段与失败段隔开；图例与文字标签同时提供颜色以外的编码。
 */
const LIGHT_PALETTE: ChartPalette = {
  success: '#0CA30C',
  failed: '#D03B3B',
  canceled: '#898781',
  active: '#2A78D6',
  prompt: '#2A78D6',
  completion: '#EB6834',
  grid: '#F0F0F0',
  axis: '#D9D9D9',
  text: 'rgba(0, 0, 0, 0.65)',
  surface: '#FFFFFF',
  durationRamp: ['#86B6EF', '#5598E7', '#2A78D6', '#1C5CAB', '#0D366B'],
};

const DARK_PALETTE: ChartPalette = {
  success: '#0CA30C',
  failed: '#D03B3B',
  canceled: '#898781',
  active: '#3987E5',
  prompt: '#3987E5',
  completion: '#D95926',
  grid: '#303030',
  axis: '#424242',
  text: 'rgba(255, 255, 255, 0.65)',
  surface: '#1D1D1D',
  durationRamp: ['#184F95', '#256ABF', '#3987E5', '#86B6EF', '#CDE2FB'],
};

export function chartPalette(theme: ChartTheme): ChartPalette {
  return theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}

/** 横轴标签：1 小时/6 小时看时分，24 小时/7 天看月日时分。 */
export function bucketLabel(start: number, step: number): string {
  return step >= 3_600_000 ? dayjs(start).format('MM-DD HH:mm') : dayjs(start).format('HH:mm');
}

const COMPACT_FORMATTER = new Intl.NumberFormat('zh-CN');

function trimDecimal(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

/** 中文数字缩写：≥1 万用「万」，≥1 亿用「亿」；其余加千分位。 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${trimDecimal(value / 1e8)}亿`;
  if (abs >= 1e4) return `${trimDecimal(value / 1e4)}万`;
  return COMPACT_FORMATTER.format(value);
}

export function formatFullNumber(value: number): string {
  return COMPACT_FORMATTER.format(value);
}

/** 毫秒耗时：毫秒本身、秒、分、时逐级切换，与列表页的耗时读法一致。 */
export function formatDuration(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return '-';
  if (millis < 1_000) return `${millis}ms`;
  const seconds = millis / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** 分母为 0 时没有比率可言，显示 `-` 而不是 0%。 */
export function formatRate(rate: number, denominator: number): string {
  if (!denominator) return '-';
  return `${(rate * 100).toFixed(1)}%`;
}

export const DURATION_CLASS_LABEL: Record<string, string> = {
  lt1s: '<1s',
  '1sTo5s': '1–5s',
  '5sTo30s': '5–30s',
  '30sTo2m': '30s–2m',
  gte2m: '≥2m',
};

const STATE_META: Record<string, { text: string; color: string }> = {
  ...ADMIN_RUN_STATE,
  interrupted: { text: '已中断', color: 'orange' },
};

export function runStateMeta(state: string | undefined): { text: string; color: string } {
  return STATE_META[state ?? ''] ?? { text: state || '-', color: 'default' };
}

export function runTriggerLabel(trigger: string | undefined): string {
  return ADMIN_RUN_TRIGGER[trigger ?? ''] ?? trigger ?? '-';
}

/** 仍在执行：pending/running。interrupted 已停在中途，不显示「进行中」。 */
export function isActiveState(state: string | undefined): boolean {
  return state === 'pending' || state === 'running';
}

/** 图例颜色，供 CSS 分布条使用。 */
export function statusSegments(
  summary: { succeeded: number; active: number; canceled: number; failed: number },
  palette: ChartPalette
): { key: string; label: string; value: number; color: string }[] {
  return [
    { key: 'succeeded', label: '成功', value: summary.succeeded, color: palette.success },
    { key: 'active', label: '活跃', value: summary.active, color: palette.active },
    { key: 'canceled', label: '已取消', value: summary.canceled, color: palette.canceled },
    { key: 'failed', label: '失败', value: summary.failed, color: palette.failed },
  ];
}
