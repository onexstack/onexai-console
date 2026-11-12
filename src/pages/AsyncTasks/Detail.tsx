import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Alert, App, Button, Popconfirm, Result, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import {
  ADMIN_RUN_TRIGGER,
  adminRunStateMeta,
  cancelAgentRun,
  getAgentRun,
  isAdminRunActive,
  isAdminRunRetryable,
  listAgentRunEvents,
  retryAgentRun,
  type AdminRunEvent,
} from '@/api/agentRuns';
import { ApiError } from '@/api/client';
import { formatDate, formatDurationMs } from '@/lib/date';
import { useGoBack } from '@/runtime';
import { DetailShell, InfoSection, type InfoItem } from '@/ui';
import PageSurface from '@/ui/components/PageSurface';

const MONO = { fontFamily: 'var(--font-family-code, monospace)', fontSize: 12 } as const;
const PRE = {
  ...MONO,
  margin: 0,
  padding: 12,
  borderRadius: 6,
  background: 'rgba(0, 0, 0, 0.03)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: 420,
  overflow: 'auto',
} as const;

/**
 * 异步任务详情。
 *
 * 数据只来自 admission：任务在 admission 里排队、运行、结束，run 行是执行开始后
 * 才有的补充。所以 pending 任务也能打开详情，只是没有事件和结果。
 */
export default function AsyncTaskDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const segments = location.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[1] ?? '');
  const goBack = useGoBack('/async-tasks');

  const [tab, setTab] = useState('overview');

  const detailQuery = useQuery({
    queryKey: ['agent-run', id],
    queryFn: () => getAgentRun(id),
    enabled: Boolean(id),
    refetchInterval: current => (isAdminRunActive(current.state.data?.run.state) ? 2000 : false),
  });

  const run = detailQuery.data?.run;
  const admission = detailQuery.data?.admission;
  const state = run?.state ?? admission?.state;
  const eventsEnabled = Boolean(id) && (tab === 'events' || tab === 'result');

  const eventsQuery = useQuery({
    queryKey: ['agent-run', id, 'events'],
    queryFn: () => listAgentRunEvents(id, { limit: 500 }),
    enabled: eventsEnabled,
    refetchInterval: isAdminRunActive(state) ? 3000 : false,
  });

  const cancel = useMutation({
    mutationFn: () => cancelAgentRun(id),
    onSuccess: () => {
      message.success('已提交取消');
      void queryClient.invalidateQueries({ queryKey: ['agent-run', id] });
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
    },
    onError: error => message.error((error as Error).message),
  });

  const retry = useMutation({
    mutationFn: () => retryAgentRun(id),
    onSuccess: result => {
      message.success('已创建新的异步任务');
      void queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      navigate(`/async-tasks/${encodeURIComponent(result.id)}`);
    },
    onError: error => message.error((error as Error).message),
  });

  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const finalEvent = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.type === 'final') return events[index];
    }
    return undefined;
  }, [events]);

  if (detailQuery.isError) {
    const error = detailQuery.error as ApiError;
    return (
      <PageSurface>
        <Result
          status={error.status === 404 ? '404' : 'error'}
          title={error.status === 404 ? '任务不存在' : '读取任务失败'}
          subTitle={error.message}
          extra={
            <Button type="primary" onClick={goBack}>
              返回列表
            </Button>
          }
        />
      </PageSurface>
    );
  }

  const items: InfoItem[] = run
    ? [
        {
          label: '状态',
          value: <Tag color={adminRunStateMeta(state).color}>{adminRunStateMeta(state).text}</Tag>,
        },
        {
          label: '智能体',
          value: run.agent ? (
            <Link to={`/agents/${encodeURIComponent(run.agent)}`}>{run.agent}</Link>
          ) : (
            '-'
          ),
        },
        {
          label: '触发方式',
          value: ADMIN_RUN_TRIGGER[run.trigger ?? ''] ?? run.trigger ?? '-',
        },
        { label: '来源', value: run.source || '-' },
        {
          label: '调度来源',
          value: run.scheduleRef ? (
            <Link to={`/scheduled-runs/${encodeURIComponent(run.scheduleRef)}`}>
              {run.scheduleRef}
            </Link>
          ) : (
            '-'
          ),
        },
        {
          label: 'Subject',
          value: run.subject || '-',
          rawValue: run.subject,
          copyable: Boolean(run.subject),
        },
        {
          label: 'Session',
          value: run.sessionId || '-',
          rawValue: run.sessionId,
          copyable: Boolean(run.sessionId),
        },
        { label: '尝试', value: run.attempt && run.attempt > 0 ? run.attempt : '-' },
        { label: '创建时间', value: run.createdAt ? formatDate(run.createdAt) : '-' },
        { label: '开始时间', value: run.startedAt ? formatDate(run.startedAt) : '-' },
        { label: '结束时间', value: run.finishedAt ? formatDate(run.finishedAt) : '-' },
        { label: '耗时', value: formatDurationMs(run.startedAt, run.finishedAt) },
        {
          label: '错误',
          value: run.error ? <Typography.Text type="danger">{run.error}</Typography.Text> : '-',
          span: 2,
        },
      ]
    : [];

  const eventColumns: TableColumnsType<AdminRunEvent> = [
    { title: 'Seq', dataIndex: 'seq', key: 'seq', width: 70 },
    { title: '类型', dataIndex: 'type', key: 'type', width: 160 },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (value: number) => formatDate(value),
    },
    {
      title: 'Payload',
      dataIndex: 'payload',
      key: 'payload',
      render: (value: string) => <pre style={PRE}>{pretty(value)}</pre>,
    },
  ];

  const tabs = [
    {
      key: 'overview',
      label: '概览',
      children: run ? (
        <>
          <InfoSection title="执行信息" items={items} />
          {admission?.message ? (
            <Alert
              style={{ marginTop: 16 }}
              type={state === 'failed' ? 'error' : 'info'}
              showIcon
              message="Admission 消息"
              description={admission.message}
            />
          ) : null}
        </>
      ) : null,
    },
    {
      key: 'events',
      label: '执行事件',
      children: (
        <>
          {eventsQuery.isError ? (
            <Alert
              type="error"
              showIcon
              message="读取事件失败"
              description={(eventsQuery.error as Error).message}
            />
          ) : null}
          <Table
            size="small"
            rowKey="seq"
            loading={eventsQuery.isLoading}
            dataSource={events}
            columns={eventColumns}
            pagination={false}
            locale={{ emptyText: '还没有事件' }}
          />
        </>
      ),
    },
    {
      key: 'request',
      label: '请求',
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Block title="提示词" text={run?.prompt} />
          <Block
            title="Metadata"
            text={run?.metadata ? JSON.stringify(run.metadata, null, 2) : ''}
          />
          <Block title="原始请求" text={run?.requestJson} />
        </Space>
      ),
    },
    {
      key: 'result',
      label: '结果',
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Block title="最终输出" text={finalEvent?.payload} />
          <Block title="Task JSON" text={run?.taskJson} />
          <Block title="Usage" text={run?.usageJson} />
          {events.length > 0 && !finalEvent ? (
            <Typography.Text type="secondary">
              这次执行还没有 final 事件；任务结束后会出现在这里。
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
  ];

  const actions = (
    <>
      <Button
        icon={<ReloadOutlined />}
        onClick={() => {
          void detailQuery.refetch();
          if (eventsEnabled) void eventsQuery.refetch();
        }}
      >
        刷新
      </Button>
      {isAdminRunActive(state) ? (
        <Popconfirm
          title="取消这个任务？"
          description="运行中的智能体会被停止，已经产生的事件会保留。"
          onConfirm={() => cancel.mutate()}
        >
          <Button danger loading={cancel.isPending}>
            取消
          </Button>
        </Popconfirm>
      ) : null}
      {isAdminRunRetryable(state) ? (
        <Popconfirm
          title="重试这个任务？"
          description="会用原来的智能体和提示词创建一个新任务，原任务不会改变。"
          onConfirm={() => retry.mutate()}
        >
          <Button loading={retry.isPending}>重试</Button>
        </Popconfirm>
      ) : null}
    </>
  );

  return (
    <DetailShell
      id={id}
      onBack={goBack}
      actions={actions}
      loading={detailQuery.isLoading}
      tabs={tabs}
      activeKey={tab}
      onTabChange={setTab}
    />
  );
}

function Block({ title, text }: { title: string; text?: string }) {
  return (
    <div>
      <Typography.Title level={5} style={{ marginBottom: 8 }}>
        {title}
      </Typography.Title>
      {text ? (
        <pre style={PRE}>{pretty(text)}</pre>
      ) : (
        <Typography.Text type="secondary">-</Typography.Text>
      )}
    </div>
  );
}

function pretty(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
