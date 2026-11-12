import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  EllipsisText,
  MoreActions,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_TABLE_LAYOUT,
} from '@/ui';
import { oncallGroupBinding, ticketApi } from '@/api/chat';
import { escalateTicket } from '@/api/oncall';
import type { Ticket } from '@/api/types';
import { decodeClaims } from '@/auth/claims';
import { useUserDirectory } from '@/components/UserRef';
import { useSessionToken } from '@/auth/tokenStore';
import { formatDate } from '@/lib/date';

const STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'open', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'saved', label: '已挂起' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
];

const STATUS_META: Record<string, { text: string; color: string }> = {
  open: { text: '待处理', color: 'red' },
  processing: { text: '处理中', color: 'blue' },
  saved: { text: '已挂起', color: 'orange' },
  resolved: { text: '已解决', color: 'green' },
  closed: { text: '已关闭', color: 'default' },
};

const LEVEL_META: Record<number, { text: string; color: string }> = {
  1: { text: 'P1', color: 'red' },
  2: { text: 'P2', color: 'orange' },
  3: { text: 'P3', color: 'blue' },
  4: { text: 'P4', color: 'default' },
};

/**
 * 工单。
 *
 * 只读：生命周期由 `/open`、`/hand`、`/close`、`/mark` 与飞书卡片驱动，控制台不做
 * 第二个写者。详情是独立整页（`/tickets/:id`），与资源详情/表单共用 PageLayout。
 */
export default function TicketsPage() {
  const navigate = useNavigate();

  const [status, setStatus] = useState('');
  const [groupId, setGroupId] = useState<string | undefined>();
  const [assignee, setAssignee] = useState('');
  const [assigneeInput, setAssigneeInput] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const queryClient = useQueryClient();
  const token = useSessionToken();
  const isAdmin = useMemo(() => Boolean(decodeClaims(token)?.isAdmin), [token]);
  const { resolveName } = useUserDirectory();
  const escalate = useMutation({
    mutationFn: (input: { group: string; ticketId: string }) =>
      escalateTicket(input.group, input.ticketId),
    onSuccess: response => {
      const targets = response.targets.map(target => resolveName(target.userName)).join('、') || '无';
      message.success(`已升级到第 ${response.tierIndex + 1} 级，通知：${targets}`);
      void queryClient.invalidateQueries({ queryKey: ['chat', 'tickets'] });
    },
    onError: error => {
      message.error((error as Error).message);
    },
  });

  const groupsQuery = useQuery({
    queryKey: ['res', 'oncall-groups', 'picker'],
    queryFn: () => oncallGroupBinding.api.list({ page: 1, pageSize: 500 }),
    staleTime: 60_000,
  });

  const listQuery = useQuery({
    queryKey: ['chat', 'tickets', { page, status, groupId, assignee }],
    queryFn: () =>
      ticketApi.list({
        page,
        pageSize,
        filters: {
          ...(status ? { status: [status] } : {}),
          ...(groupId ? { group_id: [groupId] } : {}),
          ...(assignee ? { assignee_id: [assignee] } : {}),
        },
      }),
  });

  const groupName = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groupsQuery.data?.items ?? []) {
      map.set(String(group.name), String(group.displayName || group.name));
    }
    return (id?: string) => (id ? (map.get(id) ?? id) : '-');
  }, [groupsQuery.data]);

  const tickets = (listQuery.data?.items ?? []) as (Ticket & Record<string, unknown>)[];
  const total = listQuery.data?.total ?? 0;

  const openTicket = (id: string) => {
    navigate(`/tickets/${encodeURIComponent(id)}`);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          工单管理
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          共 {total} 条
        </Typography.Text>
      </div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        工单生命周期由值班命令与飞书卡片驱动，控制台只读。
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={status}
          onChange={value => {
            setStatus(String(value));
            setPage(1);
          }}
          options={STATUS_OPTIONS.map(option => ({
            value: option.value,
            label: option.label,
          }))}
        />
        <Select
          allowClear
          placeholder="值班组"
          style={{ width: 180 }}
          value={groupId}
          onChange={value => {
            setGroupId(value);
            setPage(1);
          }}
          options={(groupsQuery.data?.items ?? []).map(group => ({
            value: String(group.name),
            label: String(group.displayName || group.name),
          }))}
        />
        <Input
          allowClear
          placeholder="处理人 ID，回车筛选"
          style={{ width: 200 }}
          value={assigneeInput}
          onChange={event => setAssigneeInput(event.target.value)}
          onPressEnter={() => {
            setAssignee(assigneeInput.trim());
            setPage(1);
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void listQuery.refetch()}>
          刷新
        </Button>
      </Space>

      {listQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="读取工单失败"
          description={(listQuery.error as Error).message}
          action={<Button onClick={() => void listQuery.refetch()}>重试</Button>}
        />
      ) : (
        <Card size="small" styles={{ body: { padding: 0 } }}>
          <Table
            size="small"
            rowKey="ticket_id"
            loading={listQuery.isLoading}
            dataSource={tickets}
            onRow={row => ({
              onClick: () => openTicket(String(row.ticket_id)),
              style: { cursor: 'pointer' },
            })}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={status === 'open' ? '没有待处理工单' : '没有符合条件的工单'}
                />
              ),
            }}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: setPage,
              showSizeChanger: false,
              showTotal: value => `共 ${value} 条`,
            }}
            // 中间列按内容、整表铺满卡片；操作列贴右缘并吸附。
            {...RESOURCE_TABLE_LAYOUT}
            columns={[
              {
                title: '工单号',
                dataIndex: 'ticket_id',
                key: 'ticket_id',
                width: 180,
                render: (value: string) => <code>{value}</code>,
              },
              {
                title: '标题',
                dataIndex: 'title',
                key: 'title',
                // 标题长度不可控，auto 布局下用单元格内的像素上限截断。
                render: (value: string, row) => {
                  const title = value || row.description || '-';
                  return (
                    <EllipsisText maxWidth={360} title={title}>
                      {title}
                    </EllipsisText>
                  );
                },
              },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                render: (value: string) => {
                  const meta = STATUS_META[value] ?? { text: value, color: 'default' };
                  return <Tag color={meta.color}>{meta.text}</Tag>;
                },
              },
              {
                title: '级别',
                dataIndex: 'level',
                key: 'level',
                render: (value: number) => {
                  const meta = LEVEL_META[value];
                  return meta ? <Tag color={meta.color}>{meta.text}</Tag> : '-';
                },
              },
              {
                title: '值班组',
                dataIndex: 'group_id',
                key: 'group_id',
                render: (value: string) => groupName(value),
              },
              {
                title: '处理人',
                dataIndex: 'assignee_name',
                key: 'assignee_name',
                render: (value: string) => value || '—',
              },
              {
                title: '更新时间',
                dataIndex: 'updated_at',
                key: 'updated_at',
                render: (value: string) => formatDate(value),
              },
              ...(isAdmin
                ? [
                    {
                      title: '操作',
                      key: 'actions',
                      ...RESOURCE_ACTION_COLUMN,
                      render: (_: unknown, row: Ticket & Record<string, unknown>) => (
                        <Space
                          size={4}
                          // 整行可点进详情；操作列的点击不能顺带触发跳转。
                          onClick={event => event.stopPropagation()}
                        >
                          <Button
                            size="small"
                            type="link"
                            disabled={row.status !== 'open' || !row.group_id}
                            loading={
                              escalate.isPending &&
                              escalate.variables?.ticketId === String(row.ticket_id)
                            }
                            onClick={event => {
                              event.stopPropagation();
                              escalate.mutate({
                                group: String(row.group_id),
                                ticketId: String(row.ticket_id),
                              });
                            }}
                          >
                            升级
                          </Button>
                          {/* 工单目前只有「升级」一个动作；「更多」仍保留以对齐操作列。 */}
                          <MoreActions items={[]} />
                        </Space>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      )}
    </div>
  );
}
