import { useMemo } from 'react';
import { Link } from 'react-router';
import { Tag, type TableColumnsType } from 'antd';

import type { AgentMonitorResponse, MonitorRunSummary } from '@/api/agentMonitor';
import {
  ChartCard,
  ChartHost,
  PerformanceSection,
  failureRateOption,
  formatCompactNumber,
  formatDuration,
  isActiveState,
  runStateMeta,
  runTriggerLabel,
  type ChartTheme,
} from '@/components/metrics';
import { formatDate } from '@/lib/date';
import {
  EllipsisText,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_ID_TEXT_MAX_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  ResponsiveTable,
} from '@/ui';
import styles from '../styles.module.scss';

const SOURCE_LABEL: Record<string, string> = {
  admission: '异步任务',
  run: '交互式',
};

const columns: TableColumnsType<MonitorRunSummary> = [
  {
    title: '状态',
    dataIndex: 'state',
    key: 'state',
    width: 96,
    render: (state: string) => {
      const meta = runStateMeta(state);
      return <Tag color={meta.color}>{meta.text}</Tag>;
    },
  },
  {
    title: 'Run ID',
    dataIndex: 'id',
    key: 'id',
    width: RESOURCE_ID_COLUMN_WIDTH,
    render: (id: string, run) => (
      <EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH} title={id}>
        {run.source === 'run' ? (
          id
        ) : (
          <Link to={`/async-tasks/${encodeURIComponent(id)}`}>{id}</Link>
        )}
      </EllipsisText>
    ),
  },
  {
    title: '智能体',
    dataIndex: 'agent',
    key: 'agent',
    render: (agent: string) => (
      <EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH}>{agent || '-'}</EllipsisText>
    ),
  },
  {
    title: '来源',
    dataIndex: 'source',
    key: 'source',
    width: 96,
    render: (source: string) => SOURCE_LABEL[source] ?? source ?? '-',
  },
  {
    title: '触发',
    dataIndex: 'trigger',
    key: 'trigger',
    width: 88,
    render: (trigger: string) => runTriggerLabel(trigger),
  },
  {
    title: '耗时',
    dataIndex: 'durationMs',
    key: 'duration',
    width: 96,
    render: (duration: number, run) =>
      duration > 0 ? formatDuration(duration) : isActiveState(run.state) ? '进行中' : '-',
  },
  {
    title: 'Token',
    dataIndex: 'totalTokens',
    key: 'totalTokens',
    width: 96,
    render: (tokens: number) => (tokens > 0 ? formatCompactNumber(tokens) : '-'),
  },
  {
    title: '开始时间',
    dataIndex: 'startedAt',
    key: 'startedAt',
    width: 170,
    render: (startedAt: number) => (startedAt > 0 ? formatDate(startedAt) : '-'),
  },
];

/**
 * 运行分析：复用抽屉的性能耗时页，追加失败率趋势与跨智能体的最近运行。
 */
export default function RunsTab({
  data,
  theme,
}: {
  data: AgentMonitorResponse;
  theme: ChartTheme;
}) {
  const failureOption = useMemo(() => failureRateOption(data, theme), [data, theme]);

  return (
    <div className={styles.stack}>
      <PerformanceSection data={data} theme={theme} />

      <ChartCard
        title="失败率趋势"
        hint="每个时间桶的失败 ÷（成功 + 失败 + 已取消）；没有终态运行的桶留空。"
      >
        <ChartHost option={failureOption} height={240} ariaLabel="按时间分桶的失败率折线" />
      </ChartCard>

      <ChartCard title="最近运行" hint="按创建时间倒序；交互式运行也会计入。">
        <ResponsiveTable<MonitorRunSummary>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={data.recentRuns}
          pagination={false}
          emptyText="所选时间范围内暂无运行记录"
          {...RESOURCE_TABLE_LAYOUT}
        />
      </ChartCard>
    </div>
  );
}
