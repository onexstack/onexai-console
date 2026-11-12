import { useMemo } from 'react';
import type { TableColumnsType } from 'antd';

import type { AgentMonitorResponse, MonitorAgentSummary } from '@/api/agentMonitor';
import {
  ChartCard,
  RankBars,
  TokenSection,
  formatCompactNumber,
  formatFullNumber,
  formatRate,
  type ChartTheme,
} from '@/components/metrics';
import { RESOURCE_TABLE_LAYOUT, ResponsiveTable } from '@/ui';
import styles from '../styles.module.scss';

type TokenRow = MonitorAgentSummary & { key: string };

const columns: TableColumnsType<TokenRow> = [
  {
    title: '智能体',
    dataIndex: 'agent',
    key: 'agent',
    render: (agent: string) => agent || '未知智能体',
  },
  {
    title: '运行数',
    dataIndex: 'total',
    key: 'total',
    width: 88,
  },
  {
    title: '总 Token',
    dataIndex: ['tokens', 'totalTokens'],
    key: 'totalTokens',
    width: 110,
    render: (tokens: number) => formatCompactNumber(tokens),
  },
  {
    title: 'Prompt',
    dataIndex: ['tokens', 'promptTokens'],
    key: 'promptTokens',
    width: 110,
    render: (tokens: number) => formatCompactNumber(tokens),
  },
  {
    title: 'Completion',
    dataIndex: ['tokens', 'completionTokens'],
    key: 'completionTokens',
    width: 110,
    render: (tokens: number) => formatCompactNumber(tokens),
  },
  {
    title: '缓存命中率',
    key: 'cacheHitRate',
    width: 110,
    render: (_value, row) => {
      const total = row.tokens.cacheHitTokens + row.tokens.cacheMissTokens;
      return total > 0 ? formatRate(row.tokens.cacheHitRate, total) : '-';
    },
  },
  {
    title: '模型调用',
    dataIndex: ['tokens', 'calls'],
    key: 'calls',
    width: 96,
    render: (calls: number) => formatFullNumber(calls),
  },
];

/**
 * Token 用量：复用抽屉的 Token 页，追加跨智能体的 Token 排行与明细。
 */
export default function TokensTab({
  data,
  theme,
}: {
  data: AgentMonitorResponse;
  theme: ChartTheme;
}) {
  const rows = useMemo<TokenRow[]>(
    () => data.agents.map(item => ({ ...item, key: item.agent || '__unknown__' })),
    [data.agents]
  );

  const ranking = useMemo(
    () =>
      [...data.agents]
        .sort((a, b) => b.tokens.totalTokens - a.tokens.totalTokens)
        .slice(0, 10)
        .map(item => ({
          key: item.agent || '__unknown__',
          label: item.agent || '未知智能体',
          value: item.tokens.totalTokens,
        })),
    [data.agents]
  );

  return (
    <div className={styles.stack}>
      <TokenSection data={data} theme={theme} />

      <ChartCard title="智能体 Token 排行" hint="按窗口内总 Token 倒序，最多展示 10 个。">
        <RankBars items={ranking} emptyText="窗口内没有上报 Token 的运行" />
      </ChartCard>

      <ChartCard
        title="Token 明细"
        hint="每个智能体的 Prompt / Completion / 缓存命中与模型调用次数。"
      >
        <ResponsiveTable<TokenRow>
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, showSizeChanger: false, size: 'small' }}
          emptyText="窗口内没有上报 Token 的运行"
          {...RESOURCE_TABLE_LAYOUT}
        />
      </ChartCard>
    </div>
  );
}
