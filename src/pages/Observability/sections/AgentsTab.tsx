import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, Space, Tag, type TableColumnsType } from 'antd';

import type {
  AgentMonitorResponse,
  MonitorAgentSummary,
  MonitorDurationStats,
  MonitorTokenStats,
} from '@/api/agentMonitor';
import type { PlatformAgent } from '@/api/types';
import MonitorDrawer from '@/components/AgentMonitorDrawer';
import { agentKind, stateOf } from '@/components/agents/meta';
import { formatCompactNumber, formatDuration, formatRate } from '@/components/metrics';
import { formatDate } from '@/lib/date';
import {
  EllipsisText,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_ID_TEXT_MAX_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  ResponsiveTable,
} from '@/ui';
import styles from '../styles.module.scss';

const EMPTY_DURATION: MonitorDurationStats = {
  avgMs: 0,
  p95Ms: 0,
  maxMs: 0,
  samples: 0,
};

const EMPTY_TOKENS: MonitorTokenStats = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  cacheWriteTokens: 0,
  cacheHitRate: 0,
  calls: 0,
  runsWithUsage: 0,
};

type AgentHealthRow = MonitorAgentSummary & {
  /** 表格行 key：历史数据里可能有 agent 为空的运行，空字符串不能当 key。 */
  key: string;
  displayName?: string;
  resource?: PlatformAgent;
};

const KIND_LABEL: Record<string, string> = {
  native: '平台',
  external: 'A2A',
};

function healthRow(
  name: string,
  summary: MonitorAgentSummary | undefined,
  resource: PlatformAgent | undefined
): AgentHealthRow {
  return {
    agent: name,
    key: name || '__unknown__',
    displayName: resource?.displayName,
    resource,
    total: summary?.total ?? 0,
    succeeded: summary?.succeeded ?? 0,
    failed: summary?.failed ?? 0,
    canceled: summary?.canceled ?? 0,
    active: summary?.active ?? 0,
    successRate: summary?.successRate ?? 0,
    duration: summary?.duration ?? EMPTY_DURATION,
    tokens: summary?.tokens ?? EMPTY_TOKENS,
    lastRunAt: summary?.lastRunAt ?? 0,
  };
}

/**
 * 智能体健康：以资源目录为全集、左连接窗口内的运行汇总。
 *
 * 这样「配了但从未运行」的智能体也会出现（全 0 行），而不是从健康视图里
 * 消失；已被删除但仍有历史运行的智能体也会保留一行，并标记资源缺失。
 */
export default function AgentsTab({
  data,
  agents,
  agentFilter,
}: {
  data: AgentMonitorResponse;
  agents: PlatformAgent[];
  agentFilter: string;
}) {
  const [monitorRow, setMonitorRow] = useState<AgentHealthRow | null>(null);

  const rows = useMemo(() => {
    const summaryByName = new Map(data.agents.map(item => [item.agent, item]));
    const resourceByName = new Map(agents.map(item => [item.name, item]));
    const names = new Set<string>([...agents.map(item => item.name), ...summaryByName.keys()]);
    return [...names]
      .filter(name => !agentFilter || name === agentFilter)
      .map(name => healthRow(name, summaryByName.get(name), resourceByName.get(name)));
  }, [agents, agentFilter, data.agents]);

  const columns: TableColumnsType<AgentHealthRow> = [
    {
      title: '智能体',
      dataIndex: 'agent',
      key: 'agent',
      width: RESOURCE_ID_COLUMN_WIDTH,
      render: (_value, row) => {
        const display = row.displayName || row.agent || '未知智能体';
        return (
          <div className={styles.agentCell}>
            <EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH} title={display}>
              <span className={styles.agentName}>{display}</span>
            </EllipsisText>
            {row.displayName && row.agent ? (
              <span className={styles.agentId}>{row.agent}</span>
            ) : null}
          </div>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (_value, row) => {
        if (!row.resource) return <Tag>资源缺失</Tag>;
        const kind = agentKind(row.resource);
        const state = stateOf(row.resource);
        const phase = row.resource.a2a?.phase;
        return (
          <Space size={4} wrap>
            <Tag>{KIND_LABEL[kind] ?? kind}</Tag>
            <Tag color={state.color}>{state.text}</Tag>
            {phase ? <Tag color="blue">{phase}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '运行数',
      dataIndex: 'total',
      key: 'total',
      width: 88,
      sorter: (a, b) => a.total - b.total,
      defaultSortOrder: 'descend',
    },
    {
      title: '成功率',
      key: 'successRate',
      width: 96,
      sorter: (a, b) => a.successRate - b.successRate,
      render: (_value, row) => {
        const terminal = row.succeeded + row.failed + row.canceled;
        return terminal > 0 ? formatRate(row.successRate, terminal) : '-';
      },
    },
    {
      title: 'P95 耗时',
      key: 'p95',
      width: 110,
      sorter: (a, b) => a.duration.p95Ms - b.duration.p95Ms,
      render: (_value, row) =>
        row.duration.samples > 0 ? formatDuration(row.duration.p95Ms) : '-',
    },
    {
      title: '平均耗时',
      key: 'avg',
      width: 110,
      sorter: (a, b) => a.duration.avgMs - b.duration.avgMs,
      render: (_value, row) =>
        row.duration.samples > 0 ? formatDuration(row.duration.avgMs) : '-',
    },
    {
      title: '失败',
      dataIndex: 'failed',
      key: 'failed',
      width: 80,
      sorter: (a, b) => a.failed - b.failed,
    },
    {
      title: '活跃',
      dataIndex: 'active',
      key: 'active',
      width: 80,
    },
    {
      title: 'Token',
      key: 'tokens',
      width: 110,
      sorter: (a, b) => a.tokens.totalTokens - b.tokens.totalTokens,
      render: (_value, row) =>
        row.tokens.totalTokens > 0 ? formatCompactNumber(row.tokens.totalTokens) : '-',
    },
    {
      title: '最近运行',
      dataIndex: 'lastRunAt',
      key: 'lastRunAt',
      width: 170,
      sorter: (a, b) => a.lastRunAt - b.lastRunAt,
      render: (lastRunAt: number) => (lastRunAt > 0 ? formatDate(lastRunAt) : '-'),
    },
    {
      title: '操作',
      key: 'action',
      ...RESOURCE_ACTION_COLUMN,
      render: (_value, row) => (
        <Space size={8}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            disabled={!row.agent}
            onClick={() => setMonitorRow(row)}
          >
            监控
          </Button>
          <Link
            to={row.agent ? `/async-tasks?agent=${encodeURIComponent(row.agent)}` : '/async-tasks'}
          >
            <Button type="link" size="small" style={{ padding: 0 }}>
              运行记录
            </Button>
          </Link>
        </Space>
      ),
    },
  ];

  return (
    <>
      <p className={styles.sectionNote}>
        以智能体目录为全集，运行数据来自窗口内最新样本；没有运行的智能体显示为
        0，资源已删除但仍有历史的智能体会标记「资源缺失」。
      </p>

      <ResponsiveTable<AgentHealthRow>
        rowKey="key"
        idKey="key"
        nameField="displayName"
        size="middle"
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, showSizeChanger: false, size: 'small' }}
        emptyText="还没有可展示的智能体"
        {...RESOURCE_TABLE_LAYOUT}
      />

      <MonitorDrawer
        open={monitorRow !== null}
        agentName={monitorRow?.agent ?? ''}
        agent={monitorRow?.resource}
        onClose={() => setMonitorRow(null)}
      />
    </>
  );
}
