import { useMemo, useState } from 'react';
import { Alert, Card, Col, Input, Row, Space, Statistic, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';

import { getMemoryStats } from '@/api/memory';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';

export default function MemoryStatsPanel({
  memory,
  sessionScoped = false,
}: {
  memory: string;
  sessionScoped?: boolean;
}) {
  const token = useSessionToken();
  const admin = useMemo(() => decodeClaims(token)?.isAdmin === true, [token]);
  const [subject, setSubject] = useState('');

  const stats = useQuery({
    queryKey: ['memory-stats', memory, subject],
    queryFn: () => getMemoryStats(memory, admin ? subject || undefined : undefined),
  });

  const data = stats.data;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {admin && (
        <Space>
          <Input
            allowClear
            placeholder={
              sessionScoped ? '按会话 ID 过滤（留空表示全部）' : '按 Subject 过滤（留空表示全部）'
            }
            style={{ width: 280 }}
            value={subject}
            onChange={event => setSubject(event.target.value)}
          />
        </Space>
      )}
      {stats.isError && (
        <Alert type="error" showIcon message={(stats.error as Error)?.message ?? '统计读取失败'} />
      )}
      <Row gutter={16}>
        <Col span={4}>
          <Card size="small">
            <Statistic title="条目总数" value={data?.total ?? 0} loading={stats.isLoading} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="用户数" value={data?.subjects ?? 0} loading={stats.isLoading} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="待 embedding" value={data?.pendingEmbeddings ?? 0} loading={stats.isLoading} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="embedding 失败" value={data?.failedEmbeddings ?? 0} loading={stats.isLoading} />
          </Card>
        </Col>
      </Row>
      <Card size="small" title="按类型">
        <Space wrap>
          {Object.entries(data?.byType ?? {}).map(([key, value]) => (
            <Tag key={key}>
              {key}：{value}
            </Tag>
          ))}
          {Object.keys(data?.byType ?? {}).length === 0 && <Tag>暂无数据</Tag>}
        </Space>
      </Card>
      <Card size="small" title="按状态">
        <Space wrap>
          {Object.entries(data?.byStatus ?? {}).map(([key, value]) => (
            <Tag key={key}>
              {key}：{value}
            </Tag>
          ))}
          {Object.keys(data?.byStatus ?? {}).length === 0 && <Tag>暂无数据</Tag>}
        </Space>
      </Card>
    </Space>
  );
}
