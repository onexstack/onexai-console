import { useMemo } from 'react';

import type { AgentMonitorResponse } from '@/api/agentMonitor';
import { runTrendOption } from '../chartOptions';
import {
  ChartCard,
  ChartHost,
  KpiCard,
  MeterLegend,
  RankBars,
  SegmentedMeter,
} from '../components';
import {
  chartPalette,
  formatDuration,
  formatFullNumber,
  formatRate,
  runTriggerLabel,
  statusSegments,
  type ChartTheme,
} from '../format';
import styles from '../styles.module.scss';

export default function OverviewSection({
  data,
  theme,
}: {
  data: AgentMonitorResponse;
  theme: ChartTheme;
}) {
  const palette = chartPalette(theme);
  const summary = data.summary;
  const segments = statusSegments(summary, palette);
  const triggers = useMemo(
    () =>
      data.triggers.map(item => ({
        key: item.trigger,
        label: runTriggerLabel(item.trigger),
        value: item.count,
      })),
    [data.triggers]
  );
  const trendOption = useMemo(() => runTrendOption(data, theme), [data, theme]);

  return (
    <>
      <div className={styles.kpiGrid}>
        <KpiCard label="总运行数" value={formatFullNumber(summary.total)} />
        <KpiCard
          label="成功率"
          value={formatRate(
            summary.successRate,
            summary.succeeded + summary.failed + summary.canceled
          )}
          hint="成功 ÷（成功 + 失败 + 已取消）。等待中、运行中的任务不计入分母。"
        />
        <KpiCard label="成功" value={summary.succeeded} />
        <KpiCard
          label="失败"
          value={summary.failed}
          hint="运行终态为失败的数量；已取消单独计数。"
        />
        <KpiCard label="活跃" value={summary.active} hint="等待中、运行中或已中断的运行数。" />
        <KpiCard
          label="平均耗时"
          value={summary.duration.samples ? formatDuration(summary.duration.avgMs) : '-'}
          hint="只统计有开始和结束时间的终态运行。"
        />
      </div>

      <div className={styles.chartGrid}>
        <ChartCard title="运行趋势" hint="按运行创建时间分桶；堆叠高度为运行数，颜色区分终态。">
          <ChartHost
            option={trendOption}
            height={260}
            ariaLabel="按时间分桶的运行成功、活跃、已取消、失败数量"
          />
        </ChartCard>

        <div className={styles.sideStack}>
          <ChartCard title="状态分布" hint="所选时间范围内各终态与活跃运行的占比。">
            <SegmentedMeter segments={segments} />
            <MeterLegend segments={segments} total={summary.total} />
          </ChartCard>
          <ChartCard title="触发方式" hint="按运行来源统计，定时触发含计划任务。">
            <RankBars items={triggers} />
          </ChartCard>
        </div>
      </div>
    </>
  );
}
