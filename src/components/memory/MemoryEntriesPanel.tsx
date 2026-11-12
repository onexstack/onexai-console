import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  batchDeleteMemoryEntries,
  createMemoryEntry,
  deleteMemoryEntry,
  listMemoryEntries,
  listMemorySubjects,
  purgeMemorySubject,
  searchMemoryEntries,
  updateMemoryEntry,
} from '@/api/memory';
import type { MemorySearchHit, PlatformMemoryEntry } from '@/api/types';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import { formatDate } from '@/lib/date';
import { ResizableDrawer } from '@/ui';

const TYPE_OPTIONS = [
  { label: '事实 / 偏好', value: 'semantic' },
  { label: '事件 / 经历', value: 'episodic' },
  { label: '流程 / 指令', value: 'procedural' },
  { label: '用户画像', value: 'profile' },
];

const STATUS_OPTIONS = [
  { label: '生效', value: 'active' },
  { label: '已归档', value: 'archived' },
  { label: '已替代', value: 'superseded' },
  { label: '已过期', value: 'expired' },
  { label: '已隔离', value: 'quarantined' },
];

const SOURCE_OPTIONS = [
  { label: '手工', value: 'manual' },
  { label: '自动抽取', value: 'auto' },
  { label: '工具', value: 'tool' },
];

interface MemoryEntriesPanelProps {
  memory: string;
  record: Record<string, unknown>;
}

/**
 * 记忆条目页签。
 *
 * 普通用户只能看到自己的 subject（服务端强制）；管理员先选 subject，再浏览、
 * 搜索和治理。语义搜索走 `/entries/search`，关键字搜索走列表 `q`。
 */
export default function MemoryEntriesPanel({ memory, record }: MemoryEntriesPanelProps) {
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const admin = claims?.isAdmin === true;
  const sessionScoped = record.subjectMode === 'session';
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState('');
  const [agent, setAgent] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>('active');
  const [source, setSource] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'keyword' | 'hybrid' | 'vector'>('keyword');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<PlatformMemoryEntry | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformMemoryEntry | null>(null);
  const [searchHits, setSearchHits] = useState<MemorySearchHit[] | null>(null);
  const [form] = Form.useForm<Record<string, unknown>>();

  const subjects = useQuery({
    queryKey: ['memory-subjects', memory],
    queryFn: () => listMemorySubjects(memory, { limit: 200 }),
    enabled: admin,
  });

  useEffect(() => {
    if (!admin) return;
    if (subject) return;
    const first = subjects.data?.subjects?.[0]?.subject;
    if (first) setSubject(first);
  }, [admin, subject, subjects.data]);

  const entries = useQuery({
    queryKey: ['memory-entries', memory, { subject, agent, type, status, source, page, pageSize }],
    queryFn: () =>
      listMemoryEntries({
        memory,
        subject: admin ? subject : undefined,
        agent,
        type,
        status,
        source,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
    enabled: !admin || Boolean(subject),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['memory-entries', memory] });
    void queryClient.invalidateQueries({ queryKey: ['memory-stats', memory] });
    void queryClient.invalidateQueries({ queryKey: ['memory-subjects', memory] });
  };

  const runSearch = async () => {
    if (admin && !subject) {
      message.warning('请先选择 Subject');
      return;
    }
    if (!query.trim()) {
      setSearchHits(null);
      return;
    }
    try {
      const result = await searchMemoryEntries({
        memory,
        query: query.trim(),
        mode,
        agent,
        subject: admin ? subject : undefined,
        types: type ? [type] : undefined,
        topK: 20,
        persist: false,
        explain: true,
      });
      setSearchHits(result.hits);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '检索失败');
    }
  };

  const remove = useMutation({
    mutationFn: (entry: PlatformMemoryEntry) =>
      deleteMemoryEntry(memory, entry.id, admin ? entry.subject : undefined),
    onSuccess: () => {
      message.success('已删除');
      refresh();
    },
    onError: err => message.error(err instanceof Error ? err.message : '删除失败'),
  });

  const batchRemove = useMutation({
    mutationFn: () => batchDeleteMemoryEntries(memory, selected, admin ? subject : undefined),
    onSuccess: () => {
      message.success('已删除');
      setSelected([]);
      refresh();
    },
    onError: err => message.error(err instanceof Error ? err.message : '删除失败'),
  });

  const purge = useMutation({
    mutationFn: () => purgeMemorySubject(memory, subject),
    onSuccess: deleted => {
      message.success(`已清空 ${deleted} 条记忆`);
      setSelected([]);
      setSearchHits(null);
      refresh();
    },
    onError: err => message.error(err instanceof Error ? err.message : '清空失败'),
  });

  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload: Partial<PlatformMemoryEntry> = {
        agent: String(values.agent ?? ''),
        agentNamespace: editing ? undefined : String(values.agentNamespace ?? ''),
        type: String(values.type ?? 'semantic'),
        content: String(values.content ?? ''),
        importance: Number(values.importance ?? 0.5),
        confidence: Number(values.confidence ?? 0.5),
        tags: Array.isArray(values.tags) ? values.tags.map(String) : [],
        metadata: typeof values.metadata === 'string' ? values.metadata : '',
        subject: admin ? String(values.subject ?? '') : undefined,
        status: editing ? String(values.status ?? editing.status ?? 'active') : undefined,
      };
      if (editing) {
        return updateMemoryEntry(memory, editing.id, payload, admin ? editing.subject : undefined);
      }
      return createMemoryEntry(memory, { ...payload, source: 'manual' });
    },
    onSuccess: entry => {
      message.success('已保存');
      setEditorOpen(false);
      setEditing(null);
      form.resetFields();
      if (admin && entry?.subject) setSubject(entry.subject);
      refresh();
    },
    onError: err => message.error(err instanceof Error ? err.message : '保存失败'),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      type: 'semantic',
      importance: 0.5,
      confidence: 0.5,
      subject: admin ? subject : undefined,
    });
    setEditorOpen(true);
  };

  const openEdit = (entry: PlatformMemoryEntry) => {
    setEditing(entry);
    form.setFieldsValue({
      subject: entry.subject,
      agent: entry.agent,
      type: entry.type,
      content: entry.content,
      importance: entry.importance,
      confidence: entry.confidence,
      tags: entry.tags ?? [],
      metadata: entry.metadata ?? '',
      status: entry.status ?? 'active',
    });
    setEditorOpen(true);
  };

  const rows = searchHits ? searchHits.map(hit => hit.entry) : entries.data?.entries ?? [];
  const total = searchHits ? searchHits.length : entries.data?.count ?? 0;

  const columns: ColumnsType<PlatformMemoryEntry> = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: value => <Tag>{typeLabel(String(value ?? ''))}</Tag>,
    },
    {
      title: '内容',
      dataIndex: 'content',
      ellipsis: true,
      render: (value, row) => (
        <Typography.Link onClick={() => setDetail(row)}>{String(value ?? '')}</Typography.Link>
      ),
    },
    ...(admin
      ? [
          {
            title: 'Subject',
            dataIndex: 'subject',
            width: 160,
            ellipsis: true,
          },
        ]
      : []),
    { title: '智能体', dataIndex: 'agent', width: 140, ellipsis: true },
    // 共享记忆库会被多个空间写入；同名智能体靠这一列区分。
    { title: '来源空间', dataIndex: 'agentNamespace', width: 140, ellipsis: true },
    {
      title: '来源',
      dataIndex: 'source',
      width: 100,
      render: value => sourceLabel(String(value ?? '')),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: value => <Tag color={value === 'active' ? 'green' : 'default'}>{statusLabel(String(value ?? ''))}</Tag>,
    },
    {
      title: '重要度',
      dataIndex: 'importance',
      width: 90,
      render: value => Number(value ?? 0).toFixed(2),
    },
    {
      title: '访问',
      dataIndex: 'accessCount',
      width: 80,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: value => (value ? formatDate(Number(value)) : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, row) => (
        <Space size="small">
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setDetail(row)}>
            查看
          </Button>
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title="删除这条记忆？"
            description="删除后无法恢复。"
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove.mutate(row)}
          >
            <Button size="small" type="link" danger style={{ padding: 0 }}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        {admin && (
          <Select
            showSearch
            allowClear
            placeholder={sessionScoped ? '选择会话 ID' : '选择 Subject'}
            style={{ width: 220 }}
            value={subject || undefined}
            onChange={value => {
              setSubject(value ?? '');
              setPage(1);
              setSearchHits(null);
            }}
            options={(subjects.data?.subjects ?? []).map(item => ({
              label: `${item.subject}（${item.entries ?? 0}）`,
              value: item.subject,
            }))}
          />
        )}
        <Input
          allowClear
          placeholder="按 Agent 过滤"
          style={{ width: 160 }}
          value={agent}
          onChange={event => {
            setAgent(event.target.value || undefined);
            setPage(1);
            setSearchHits(null);
          }}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 140 }}
          value={type}
          onChange={value => {
            setType(value);
            setPage(1);
            setSearchHits(null);
          }}
          options={TYPE_OPTIONS}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          value={status}
          onChange={value => {
            setStatus(value);
            setPage(1);
            setSearchHits(null);
          }}
          options={STATUS_OPTIONS}
        />
        <Select
          allowClear
          placeholder="来源"
          style={{ width: 130 }}
          value={source}
          onChange={value => {
            setSource(value);
            setPage(1);
            setSearchHits(null);
          }}
          options={SOURCE_OPTIONS}
        />
        <Input
          allowClear
          placeholder="搜索内容"
          prefix={<SearchOutlined />}
          style={{ width: 220 }}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onPressEnter={() => void runSearch()}
        />
        <Select
          style={{ width: 110 }}
          value={mode}
          onChange={value => setMode(value)}
          options={[
            { label: '关键字', value: 'keyword' },
            { label: '混合', value: 'hybrid' },
            { label: '向量', value: 'vector' },
          ]}
        />
        <Button type="primary" onClick={() => void runSearch()}>
          检索
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            setSearchHits(null);
            refresh();
          }}
        >
          刷新
        </Button>
        {(!sessionScoped || admin) && <Button onClick={openCreate}>新建记忆</Button>}
        {selected.length > 0 && (
          <Popconfirm
            title={`删除选中的 ${selected.length} 条记忆？`}
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => batchRemove.mutate()}
          >
            <Button danger loading={batchRemove.isPending}>
              批量删除
            </Button>
          </Popconfirm>
        )}
        {admin && subject && (
          <Popconfirm
            title={`清空 ${subject} 的全部记忆？`}
            description="这是不可逆的 GDPR 清理，会软删除该 subject 的所有条目。"
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => purge.mutate()}
          >
            <Button danger loading={purge.isPending}>
              清空该用户记忆
            </Button>
          </Popconfirm>
        )}
      </Space>

      {sessionScoped && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            admin
              ? '会话级记忆：管理员按会话 ID 浏览；运行时按会话自动读写。'
              : '会话级记忆由运行时按会话写入；页面不提供手工新增。'
          }
        />
      )}
      {admin && !subject && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            sessionScoped
              ? '请先选择一个会话 ID；管理员按会话浏览记忆。'
              : '请先选择一个 Subject；管理员按 Subject 浏览记忆。'
          }
        />
      )}
      {searchHits && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`检索结果 ${searchHits.length} 条，按相关度排序；检索测试不会增加访问次数。`}
        />
      )}

      <Table<PlatformMemoryEntry>
        rowKey="id"
        size="middle"
        loading={entries.isLoading}
        columns={columns}
        dataSource={rows}
        rowSelection={
          searchHits
            ? undefined
            : {
                selectedRowKeys: selected,
                onChange: keys => setSelected(keys.map(String)),
              }
        }
        pagination={
          searchHits
            ? false
            : {
                current: page,
                pageSize,
                total,
                showSizeChanger: true,
                onChange: (nextPage, nextSize) => {
                  setPage(nextPage);
                  setPageSize(nextSize);
                },
              }
        }
        locale={{ emptyText: admin && !subject ? '请选择 Subject' : '暂无记忆' }}
      />

      <ResizableDrawer
        title="记忆详情"
        defaultWidth={640}
        minWidth={480}
        storageKey="memory_detail"
        open={detail !== null}
        onClose={() => setDetail(null)}
        destroyOnHidden
      >
        {detail && <MemoryDetail entry={detail} />}
      </ResizableDrawer>

      <ResizableDrawer
        title={editing ? '编辑记忆' : '新建记忆'}
        defaultWidth={560}
        minWidth={440}
        storageKey="memory_editor"
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="primary" loading={save.isPending} onClick={() => void form.validateFields().then(values => save.mutate(values))}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          {admin && (
            <Form.Item
              name="subject"
              label={sessionScoped ? '会话 ID' : 'Subject'}
              rules={[{ required: true, message: sessionScoped ? '请填写会话 ID' : '请填写 Subject' }]}
            >
              <Input
                placeholder={sessionScoped ? '会话 ID；手工写会话记忆时必填' : '用户 ID；手工写记忆时必填'}
                disabled={editing !== null}
              />
            </Form.Item>
          )}
          <Form.Item name="agent" label="智能体">
            <Input placeholder="留空表示不绑定具体智能体" />
          </Form.Item>
          {!editing && (
            <Form.Item
              name="agentNamespace"
              label="智能体空间"
              tooltip="共享记忆库的归因字段；留空表示未知（手工写入的条目通常没有来源智能体）。"
            >
              <Input placeholder="例如 team-a；留空表示未知" />
            </Form.Item>
          )}
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="状态">
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          )}
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '请填写记忆内容' }]}>
            <Input.TextArea rows={6} maxLength={4000} showCount />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="importance" label="重要度">
              <InputNumber min={0} max={1} step={0.05} />
            </Form.Item>
            <Form.Item name="confidence" label="可信度">
              <InputNumber min={0} max={1} step={0.05} />
            </Form.Item>
            <Form.Item name="tags" label="标签">
              <Select mode="tags" style={{ minWidth: 180 }} placeholder="回车添加" />
            </Form.Item>
          </Space>
          <Form.Item name="metadata" label="元数据（JSON）">
            <Input.TextArea rows={3} placeholder='{"team":"sre"}' />
          </Form.Item>
        </Form>
      </ResizableDrawer>
    </div>
  );
}

function MemoryDetail({ entry }: { entry: PlatformMemoryEntry }) {
  let metadata = entry.metadata ?? '';
  try {
    if (metadata) metadata = JSON.stringify(JSON.parse(metadata), null, 2);
  } catch {
    // 保留原文。
  }
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</Typography.Paragraph>
      <Typography.Text type="secondary">
        {typeLabel(entry.type ?? '')} · {statusLabel(entry.status ?? '')} · {entry.embeddingStatus ?? '-'}
      </Typography.Text>
      <Typography.Text>ID：{entry.id}</Typography.Text>
      <Typography.Text>Subject：{entry.subject ?? '-'}</Typography.Text>
      <Typography.Text>
        智能体：{entry.agent || '-'}
        {entry.agentNamespace ? `（${entry.agentNamespace}）` : ''}
      </Typography.Text>
      <Typography.Text>来源：{sourceLabel(entry.source ?? '')} · {entry.actor || '-'}</Typography.Text>
      <Typography.Text>会话 / 运行：{entry.sessionId || '-'} / {entry.runId || '-'}</Typography.Text>
      <Typography.Text>
        重要度 / 可信度：{Number(entry.importance ?? 0).toFixed(2)} / {Number(entry.confidence ?? 0).toFixed(2)}
      </Typography.Text>
      <Typography.Text>访问次数：{entry.accessCount ?? 0}</Typography.Text>
      <Typography.Text>创建：{entry.createdAt ? formatDate(entry.createdAt) : '-'}</Typography.Text>
      <Typography.Text>更新：{entry.updatedAt ? formatDate(entry.updatedAt) : '-'}</Typography.Text>
      <Typography.Text>过期：{entry.expiresAt ? formatDate(entry.expiresAt) : '不过期'}</Typography.Text>
      <Typography.Text>标签：{(entry.tags ?? []).join('、') || '-'}</Typography.Text>
      {metadata && (
        <>
          <Typography.Text strong>元数据</Typography.Text>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{metadata}</pre>
        </>
      )}
    </Space>
  );
}

function typeLabel(value: string): string {
  return TYPE_OPTIONS.find(item => item.value === value)?.label ?? value ?? '-';
}

function statusLabel(value: string): string {
  return STATUS_OPTIONS.find(item => item.value === value)?.label ?? value ?? '-';
}

function sourceLabel(value: string): string {
  return SOURCE_OPTIONS.find(item => item.value === value)?.label ?? value ?? '-';
}
