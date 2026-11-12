import { useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation } from '@tanstack/react-query';

import { searchMemoryEntries } from '@/api/memory';
import type { MemorySearchHit } from '@/api/types';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';

const TYPE_OPTIONS = [
  { label: '事实 / 偏好', value: 'semantic' },
  { label: '事件 / 经历', value: 'episodic' },
  { label: '流程 / 指令', value: 'procedural' },
  { label: '用户画像', value: 'profile' },
];

export default function MemoryRetrievalTestPanel({
  memory,
  sessionScoped = false,
}: {
  memory: string;
  sessionScoped?: boolean;
}) {
  const token = useSessionToken();
  const admin = useMemo(() => decodeClaims(token)?.isAdmin === true, [token]);
  const [form] = Form.useForm<Record<string, unknown>>();
  const [hits, setHits] = useState<MemorySearchHit[]>([]);
  const [meta, setMeta] = useState<{
    tookMs?: number;
    vectorCandidates?: number;
    keywordCandidates?: number;
    tokenCount?: number;
    degraded?: boolean;
  }>({});

  const search = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const result = await searchMemoryEntries({
        memory,
        query: String(values.query ?? ''),
        mode: String(values.mode ?? 'hybrid'),
        subject: admin ? String(values.subject ?? '') || undefined : undefined,
        types: Array.isArray(values.types) ? values.types.map(String) : undefined,
        tags: Array.isArray(values.tags) ? values.tags.map(String) : undefined,
        topK: Number(values.topK ?? 8),
        minScore: Number(values.minScore ?? 0.25),
        explain: true,
        persist: false,
      });
      setHits(result.hits ?? []);
      setMeta({
        tookMs: result.tookMs,
        vectorCandidates: result.vectorCandidates,
        keywordCandidates: result.keywordCandidates,
        tokenCount: result.tokenCount,
        degraded: result.degraded,
      });
    },
  });

  const columns: ColumnsType<MemorySearchHit> = [
    {
      title: '内容',
      dataIndex: ['entry', 'content'],
      ellipsis: true,
    },
    {
      title: '最终分',
      dataIndex: 'score',
      width: 90,
      render: value => Number(value ?? 0).toFixed(4),
    },
    {
      title: '向量分',
      width: 90,
      render: (_, row) => Number(row.breakdown?.vectorSimilarity ?? 0).toFixed(3),
    },
    {
      title: '排名（向量/关键字）',
      width: 150,
      render: (_, row) => `${row.breakdown?.vectorRank ?? '-'} / ${row.breakdown?.keywordRank ?? '-'}`,
    },
    {
      title: '时间 / 重要度',
      width: 120,
      render: (_, row) => `${Number(row.breakdown?.recency ?? 0).toFixed(2)} / ${Number(row.breakdown?.importance ?? 0).toFixed(2)}`,
    },
    {
      title: '类型',
      width: 100,
      render: (_, row) => <Tag>{row.entry.type ?? '-'}</Tag>,
    },
    {
      title: 'Token',
      dataIndex: 'tokenCount',
      width: 80,
    },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small">
        <Form
          form={form}
          layout="inline"
          initialValues={{ mode: 'hybrid', topK: 8, minScore: 0.25 }}
          onFinish={values => search.mutate(values)}
        >
          <Form.Item name="query" rules={[{ required: true, message: '请输入检索问题' }]}>
            <Input placeholder="要检索的记忆问题" style={{ width: 320 }} />
          </Form.Item>
          {admin && (
            <Form.Item
              name="subject"
              rules={[{ required: true, message: sessionScoped ? '请填写会话 ID' : '请填写 Subject' }]}
            >
              <Input placeholder={sessionScoped ? '会话 ID' : 'Subject'} style={{ width: 160 }} />
            </Form.Item>
          )}
          <Form.Item name="mode">
            <Select
              style={{ width: 110 }}
              options={[
                { label: '混合', value: 'hybrid' },
                { label: '向量', value: 'vector' },
                { label: '关键字', value: 'keyword' },
              ]}
            />
          </Form.Item>
          <Form.Item name="types">
            <Select mode="multiple" allowClear placeholder="类型" style={{ width: 180 }} options={TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="tags">
            <Select mode="tags" allowClear placeholder="标签" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="topK">
            <InputNumber min={1} max={50} addonBefore="TopK" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="minScore">
            <InputNumber min={0} max={1} step={0.05} addonBefore="阈值" style={{ width: 130 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={search.isPending}>
              检索
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {meta.degraded && (
        <Alert
          type="warning"
          showIcon
          message="Embedding 不可用或未命中，已降级为关键字检索。"
        />
      )}
      {hits.length > 0 && (
        <Descriptions size="small" column={4}>
          <Descriptions.Item label="耗时">{meta.tookMs ?? 0} ms</Descriptions.Item>
          <Descriptions.Item label="向量候选">{meta.vectorCandidates ?? 0}</Descriptions.Item>
          <Descriptions.Item label="关键字候选">{meta.keywordCandidates ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Token">{meta.tokenCount ?? 0}</Descriptions.Item>
        </Descriptions>
      )}

      <Table<MemorySearchHit>
        rowKey={row => row.entry.id}
        size="small"
        columns={columns}
        dataSource={hits}
        pagination={false}
        locale={{ emptyText: <Empty description="还没有检索结果" /> }}
      />
    </Space>
  );
}
