import { useMemo } from 'react';

import type { AgentMonitorResponse } from '@/api/agentMonitor';
import {
  ChartCard,
  EmptyBlock,
  OverviewSection,
  RankBars,
  SlowRunList,
  type ChartTheme,
} from '@/components/metrics';
import metricsStyles from '@/components/metrics/styles.module.scss';

/**
 * 观测总览：直接复用单智能体抽屉的总览（KPI/趋势/状态/触发），再追加
 * 全平台才有的「智能体运行 Top」与带归属的最慢运行。
 */
export default function OverviewTab({
  data,
  theme,
}: {
  data: AgentMonitorResponse;
  theme: ChartTheme;
}) {
  const topAgents = useMemo(
    () =>
      data.agents.slice(0, 10).map(item => ({
        key: item.agent || '__unknown__',
        label: item.agent || '未知智能体',
        value: item.total,
      })),
    [data.agents]
  );

  return (
    <>
      <OverviewSection data={data} theme={theme} />

      <div className={metricsStyles.chartGrid}>
        <ChartCard title="智能体运行 Top" hint="按窗口内运行量倒序，最多展示 10 个。">
          <RankBars items={topAgents} emptyText="窗口内没有运行" />
        </ChartCard>

        <ChartCard title="最慢运行 Top 5" hint="按单次运行耗时降序；副行显示归属智能体。">
          {data.topSlowRuns.length === 0 ? (
            <EmptyBlock description="所选范围内没有可统计的耗时" />
          ) : (
            <SlowRunList runs={data.topSlowRuns} showAgent />
          )}
        </ChartCard>
      </div>
    </>
  );
}
