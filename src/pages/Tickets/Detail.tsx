import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Alert, Button, Descriptions, Empty, Popconfirm, Space, Tag, Timeline, Typography, message } from 'antd';
import { CommentOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listTicketNotes, oncallGroupBinding, ticketApi } from '@/api/chat';
import { escalateTicket } from '@/api/oncall';
import type { Ticket } from '@/api/types';
import { decodeClaims } from '@/auth/claims';
import { useUserDirectory } from '@/components/UserRef';
import { useSessionToken } from '@/auth/tokenStore';
import PageLayout from '@/components/PageLayout';
import { formatDate } from '@/lib/date';
import { useGoBack } from '@/runtime';

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
 * 工单详情。
 *
 * 原来是列表页上的 Drawer；现在是一整页（`/tickets/:id`），与资源详情/表单同一套
 * 顶栏与白色面板。工单仍然只读：生命周期由值班命令与飞书卡片驱动。
 */
export default function TicketDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const segments = location.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[1] ?? '');
  const goBack = useGoBack('/tickets');

  const ticketQuery = useQuery({
    queryKey: ['chat', 'tickets', id],
    queryFn: () => ticketApi.get(id),
    enabled: Boolean(id),
  });

  const notesQuery = useQuery({
    queryKey: ['chat', 'tickets', id, 'notes'],
    queryFn: () => listTicketNotes(id),
    enabled: Boolean(id),
  });

  const groupsQuery = useQuery({
    queryKey: ['res', 'oncall-groups', 'picker'],
    queryFn: () => oncallGroupBinding.api.list({ page: 1, pageSize: 500 }),
    staleTime: 60_000,
  });

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
    onError: error => message.error((error as Error).message),
  });

  const groupName = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groupsQuery.data?.items ?? []) {
      map.set(String(group.name), String(group.displayName || group.name));
    }
    return (groupId?: string) => (groupId ? (map.get(groupId) ?? groupId) : '-');
  }, [groupsQuery.data]);

  const ticket = ticketQuery.data as (Ticket & Record<string, unknown>) | undefined;
  const statusMeta = ticket?.status ? STATUS_META[ticket.status] : undefined;
  const levelMeta = ticket?.level ? LEVEL_META[ticket.level] : undefined;

  return (
    <PageLayout
      title="工单详情"
      onBack={goBack}
      loading={ticketQuery.isLoading}
      footer={
        <>
          <Button size="large" onClick={goBack}>
            返回列表
          </Button>
          {ticket && isAdmin && ticket.status === 'open' && ticket.group_id ? (
            <Popconfirm
              title="升级这个工单？"
              description="会向当前值班人或策略指定人员发送飞书私信，并写入工单备注。"
              okText="升级"
              cancelText="取消"
              onConfirm={() =>
                escalate.mutate({
                  group: String(ticket.group_id),
                  ticketId: String(ticket.ticket_id),
                })
              }
            >
              <Button size="large" icon={<ThunderboltOutlined />} loading={escalate.isPending}>
                升级值班
              </Button>
            </Popconfirm>
          ) : null}
          {ticket && (
            <Button
              size="large"
              type="primary"
              icon={<CommentOutlined />}
              onClick={() =>
                navigate(
                  `/chat?draft=${encodeURIComponent(
                    `帮我分析工单 ${ticket.ticket_id}：${ticket.title ?? ''}`
                  )}`
                )
              }
            >
              在对话中分析
            </Button>
          )}
        </>
      }
    >
      {ticketQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="读取工单失败"
          description={(ticketQuery.error as Error).message}
          action={<Button onClick={() => void ticketQuery.refetch()}>重试</Button>}
        />
      ) : ticket ? (
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <div>
            <Space wrap size={8}>
              <code>{ticket.ticket_id}</code>
              {statusMeta && <Tag color={statusMeta.color}>{statusMeta.text}</Tag>}
              {levelMeta && <Tag color={levelMeta.color}>{levelMeta.text}</Tag>}
            </Space>
            <Typography.Title level={4} style={{ margin: '12px 0 0' }}>
              {ticket.title || '（无标题）'}
            </Typography.Title>
          </div>

          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="值班组">{groupName(ticket.group_id)}</Descriptions.Item>
            <Descriptions.Item label="来源">{ticket.source || '-'}</Descriptions.Item>
            <Descriptions.Item label="报障人">
              {ticket.reporter_name || ticket.reporter_id || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="处理人">
              {ticket.assignee_name || ticket.assignee_id || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="事件 ID" span={2}>
              {ticket.incident_id ? <code>{ticket.incident_id}</code> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {formatDate(ticket.created_at ?? '')}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {formatDate(ticket.updated_at ?? '')}
            </Descriptions.Item>
            <Descriptions.Item label="解决时间">
              {formatDate(ticket.resolved_at ?? '')}
            </Descriptions.Item>
            <Descriptions.Item label="关闭时间">
              {formatDate(ticket.closed_at ?? '')}
            </Descriptions.Item>
          </Descriptions>

          {ticket.description && (
            <div>
              <Typography.Title level={5}>描述</Typography.Title>
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                {ticket.description}
              </Typography.Paragraph>
            </div>
          )}

          {ticket.summary && (
            <div>
              <Typography.Title level={5}>结案总结</Typography.Title>
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                {ticket.summary}
              </Typography.Paragraph>
            </div>
          )}

          <div>
            <Typography.Title level={5}>处理记录</Typography.Title>
            {notesQuery.isLoading ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="加载中…" />
            ) : (notesQuery.data?.notes ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有处理记录" />
            ) : (
              <Timeline
                items={(notesQuery.data?.notes ?? []).map(note => ({
                  key: note.id ?? `${note.created_at}-${note.note}`,
                  children: (
                    <div>
                      <Space size={6} wrap>
                        <Typography.Text strong>
                          {note.author_name || note.author_id || '未知'}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {formatDate(note.created_at ?? '')}
                        </Typography.Text>
                        {note.review && <Tag color="orange">需复盘</Tag>}
                        {note.demand && <Tag color="blue">转需求</Tag>}
                      </Space>
                      <Typography.Paragraph style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
                        {note.note}
                      </Typography.Paragraph>
                    </div>
                  ),
                }))}
              />
            )}
            {notesQuery.data && notesQuery.data.total > notesQuery.data.notes.length && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                显示最近 {notesQuery.data.notes.length} 条，共 {notesQuery.data.total} 条。
              </Typography.Text>
            )}
          </div>
        </Space>
      ) : null}
    </PageLayout>
  );
}
