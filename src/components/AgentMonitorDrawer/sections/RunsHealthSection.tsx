import { Link } from 'react-router';
import { Alert, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import type { AgentMonitorResponse, MonitorRunSummary } from '@/api/agentMonitor';
import type { PlatformAgent } from '@/api/types';
import { agentKind, executionModeOf, stateOf } from '@/components/agents/meta';
import {
  EmptyBlock,
  formatDuration,
  isActiveState,
  runStateMeta,
  runTriggerLabel,
} from '@/components/metrics';
import CopyButton from '@/ui/components/CopyButton';
import { InfoSection, type InfoItem } from '@/ui';
import { formatDate } from '@/lib/date';
import styles from '../styles.module.scss';

const RUN_COLUMNS: ColumnsType<MonitorRunSummary> = [
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
    ellipsis: true,
    render: (id: string, run) => (
      <span className={styles.runIdCell}>
        {/* 交互式运行没有 admission，管理面的异步任务详情打不开它。 */}
        {run.source === 'run' ? (
          <span className={styles.runId} title={id}>
            {id}
          </span>
        ) : (
          <Link to={`/async-tasks/${encodeURIComponent(id)}`} className={styles.runId} title={id}>
            {id}
          </Link>
        )}
        <CopyButton value={id} ariaLabel="复制 Run ID" />
      </span>
    ),
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
    title: '开始时间',
    dataIndex: 'startedAt',
    key: 'startedAt',
    width: 170,
    render: (startedAt: number) => (startedAt > 0 ? formatDate(startedAt) : '-'),
  },
];

function healthItems(agent: PlatformAgent | undefined): InfoItem[] {
  if (!agent) {
    return [{ label: '资源信息', value: '未找到该智能体（监控数据仍按名称查询）', span: 2 }];
  }
  const state = stateOf(agent);
  const execution = executionModeOf(agent);
  const kind = agentKind(agent);
  const skillCount = agent.skillCount ?? agent.a2a?.skills?.length ?? agent.skillNames?.length ?? 0;
  const syncError = agent.a2a?.lastSyncError;
  return [
    { label: '启用状态', value: <Tag color={state.color}>{state.text}</Tag> },
    {
      label: '类型',
      value: kind === 'external' ? 'A2A 智能体' : '平台智能体',
    },
    {
      // 与列表、详情页同一套文案与颜色，见 `executionModeOf`。
      label: '执行方式',
      value: (
        <Tooltip title={execution.tooltip}>
          <Tag color={execution.color}>{execution.text}</Tag>
        </Tooltip>
      ),
    },
    { label: '模型', value: agent.model?.name || agent.resolvedModel || '-' },
    { label: '命名空间', value: agent.namespace || '-' },
    { label: 'A2A 阶段', value: agent.a2a?.phase ?? agent.phase ?? '-' },
    { label: '技能数', value: skillCount },
    { label: '更新时间', value: agent.updatedAt ? formatDate(agent.updatedAt) : '-' },
    {
      label: '最近同步错误',
      span: 2,
      value: syncError ? (
        <Tooltip title={syncError}>
          <span className={styles.errorText}>{syncError}</span>
        </Tooltip>
      ) : (
        '-'
      ),
    },
  ];
}

export default function RunsHealthSection({
  data,
  agent,
}: {
  data: AgentMonitorResponse;
  agent?: PlatformAgent;
}) {
  return (
    <div className={styles.runsHealth}>
      <div className={styles.healthCard}>
        {agent ? null : (
          <Alert
            type="info"
            showIcon
            message="未找到该智能体的资源信息"
            description="它可能已被删除或改名；监控数据仍按名称查询，历史运行记录不受影响。"
            style={{ marginBottom: 16 }}
          />
        )}
        <InfoSection title="智能体健康" items={healthItems(agent)} />
      </div>

      <div className={styles.healthCard}>
        <div className={styles.tableHead}>
          <h3 className={styles.sectionTitle}>最近运行</h3>
          <span className={styles.sectionDescription}>
            共 {data.summary.total} 条，按创建时间倒序
          </span>
        </div>
        {data.recentRuns.length === 0 ? (
          <EmptyBlock description="所选时间范围内暂无运行记录" />
        ) : (
          <Table<MonitorRunSummary>
            rowKey="id"
            size="small"
            columns={RUN_COLUMNS}
            dataSource={data.recentRuns}
            pagination={false}
            scroll={{ x: 640 }}
          />
        )}
      </div>
    </div>
  );
}
