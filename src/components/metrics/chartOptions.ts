import type { EChartsCoreOption } from 'echarts/core';

import type {
  AgentMonitorResponse,
  MonitorDurationBucket,
  MonitorRunSummary,
} from '@/api/agentMonitor';
import {
  bucketLabel,
  chartPalette,
  DURATION_CLASS_LABEL,
  formatDuration,
  formatFullNumber,
  type ChartPalette,
  type ChartTheme,
} from './format';

/**
 * 图表配置只做「数据 → option」的纯映射。
 *
 * 组件层不拼 ECharts 细节，主题切换时重建 option 即可；同一份数据在
 * light/dark 下的形状完全一致，只是取色不同。
 */

interface AxisTooltipParam {
  seriesName?: string;
  value?: number | null;
  marker?: string;
  name?: string;
}

function baseOption(theme: ChartTheme): {
  palette: ChartPalette;
  textStyle: { color: string };
  grid: Record<string, unknown>;
} {
  const palette = chartPalette(theme);
  return {
    palette,
    textStyle: { color: palette.text },
    grid: { left: 8, right: 16, top: 28, bottom: 44, containLabel: true },
  };
}

function categoryAxis(labels: string[], palette: ChartPalette) {
  return {
    type: 'category' as const,
    data: labels,
    axisLine: { lineStyle: { color: palette.axis } },
    axisTick: { show: false },
    axisLabel: { color: palette.text, hideOverlap: true },
  };
}

function valueAxis(palette: ChartPalette, formatter?: (value: number) => string) {
  return {
    type: 'value' as const,
    minInterval: 1,
    splitLine: { lineStyle: { color: palette.grid } },
    axisLabel: { color: palette.text, formatter },
  };
}

function compactTooltip(params: unknown): string {
  const rows = params as AxisTooltipParam[];
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const title = rows[0]?.name ?? '';
  const lines = rows
    .filter(row => typeof row.value === 'number' && row.value > 0)
    .map(row => `${row.marker ?? ''}${row.seriesName ?? ''}: ${row.value}`);
  return [title, ...lines].join('<br/>');
}

function durationTooltip(params: unknown): string {
  const rows = params as AxisTooltipParam[];
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const title = rows[0]?.name ?? '';
  const lines = rows
    .filter(row => typeof row.value === 'number' && row.value > 0)
    .map(row => `${row.marker ?? ''}${row.seriesName ?? ''}: ${formatDuration(row.value ?? 0)}`);
  return [title, ...lines].join('<br/>');
}

export function runTrendOption(data: AgentMonitorResponse, theme: ChartTheme): EChartsCoreOption {
  const { palette, grid } = baseOption(theme);
  const labels = data.buckets.map(bucket => bucketLabel(bucket.start, data.step));
  return {
    aria: { enabled: true },
    animationDuration: 300,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: compactTooltip },
    legend: {
      bottom: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.text },
    },
    grid,
    xAxis: categoryAxis(labels, palette),
    yAxis: valueAxis(palette),
    series: [
      {
        name: '成功',
        type: 'bar',
        stack: 'runs',
        barMaxWidth: 24,
        itemStyle: { color: palette.success, borderColor: palette.surface, borderWidth: 1 },
        data: data.buckets.map(bucket => bucket.succeeded),
      },
      {
        name: '活跃',
        type: 'bar',
        stack: 'runs',
        barMaxWidth: 24,
        itemStyle: { color: palette.active, borderColor: palette.surface, borderWidth: 1 },
        data: data.buckets.map(bucket => bucket.active),
      },
      {
        name: '已取消',
        type: 'bar',
        stack: 'runs',
        barMaxWidth: 24,
        itemStyle: { color: palette.canceled, borderColor: palette.surface, borderWidth: 1 },
        data: data.buckets.map(bucket => bucket.canceled),
      },
      {
        name: '失败',
        type: 'bar',
        stack: 'runs',
        barMaxWidth: 24,
        itemStyle: {
          color: palette.failed,
          borderColor: palette.surface,
          borderWidth: 1,
          borderRadius: [3, 3, 0, 0],
        },
        data: data.buckets.map(bucket => bucket.failed),
      },
    ],
  };
}

export function durationTrendOption(
  data: AgentMonitorResponse,
  theme: ChartTheme
): EChartsCoreOption {
  const { palette, grid } = baseOption(theme);
  const labels = data.buckets.map(bucket => bucketLabel(bucket.start, data.step));
  // 空桶不要画成 0ms：那会被读成「这次运行瞬间完成」。null + connectNulls=false
  // 让折线在无样本处断开。
  const withSamples = (pick: (bucket: (typeof data.buckets)[number]) => number) =>
    data.buckets.map(bucket => (bucket.durationSamples > 0 ? pick(bucket) : null));
  return {
    aria: { enabled: true },
    animationDuration: 300,
    tooltip: { trigger: 'axis', formatter: durationTooltip },
    legend: {
      bottom: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.text },
    },
    grid,
    xAxis: categoryAxis(labels, palette),
    yAxis: valueAxis(palette, value => formatDuration(value)),
    series: [
      {
        name: '平均耗时',
        type: 'line',
        symbol: 'none',
        connectNulls: false,
        lineStyle: { width: 2, color: palette.prompt },
        itemStyle: { color: palette.prompt },
        data: withSamples(bucket => bucket.avgMs),
      },
      {
        name: 'P95 耗时',
        type: 'line',
        symbol: 'none',
        connectNulls: false,
        lineStyle: { width: 2, color: palette.completion },
        itemStyle: { color: palette.completion },
        data: withSamples(bucket => bucket.p95Ms),
      },
    ],
  };
}

export function durationDistributionOption(
  distribution: MonitorDurationBucket[],
  theme: ChartTheme
): EChartsCoreOption {
  const { palette, grid } = baseOption(theme);
  return {
    aria: { enabled: true },
    animationDuration: 300,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: compactTooltip },
    grid: { ...grid, bottom: 16 },
    xAxis: categoryAxis(
      distribution.map(item => DURATION_CLASS_LABEL[item.key] ?? item.key),
      palette
    ),
    yAxis: valueAxis(palette),
    series: [
      {
        name: '运行数',
        type: 'bar',
        barMaxWidth: 32,
        label: { show: true, position: 'top', color: palette.text },
        data: distribution.map((item, index) => ({
          value: item.count,
          itemStyle: {
            color: palette.durationRamp[Math.min(index, palette.durationRamp.length - 1)],
          },
        })),
      },
    ],
  };
}

export function tokenTrendOption(data: AgentMonitorResponse, theme: ChartTheme): EChartsCoreOption {
  const { palette, grid } = baseOption(theme);
  const labels = data.buckets.map(bucket => bucketLabel(bucket.start, data.step));
  return {
    aria: { enabled: true },
    animationDuration: 300,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: compactTooltip },
    legend: {
      bottom: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.text },
    },
    grid,
    xAxis: categoryAxis(labels, palette),
    yAxis: valueAxis(palette, value => formatFullNumber(value)),
    series: [
      {
        name: 'Prompt',
        type: 'bar',
        stack: 'tokens',
        barMaxWidth: 24,
        itemStyle: { color: palette.prompt, borderColor: palette.surface, borderWidth: 1 },
        data: data.buckets.map(bucket => bucket.promptTokens),
      },
      {
        name: 'Completion',
        type: 'bar',
        stack: 'tokens',
        barMaxWidth: 24,
        itemStyle: {
          color: palette.completion,
          borderColor: palette.surface,
          borderWidth: 1,
          borderRadius: [3, 3, 0, 0],
        },
        data: data.buckets.map(bucket => bucket.completionTokens),
      },
    ],
  };
}

/**
 * 失败率趋势：每个时间桶的失败 ÷（成功 + 失败 + 已取消）。
 *
 * 没有终态运行的桶用 null 断开，而不是画成 0%——0% 会被读成「这段时间
 * 一次失败都没有」，实际上可能是「这段时间根本没有运行」。
 */
export function failureRateOption(
  data: AgentMonitorResponse,
  theme: ChartTheme
): EChartsCoreOption {
  const { palette, grid } = baseOption(theme);
  const labels = data.buckets.map(bucket => bucketLabel(bucket.start, data.step));
  const rates = data.buckets.map(bucket => {
    const terminal = bucket.succeeded + bucket.failed + bucket.canceled;
    return terminal > 0 ? Number(((bucket.failed / terminal) * 100).toFixed(2)) : null;
  });
  return {
    aria: { enabled: true },
    animationDuration: 300,
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const rows = params as AxisTooltipParam[];
        if (!Array.isArray(rows) || rows.length === 0) return '';
        const title = rows[0]?.name ?? '';
        const value = rows[0]?.value;
        return typeof value === 'number'
          ? `${title}<br/>失败率: ${value}%`
          : `${title}<br/>无终态运行`;
      },
    },
    grid,
    xAxis: categoryAxis(labels, palette),
    yAxis: valueAxis(palette, value => `${value}%`),
    series: [
      {
        name: '失败率',
        type: 'line',
        symbol: 'none',
        connectNulls: false,
        lineStyle: { width: 2, color: palette.failed },
        itemStyle: { color: palette.failed },
        areaStyle: { color: 'rgba(208, 59, 59, 0.12)' },
        data: rates,
      },
    ],
  };
}

export function slowRunRatio(run: MonitorRunSummary, runs: MonitorRunSummary[]): number {
  const max = runs.reduce((value, item) => Math.max(value, item.durationMs), 0);
  return max > 0 ? Math.max(0.02, run.durationMs / max) : 0;
}
