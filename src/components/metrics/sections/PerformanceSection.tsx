import { useMemo } from 'react';

import type { AgentMonitorResponse } from '@/api/agentMonitor';
import { durationDistributionOption, durationTrendOption } from '../chartOptions';
import { ChartCard, ChartHost, KpiCard, EmptyBlock } from '../components';
import { formatDuration, formatFullNumber, type ChartTheme } from '../format';
import SlowRunList from '../SlowRunList';
import styles from '../styles.module.scss';

export default function PerformanceSection({
  data,
  theme,
}: {
  data: AgentMonitorResponse;
  theme: ChartTheme;
}) {
  const duration = data.summary.duration;
  const slowRuns = data.topSlowRuns;
  const trendOption = useMemo(() => durationTrendOption(data, theme), [data, theme]);
  const distributionOption = useMemo(
    () => durationDistributionOption(data.durationDistribution, theme),
    [data.durationDistribution, theme]
  );

  return (
    <>
      <div className={styles.kpiGrid}>
        <KpiCard label="平均耗时" value={duration.samples ? formatDuration(duration.avgMs) : '-'} />
        <KpiCard
          label="P95 耗时"
          value={duration.samples ? formatDuration(duration.p95Ms) : '-'}
          hint="最近秩法（nearest-rank），不插值：样本足够多时表示 95% 的运行不超过该耗时。"
        />
        <KpiCard label="最长耗时" value={duration.samples ? formatDuration(duration.maxMs) : '-'} />
        <KpiCard
          label="耗时样本"
          value={formatFullNumber(duration.samples)}
          hint="有完整开始与结束时间的终态运行数；等待中的任务没有耗时。"
        />
      </div>

      <div className={styles.chartGrid}>
        <ChartCard
          title="耗时趋势"
          hint="每个时间桶内终态运行的平均与 P95 耗时；没有样本的桶留空，不按 0 处理。"
        >
          {duration.samples > 0 ? (
            <ChartHost
              option={trendOption}
              height={260}
              ariaLabel="按时间分桶的平均耗时与 P95 耗时折线"
            />
          ) : (
            <EmptyBlock description="所选范围内没有可统计的耗时" />
          )}
        </ChartCard>

        <div className={styles.sideStack}>
          <ChartCard title="耗时分布" hint="按终态运行的耗时区间计数。">
            {duration.samples > 0 ? (
              <ChartHost
                option={distributionOption}
                height={220}
                ariaLabel="运行耗时区间分布柱状图"
              />
            ) : (
              <EmptyBlock description="暂无可统计的耗时样本" />
            )}
          </ChartCard>

          <ChartCard title="最慢运行 Top 5" hint="按单次运行耗时降序。">
            {slowRuns.length === 0 ? (
              <EmptyBlock description="所选范围内没有可统计的耗时" />
            ) : (
              <SlowRunList runs={slowRuns} />
            )}
          </ChartCard>
        </div>
      </div>
    </>
  );
}
