import { useMemo, useState } from 'react';
import { Alert, Input, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';

import { listMemoryAudit } from '@/api/memory';
import type { PlatformMemoryAudit } from '@/api/types';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import { formatDate } from '@/lib/date';

const ACTION_OPTIONS = [
  { label: '创建', value: 'create' },
  { label: '更新', value: 'update' },
  { label: '删除', value: 'delete' },
  { label: '去重', value: 'dedupe' },
  { label: '清空', value: 'purge' },
  { label: '重建索引', value: 'reembed' },
  { label: '检索测试', value: 'search' },
];

const ACTION_COLOR: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  dedupe: 'gold',
  purge: 'volcano',
  reembed: 'purple',
  search: 'cyan',
};

export default function MemoryAuditPanel({ memory }: { memory: string }) {
  const token = useSessionToken();
  const admin = useMemo(() => decodeClaims(token)?.isAdmin === true, [token]);
  const [subject, setSubject] = useState('');
  const [action, setAction] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const audit = useQuery({
    queryKey: ['memory-audit', memory, { subject, action, page, pageSize }],
    queryFn: () =>
      listMemoryAudit(memory, {
        subject: subject || undefined,
        action,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
    enabled: admin,
  });

  if (!admin) {
    return <Alert type="warning" showIcon message="审计只对管理员开放。" />;
  }

  const columns: ColumnsType<PlatformMemoryAudit> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 180,
      render: value => (value ? formatDate(Number(value)) : '-'),
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      render: value => <Tag color={ACTION_COLOR[String(value ?? '')] ?? 'default'}>{actionLabel(String(value ?? ''))}</Tag>,
    },
    { title: 'Subject', dataIndex: 'subject', width: 180, ellipsis: true },
    { title: '操作者', dataIndex: 'actor', width: 150, ellipsis: true },
    { title: '条目 ID', dataIndex: 'entryId', width: 220, ellipsis: true },
    { title: '来源', dataIndex: 'source', width: 100 },
    { title: '说明', dataIndex: 'reason', ellipsis: true },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Input
          allowClear
          placeholder="按 Subject 过滤"
          style={{ width: 220 }}
          value={subject}
          onChange={event => {
            setSubject(event.target.value);
            setPage(1);
          }}
        />
        <Select
          allowClear
          placeholder="动作"
          style={{ width: 140 }}
          value={action}
          onChange={value => {
            setAction(value);
            setPage(1);
          }}
          options={ACTION_OPTIONS}
        />
      </Space>
      <Table<PlatformMemoryAudit>
        rowKey="id"
        size="middle"
        loading={audit.isLoading}
        columns={columns}
        dataSource={audit.data?.audits ?? []}
        pagination={{
          current: page,
          pageSize,
          total: audit.data?.count ?? 0,
          showSizeChanger: true,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
          },
        }}
        locale={{ emptyText: '暂无审计记录' }}
      />
    </Space>
  );
}

function actionLabel(value: string): string {
  return ACTION_OPTIONS.find(item => item.value === value)?.label ?? value ?? '-';
}
