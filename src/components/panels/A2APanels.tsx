import { Alert, Collapse, Empty, Space, Table, Tag, Typography } from 'antd';

import type { PlatformAgent, PlatformA2ASkill } from '@/api/types';

function a2aOf(record: Record<string, unknown>) {
  return (record as unknown as PlatformAgent).a2a;
}

/** AgentCard 原文与规范化摘要。 */
export function A2ACardPanel({ record }: { record: Record<string, unknown> }) {
  const agent = record as unknown as PlatformAgent;
  const a2a = a2aOf(record);
  if (!a2a) {
    return <Empty description="尚未同步 AgentCard" />;
  }
  const raw = a2a.card ? pretty(a2a.card) : '';
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {a2a.lastSyncError && (
        <Alert type="warning" showIcon title="最近同步失败" description={a2a.lastSyncError} />
      )}
      <Space size={[8, 8]} wrap>
        <Tag>协议 {a2a.protocolVersion || '-'}</Tag>
        <Tag>传输 {a2a.transport || '-'}</Tag>
        <Tag>版本 {a2a.cardVersion || '-'}</Tag>
        <Tag>摘要 {a2a.cardDigest ? a2a.cardDigest.slice(0, 12) : '-'}</Tag>
        {a2a.capabilities?.streaming && <Tag color="blue">Streaming</Tag>}
        {a2a.capabilities?.pushNotifications && <Tag color="purple">Push</Tag>}
        {a2a.capabilities?.extendedAgentCard && <Tag>ExtendedCard</Tag>}
      </Space>
      <Typography.Text type="secondary">
        服务地址：{a2a.resolvedEndpoint || agent.endpoint || '-'}
      </Typography.Text>
      {raw ? (
        <Collapse
          size="small"
          items={[
            {
              key: 'raw',
              label: '原始 AgentCard JSON',
              children: (
                <pre style={{ maxHeight: 420, overflow: 'auto', margin: 0 }}>{raw}</pre>
              ),
            },
          ]}
        />
      ) : (
        <Alert type="info" showIcon title="卡片原文未保存在状态中（可能超过 256KiB）" />
      )}
    </Space>
  );
}

/** 卡片技能表。 */
export function A2ASkillsPanel({ record }: { record: Record<string, unknown> }) {
  const skills = a2aOf(record)?.skills ?? [];
  if (skills.length === 0) {
    return <Empty description="该智能体未声明技能，仍可直接对话" />;
  }
  return (
    <Table<PlatformA2ASkill>
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={skills}
      columns={[
        { title: 'ID', dataIndex: 'id', width: 180 },
        { title: '名称', dataIndex: 'name', width: 200 },
        { title: '描述', dataIndex: 'description' },
        {
          title: '标签',
          dataIndex: 'tags',
          width: 220,
          render: (tags?: string[]) => (
            <Space size={[4, 4]} wrap>
              {(tags ?? []).map(tag => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
          ),
        },
      ]}
    />
  );
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
