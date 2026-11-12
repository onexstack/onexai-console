import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, App, Button, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ADMIN_RUN_STATE,
  ADMIN_RUN_TRIGGER,
  adminRunStateMeta,
  cancelAgentRun,
  isAdminRunActive,
  isAdminRunRetryable,
  listAgentRuns,
  retryAgentRun,
  type AdminRun,
} from '@/api/agentRuns';
import { ApiError } from '@/api/client';
import { fetchAllRows, resourceRowsQueryKey } from '@/api/resourceDefs';
import { OptionLabel } from '@/components/OptionLabel';
import { matchOptionText, normalizeOptionDescription } from '@/components/OptionLabel/helpers';
import { formatDate, formatDurationMs } from '@/lib/date';
import {
  EllipsisText,
  MoreActions,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  ValueWithActions,
} from '@/ui';
import { ListPagination } from '@/ui/components/Pagination';
import { ResourceCard, ResourceShell } from '@/ui/components/ResourceShell';

const PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/**
 * 异步任务：面向 agent 的后台执行记录。
 *
 * 数据源是管理面 `/v1/admin/agent/runs`（run_admission 为主表）。它与「定时任务」
 * 是两层：定时任务是一条调度定义，每次触发产生一个异步任务；手动触发、外部
 * 服务提交的 run 也在这里。列表只展示已经进入 admission 的任务，排队中的任务
 * 还没有 session/事件，详情页要能正常渲染空态。
 */
export default function AsyncTasksPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = positiveInt(searchParams.get('page'), 1);
  const requestedPageSize = positiveInt(searchParams.get('pageSize'), PAGE_SIZE);
  const pageSize = PAGE_SIZE_OPTIONS.includes(requestedPageSize) ? requestedPageSize : PAGE_SIZE;
  const state = searchParams.get('state') ?? '';
  const agent = searchParams.get('agent') ?? '';
  const trigger = searchParams.get('trigger') ?? '';
  const keyword = searchParams.get('keyword') ?? '';
  const [keywordDraft, setKeywordDraft] = useState(keyword);

  const updateParams = (changes: Record<string, string | number | undefined>) => {
    setSearchParams(
      previous => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined || value === '') next.delete(key);
          else next.set(key, String(value));
        }
        // Any filter change starts a new result set; keeping the old page would
        // show an empty page that looks like "no tasks".
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true }
    );
  };

  const query = useQuery({
    queryKey: ['agent-runs', { page, pageSize, state, agent, trigger, keyword }],
    queryFn: () =>
      listAgentRuns({
        offset: (page - 1) * pageSize,
        limit: pageSize,
        state: state || undefined,
        agent: agent || undefined,
        trigger: trigger || undefined,
        keyword: keyword || undefined,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: current => {
      const rows = current.state.data?.runs ?? [];
      return rows.some(row => isAdminRunActive(row.state)) ? 3000 : false;
    },
  });

  // 观察全量行缓存，而不是在 `queryFn` 里再调 `listAllRows`：同键嵌套查询会让
  // 外层等待自己的 promise，永远停在 loading（见 `resourceRowsQueryKey`）。
  const agentsQuery = useQuery({
    queryKey: resourceRowsQueryKey('agents'),
    queryFn: () => fetchAllRows('agents'),
    staleTime: 60_000,
  });

  const agentOptions = useMemo(
    () =>
      (agentsQuery.data ?? [])
        .map(row => ({
          value: String(row.name ?? ''),
          label: String(row.displayName || row.name || ''),
          description: normalizeOptionDescription(row.description),
        }))
        .filter(option => option.value),
    [agentsQuery.data]
  );

  const cancel = useMutation({
    mutationFn: (id: string) => cancelAgentRun(id),
    onSuccess: () => {
      message.success('已提交取消');
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
    },
    onError: error => message.error((error as Error).message),
  });

  const retry = useMutation({
    mutationFn: (id: string) => retryAgentRun(id),
    onSuccess: result => {
      message.success('已创建新的异步任务');
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      navigate(`/async-tasks/${encodeURIComponent(result.id)}`);
    },
    onError: error => message.error((error as Error).message),
  });

  const columns: TableColumnsType<AdminRun> = [
    {
      // 第一列就是任务的唯一标识：Run ID 含连字符，默认换行规则会在连字符处折行，
      // 必须显式 `nowrap`；auto 布局下内容更宽时列会按内容撑开，不会截断。
      title: 'Run ID',
      dataIndex: 'id',
      key: 'id',
      width: RESOURCE_ID_COLUMN_WIDTH,
      // 复制按钮与全站 ID 单元格同一套交互：18px 图标只在悬停 / 聚焦时浮现
      // （见 `ValueWithActions` 的 `revealActionsOnHover`），不要另写一份。
      render: (value: string) => (
        <ValueWithActions
          value={
            <Link to={`/async-tasks/${encodeURIComponent(value)}`}>
              <code style={RUN_ID}>{value}</code>
            </Link>
          }
          rawValue={value}
          copyable
          copyAriaLabel="复制 Run ID"
          revealActionsOnHover
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      render: (value: string) => {
        const meta = adminRunStateMeta(value);
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '智能体',
      dataIndex: 'agent',
      key: 'agent',
      render: (value?: string) =>
        value ? <Link to={`/agents/${encodeURIComponent(value)}`}>{value}</Link> : <span>-</span>,
    },
    {
      title: '触发',
      dataIndex: 'trigger',
      key: 'trigger',
      render: (value?: string) => ADMIN_RUN_TRIGGER[value ?? ''] ?? value ?? '-',
    },
    {
      title: '调度来源',
      dataIndex: 'scheduleRef',
      key: 'scheduleRef',
      // auto 布局下列宽拦不住长 ID，必须在单元格内部限宽。
      render: (value?: string) =>
        value ? (
          <EllipsisText maxWidth={220} title={value}>
            <Link to={`/scheduled-runs/${encodeURIComponent(value)}`}>{value}</Link>
          </EllipsisText>
        ) : (
          '-'
        ),
    },
    {
      title: '尝试',
      dataIndex: 'attempt',
      key: 'attempt',
      render: (value?: number) => (value && value > 0 ? value : '-'),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value?: number) => (value ? formatDate(value) : '-'),
    },
    {
      title: '耗时',
      key: 'duration',
      render: (_value, row) => formatDurationMs(row.startedAt, row.finishedAt),
    },
    {
      title: '错误',
      dataIndex: 'error',
      key: 'error',
      // 错误可能是整段堆栈；auto 布局下用像素上限截断，完整值仍可悬停查看。
      render: (value?: string) => (
        <EllipsisText maxWidth={320} title={value || undefined}>
          {value || '-'}
        </EllipsisText>
      ),
    },
    {
      title: '操作',
      key: 'action',
      ...RESOURCE_ACTION_COLUMN,
      render: (_value, row) => {
        // 取消 / 重试都是低频动作，且受状态约束；行内只留「详情」这个主入口。
        const moreItems = [
          isAdminRunActive(row.state) && { key: 'cancel', label: '取消', danger: true },
          isAdminRunRetryable(row.state) && { key: 'retry', label: '重试' },
        ].filter(Boolean) as MenuProps['items'];

        return (
          <Space size={8}>
            <Link to={`/async-tasks/${encodeURIComponent(row.id)}`}>
              <Button size="small" type="link" style={{ padding: 0 }}>
                详情
              </Button>
            </Link>
            <MoreActions
              items={moreItems}
              onClick={({ key }) => {
                if (key === 'cancel') {
                  modal.confirm({
                    title: '取消这个任务？',
                    content: '运行中的智能体会被停止，已经产生的事件会保留。',
                    okText: '确定',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: () => cancel.mutate(row.id),
                  });
                  return;
                }
                if (key === 'retry') {
                  modal.confirm({
                    title: '重试这个任务？',
                    content: '会用原来的智能体和提示词创建一个新任务，原任务不会改变。',
                    okText: '确定',
                    cancelText: '取消',
                    onOk: () => retry.mutate(row.id),
                  });
                }
              }}
            />
          </Space>
        );
      },
    },
  ];

  const rows = query.data?.runs ?? [];
  const total = query.data?.count ?? 0;
  const error = query.error as ApiError | null;

  return (
    <ResourceShell
      title="异步任务"
      toolbar={
        <Space wrap>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 130 }}
            value={state || undefined}
            onChange={value => updateParams({ state: value })}
            options={Object.entries(ADMIN_RUN_STATE).map(([value, meta]) => ({
              value,
              label: meta.text,
            }))}
          />
          <Select
            allowClear
            showSearch
            placeholder="全部智能体"
            style={{ width: 180 }}
            popupMatchSelectWidth={300}
            value={agent || undefined}
            onChange={value => updateParams({ agent: value })}
            options={agentOptions}
            optionRender={option => {
              const data = option.data as { description?: string };
              return <OptionLabel title={option.label} description={data.description} />;
            }}
            filterOption={(input, option) =>
              matchOptionText(input, option?.label, option?.description)
            }
          />
          <Select
            allowClear
            placeholder="全部触发方式"
            style={{ width: 140 }}
            value={trigger || undefined}
            onChange={value => updateParams({ trigger: value })}
            options={Object.entries(ADMIN_RUN_TRIGGER).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Input.Search
            allowClear
            placeholder="Run ID / Session / Subject"
            style={{ width: 260 }}
            value={keywordDraft}
            onChange={event => {
              setKeywordDraft(event.target.value);
              // The clear button should take effect immediately; typed text
              // still waits for Enter so every keystroke is not a request.
              if (event.target.value === '') updateParams({ keyword: '' });
            }}
            onSearch={value => updateParams({ keyword: value.trim() })}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
            刷新
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            运行中的任务每 3 秒自动刷新
          </Typography.Text>
        </Space>
      }
    >
      <ResourceCard>
        {error ? (
          <Alert
            showIcon
            type={error.status === 403 ? 'warning' : 'error'}
            style={{ marginBottom: 12 }}
            message={error.status === 403 ? '需要管理员权限' : `读取异步任务失败：${error.message}`}
            action={
              <Button size="small" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          />
        ) : null}
        <Table
          size="small"
          rowKey="id"
          loading={query.isLoading}
          dataSource={rows}
          columns={columns}
          pagination={false}
          // 中间列按内容、整表铺满卡片；操作列贴右缘并吸附。
          {...RESOURCE_TABLE_LAYOUT}
          locale={{ emptyText: '还没有异步任务' }}
        />
        <ListPagination
          total={total}
          page={page}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={value => updateParams({ page: value })}
          onPageSizeChange={value => updateParams({ pageSize: value })}
          hideOnSinglePage={false}
        />
      </ResourceCard>
    </ResourceShell>
  );
}

const RUN_ID = {
  fontFamily: 'var(--font-family-code, monospace)',
  fontSize: 12,
  whiteSpace: 'nowrap',
} as const;

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
