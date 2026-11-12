import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { listA2AInvocations, type A2AInvocation } from '@/api/a2a';
import { formatDate } from '@/lib/date';

const STATE_COLORS: Record<string, string> = {
  completed: 'green',
  working: 'blue',
  submitted: 'blue',
  'input-required': 'orange',
  'auth-required': 'orange',
  failed: 'red',
  canceled: 'default',
  disconnected: 'default',
};

export function A2AInvocationsPanel({ name }: { name: string }) {
  const query = useQuery({
    queryKey: ['a2a', name, 'invocations'],
    queryFn: () => listA2AInvocations(name, { offset: 0, limit: 50 }),
    staleTime: 10_000,
  });

  if (query.isError) {
    return (
      <Alert
        type="error"
        showIcon
        title="读取调用记录失败"
        description={(query.error as Error).message}
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  }

  const rows = query.data?.invocations ?? [];
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space>
        <Typography.Text type="secondary">
          最近 {rows.length} 条（共 {query.data?.count ?? 0} 条）
        </Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
          刷新
        </Button>
      </Space>
      <Table<A2AInvocation>
        rowKey="invocationId"
        size="small"
        loading={query.isLoading}
        dataSource={rows}
        pagination={false}
        expandable={{
          expandedRowRender: row => (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <div>
                <Typography.Text strong>输入</Typography.Text>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{row.input || '-'}</pre>
              </div>
              <div>
                <Typography.Text strong>输出</Typography.Text>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{row.output || '-'}</pre>
              </div>
              {row.error && <Alert type="error" showIcon title="错误" description={row.error} />}
              {row.artifacts && (
                <div>
                  <Typography.Text strong>工件</Typography.Text>
                  <pre style={{ margin: 0, maxHeight: 240, overflow: 'auto' }}>{pretty(row.artifacts)}</pre>
                </div>
              )}
            </Space>
          ),
        }}
        columns={[
          {
            title: '时间',
            dataIndex: 'createdAt',
            width: 170,
            render: (value?: number) => (value ? formatDate(value) : '-'),
          },
          { title: '来源', dataIndex: 'source', width: 100 },
          {
            title: '状态',
            dataIndex: 'state',
            width: 130,
            render: (value?: string) => (
              <Tag color={STATE_COLORS[value ?? '']}>{value || '-'}</Tag>
            ),
          },
          {
            title: '耗时',
            dataIndex: 'latencyMs',
            width: 100,
            render: (value?: number) => (value == null ? '-' : `${value}ms`),
          },
          { title: 'Task', dataIndex: 'taskId', ellipsis: true },
          {
            title: '调用方',
            key: 'caller',
            width: 160,
            render: (_, row) => row.callerName || row.callerAgent || row.callerId || '-',
          },
        ]}
      />
    </Space>
  );
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
