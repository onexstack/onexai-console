import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, App, Button, Space, Tag, type TableColumnsType } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  ADMIN_RUN_TRIGGER,
  adminRunStateMeta,
  cancelAgentRun,
  isAdminRunRetryable,
  retryAgentRun,
  type AdminRun,
  type StuckRun,
} from '@/api/agentRuns';
import type { MonitorSummary } from '@/api/agentMonitor';
import {
  KpiCard,
  formatDuration,
  formatFullNumber,
  formatRate,
  type MonitorRangeKey,
} from '@/components/metrics';
import { formatDate, formatDurationMs } from '@/lib/date';
import {
  EllipsisText,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_ID_TEXT_MAX_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  ResponsiveTable,
} from '@/ui';
import { ListPagination } from '@/ui/components/Pagination';
import metricsStyles from '@/components/metrics/styles.module.scss';
import { FAILURE_PAGE_SIZE, useFailedRuns, useStuckRuns } from '../queries';
import styles from '../styles.module.scss';

const STUCK_REASON: Record<string, string> = {
  pending_timeout: '排队超时',
  lease_expired: '租约过期',
  running_timeout: '运行超时',
};

function stuckAnchor(run: StuckRun): number {
  return run.source === 'run' ? run.startedAt || run.createdAt : run.createdAt;
}

/**
 * 异常与失败。
 *
 * 两组失败数字刻意分开标注：明细表来自 admission 管理列表（只有异步任务），
 * 全平台失败数来自 run 监控（含交互式运行），两个口径本来就不同。
 */
export default function FailuresTab({
  summary,
  agent,
  range,
  page,
  autoRefresh,
  onPageChange,
}: {
  summary?: MonitorSummary;
  agent: string;
  range: MonitorRangeKey;
  page: number;
  autoRefresh: boolean;
  onPageChange: (page: number) => void;
}) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const failed = useFailedRuns({ range, agent, page, autoRefresh, enabled: true });
  const stuck = useStuckRuns({ agent, autoRefresh, enabled: true });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
    void queryClient.invalidateQueries({ queryKey: ['observability'] });
  };

  const cancel = useMutation({
    mutationFn: cancelAgentRun,
    onSuccess: () => {
      message.success('已提交取消');
      invalidate();
    },
    onError: error => message.error((error as Error).message),
  });

  const retry = useMutation({
    mutationFn: (id: string) => retryAgentRun(id),
    onSuccess: () => {
      message.success('已提交重试');
      invalidate();
    },
    onError: error => message.error((error as Error).message),
  });

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([failed.refetch(), stuck.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const failureColumns: TableColumnsType<AdminRun> = [
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 96,
      render: (state: string) => {
        const meta = adminRunStateMeta(state);
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: 'Run ID',
      dataIndex: 'id',
      key: 'id',
      width: RESOURCE_ID_COLUMN_WIDTH,
      render: (id: string) => (
        <EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH} title={id}>
          <Link to={`/async-tasks/${encodeURIComponent(id)}`}>{id}</Link>
        </EllipsisText>
      ),
    },
    {
      title: '智能体',
      dataIndex: 'agent',
      key: 'agent',
      render: (value: string) => (
        <EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH}>{value || '-'}</EllipsisText>
      ),
    },
    {
      title: '触发',
      dataIndex: 'trigger',
      key: 'trigger',
      width: 88,
      render: (trigger: string) => ADMIN_RUN_TRIGGER[trigger ?? ''] ?? trigger ?? '-',
    },
    {
      title: '耗时',
      key: 'duration',
      width: 96,
      render: (_value, row) => formatDurationMs(row.startedAt, row.finishedAt),
    },
    {
      title: '错误',
      dataIndex: 'error',
      key: 'error',
      render: (value?: string) => (
        <EllipsisText maxWidth={320} title={value || undefined}>
          {value || '-'}
        </EllipsisText>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (value?: number) => (value ? formatDate(value) : '-'),
    },
    {
      title: '操作',
      key: 'action',
      ...RESOURCE_ACTION_COLUMN,
      render: (_value, row) => (
        <Space size={8}>
          <Link to={`/async-tasks/${encodeURIComponent(row.id)}`}>
            <Button type="link" size="small" style={{ padding: 0 }}>
              详情
            </Button>
          </Link>
          {isAdminRunRetryable(row.state) ? (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() =>
                modal.confirm({
                  title: '重试这个任务？',
                  content: '会用原来的智能体和提示词创建一个新任务，原任务不会改变。',
                  okText: '确定',
                  cancelText: '取消',
                  onOk: () => retry.mutate(row.id),
                })
              }
            >
              重试
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const stuckColumns: TableColumnsType<StuckRun> = [
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      width: 110,
      render: (reason: string) => <Tag color="orange">{STUCK_REASON[reason] ?? reason}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 96,
      render: (state: string) => {
        const meta = adminRunStateMeta(state);
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 96,
      render: (source: string) => (source === 'run' ? '交互式' : '异步任务'),
    },
    {
      title: 'Run ID',
      dataIndex: 'id',
      key: 'id',
      width: RESOURCE_ID_COLUMN_WIDTH,
      render: (id: string, row) => (
        <EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH} title={id}>
          {row.source === 'run' ? (
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
      render: (value: string) => (
        <EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH}>{value || '-'}</EllipsisText>
      ),
    },
    {
      title: '已持续',
      key: 'age',
      width: 110,
      render: (_value, row) => formatDuration(Date.now() - stuckAnchor(row)),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (value: number) => (value ? formatDate(value) : '-'),
    },
    {
      title: '操作',
      key: 'action',
      ...RESOURCE_ACTION_COLUMN,
      render: (_value, row) => (
        <Space size={8}>
          {/* 交互式运行没有 admission：管理面的详情与 cancel 接口都不认它。 */}
          {row.source === 'admission' ? (
            <Link to={`/async-tasks/${encodeURIComponent(row.id)}`}>
              <Button type="link" size="small" style={{ padding: 0 }}>
                详情
              </Button>
            </Link>
          ) : null}
          {row.source === 'admission' ? (
            <Button
              type="link"
              size="small"
              danger
              style={{ padding: 0 }}
              onClick={() =>
                modal.confirm({
                  title: '取消这个任务？',
                  content: '运行中的智能体会被停止，已经产生的事件会保留。',
                  okText: '确定',
                  okButtonProps: { danger: true },
                  cancelText: '取消',
                  onOk: () => cancel.mutate(row.id),
                })
              }
            >
              取消
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const terminal = summary ? summary.succeeded + summary.failed + summary.canceled : 0;

  return (
    <>
      <div className={styles.sectionToolbar}>
        <span className={styles.sectionNote}>
          失败明细只来自异步任务管理面（按任务创建时间）；全平台失败数含交互式运行，两组数字口径不同。
        </span>
        <Button size="small" loading={refreshing} onClick={() => void refresh()}>
          刷新
        </Button>
      </div>

      <div className={metricsStyles.kpiGrid}>
        <KpiCard
          label="异步任务失败"
          value={failed.data ? formatFullNumber(failed.data.count) : '-'}
          hint="窗口内、按 admission 创建时间统计的失败任务数。"
        />
        <KpiCard
          label="全平台失败"
          value={summary ? formatFullNumber(summary.failed) : '-'}
          hint="run 监控口径：包含异步任务与控制台/chat 的交互式运行。"
        />
        <KpiCard
          label="卡住运行"
          value={stuck.data ? formatFullNumber(stuck.data.items.length) : '-'}
          hint="排队 >10min、运行 >60min 或租约过期；由服务端判定。"
        />
        <KpiCard
          label="全平台成功率"
          value={summary ? formatRate(summary.successRate, terminal) : '-'}
          hint="成功 ÷（成功 + 失败 + 已取消），等待/运行中不计入分母。"
        />
      </div>

      {failed.isError ? (
        <Alert
          type="error"
          showIcon
          message="失败明细加载失败"
          description={failed.error instanceof Error ? failed.error.message : '请稍后重试'}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <div className={styles.tableBlock}>
        <h3 className={styles.blockTitle}>异步任务失败明细</h3>
        <ResponsiveTable<AdminRun>
          rowKey="id"
          size="small"
          columns={failureColumns}
          dataSource={failed.data?.runs ?? []}
          loading={failed.isFetching && !failed.data}
          pagination={false}
          emptyText="所选窗口内没有失败的异步任务"
          {...RESOURCE_TABLE_LAYOUT}
        />
        <ListPagination
          total={failed.data?.count ?? 0}
          page={page}
          pageSize={FAILURE_PAGE_SIZE}
          onPageChange={onPageChange}
          onPageSizeChange={() => undefined}
          pageSizeOptions={[FAILURE_PAGE_SIZE]}
          hideOnSinglePage={false}
        />
      </div>

      <div className={styles.tableBlock}>
        <h3 className={styles.blockTitle}>卡住运行</h3>
        {stuck.isError ? (
          <Alert
            type="error"
            showIcon
            message="卡住运行加载失败"
            description={stuck.error instanceof Error ? stuck.error.message : '请稍后重试'}
          />
        ) : (
          <ResponsiveTable<StuckRun>
            rowKey="id"
            size="small"
            columns={stuckColumns}
            dataSource={stuck.data?.items ?? []}
            loading={stuck.isFetching && !stuck.data}
            pagination={false}
            emptyText="当前没有卡住的运行"
            {...RESOURCE_TABLE_LAYOUT}
          />
        )}
        {stuck.data ? (
          <p className={styles.sectionNote}>
            判定阈值：排队超过 {Math.round(stuck.data.thresholds.pendingMs / 60_000)} 分钟、运行超过{' '}
            {Math.round(stuck.data.thresholds.runningMs / 3_600_000)} 小时，或运行租约已过期。
          </p>
        ) : null}
      </div>
    </>
  );
}
