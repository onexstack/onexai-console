import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  MoreActions,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_TABLE_LAYOUT,
  ResponsiveTable,
} from '@/ui';
import { useTranslation } from '@/runtime';
import { formatDate } from '@/lib/date';

import { listConversations, listHistory, listMembers, searchMessages } from '@/api/onexai';
import type { ChatMessageRecord, Conversation, ConversationMember } from '@/api/types';
import SessionGate from '@/components/SessionGate';

/**
 * 会话：群列表 / 历史 / 检索。
 *
 * # 这一页是一个**没有归属隔离**的读面，界面上必须说清楚
 *
 * 服务端的 `ListConversations` 把调用者身份参数直接丢弃，返回的是**机器人所在的
 * 所有群**；`/v1/search` 的 SQL 是全库 `LIKE`，没有 user/tenant/conv 过滤；历史和
 * 成员也不校验调用者是否属于那个群。所以这不是「我的会话」，而是「这台部署能看到
 * 的一切」。
 *
 * 把它做成页面是刻意的范围决定，把这件事写在页面上是它的前提条件：一个看起来像
 * 「我的会话」的界面会让人以为这里有隔离，而这里没有。
 *
 * 上游的 history 与 search 的 limit 都硬编码 50，没有分页参数，所以不接分页控件
 * ——接了只会给出一个不能翻的「下一页」。
 */
export default function ConversationsPage() {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<ChatMessageRecord[]>([]);
  const [searching, setSearching] = useState(false);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      setConversations(await listConversations());
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载群列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const openConversation = async (convId: string) => {
    setActiveConv(convId);
    setHistoryLoading(true);
    try {
      const [history, memberList] = await Promise.all([listHistory(convId), listMembers(convId)]);
      setMessages(history);
      setMembers(memberList);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载会话内容失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  const doSearch = async () => {
    const q = keyword.trim();
    if (!q) return;
    setSearching(true);
    try {
      setResults(await searchMessages(q));
    } catch (err) {
      message.error(err instanceof Error ? err.message : '检索失败');
    } finally {
      setSearching(false);
    }
  };

  const messageColumns = [
    {
      title: '时间',
      dataIndex: 'create_time',
      key: 'create_time',
      width: 180,
      // 上游 `create_time` 是 `time.Unix()` 的**秒**（onexai chat handler），不是毫秒时间戳，
      // 原样渲染会是一串 1761098400。`formatDate` 收 number 时按毫秒解析，故乘 1000。
      render: (value?: string) => {
        const seconds = Number(value);
        return value && Number.isFinite(seconds) && seconds > 0 ? formatDate(seconds * 1000) : '-';
      },
    },
    {
      title: '发送者',
      dataIndex: 'sender_name',
      key: 'sender_name',
      width: 160,
      render: (name: string | undefined, row: ChatMessageRecord) => (
        <Space size={4}>
          <span>{name || row.sender_id || '-'}</span>
          {row.is_bot && <Tag color="blue">bot</Tag>}
        </Space>
      ),
    },
    { title: '内容', dataIndex: 'content', key: 'content' },
  ];

  return (
    <SessionGate>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        title="这一页没有归属隔离，展示的是机器人可见的全部会话"
        description={
          <span style={{ fontSize: 12 }}>
            服务端返回的是机器人所在的所有群（调用者身份参数被丢弃），检索是全库匹配，历史与成员
            也不校验你是否属于该群。所以它看起来像「会话列表」，实际上是「这台部署能看到的一切」。
            上游的历史与检索各只返回最近 50 条，没有分页。
          </span>
        }
      />

      <Tabs
        items={[
          {
            key: 'groups',
            label: '群列表',
            children: (
              // 群列表是**主列表**（窄屏换卡片）；下面两张消息表是逐条日志，
              // 内容又长又多，横向滚动的表格比卡片更好读，所以不换。
              <ResponsiveTable<Conversation>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={conversations}
                pagination={false}
                // 中间列按内容、整表铺满卡片；操作列贴右缘并吸附。
                {...RESOURCE_TABLE_LAYOUT}
                columns={[
                  { title: '群 ID', dataIndex: 'id', key: 'id', width: 320 },
                  { title: '名称', dataIndex: 'name', key: 'name' },
                  { title: '类型', dataIndex: 'type', key: 'type' },
                  { title: '后端', dataIndex: 'backend', key: 'backend' },
                  {
                    title: '操作',
                    key: 'action',
                    ...RESOURCE_ACTION_COLUMN,
                    render: (_: unknown, row: Conversation) => (
                      <Space size={4}>
                        <Button type="link" onClick={() => void openConversation(row.id)}>
                          查看
                        </Button>
                        {/* 会话是只读面，没有更多动作；按钮仍保留以对齐操作列。 */}
                        <MoreActions items={[]} />
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'history',
            label: '会话内容',
            children: activeConv ? (
              <Card
                size="small"
                title={`群 ${activeConv}`}
                loading={historyLoading}
                extra={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    仅最近 50 条
                  </Typography.Text>
                }
              >
                <Table<ChatMessageRecord>
                  rowKey="id"
                  size="small"
                  dataSource={messages}
                  pagination={false}
                  columns={messageColumns}
                />
                <Typography.Title level={5} style={{ marginTop: 16 }}>
                  成员
                </Typography.Title>
                <Space wrap>
                  {members.map(m => (
                    <Tag key={m.user_id}>{m.name || m.user_id}</Tag>
                  ))}
                  {members.length === 0 && (
                    <Typography.Text type="secondary">未取到成员</Typography.Text>
                  )}
                </Space>
              </Card>
            ) : (
              <Typography.Text type="secondary">先在「群列表」里选一个群。</Typography.Text>
            ),
          },
          {
            key: 'search',
            label: '跨会话检索',
            children: (
              <div>
                <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                  <Input
                    value={keyword}
                    onChange={e => setKeyword(e.target.value)}
                    onPressEnter={doSearch}
                    placeholder="按内容匹配（全库，仅最近 50 条命中）"
                  />
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    loading={searching}
                    onClick={doSearch}
                  >
                    检索
                  </Button>
                </Space.Compact>
                <Table<ChatMessageRecord>
                  rowKey="id"
                  size="small"
                  dataSource={results}
                  pagination={false}
                  columns={[
                    { title: '群', dataIndex: 'conv_id', key: 'conv_id', width: 260 },
                    ...messageColumns,
                  ]}
                />
              </div>
            ),
          },
        ]}
        tabBarExtraContent={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void loadConversations()}
            loading={loading}
          >
            {t('刷新')}
          </Button>
        }
      />
    </SessionGate>
  );
}
