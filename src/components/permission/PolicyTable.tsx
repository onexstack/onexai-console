import type { ReactNode } from 'react';
import { Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router';

import type { AuthorizationPolicy } from '@/api/policies';
import { formatDate } from '@/lib/date';
import { resourceSummary, verbLabel } from '@/pages/Policies/options';

interface Props {
  policies: AuthorizationPolicy[];
  loading?: boolean;
  emptyText?: string;
  /** 额外一列「来源」：直接 / 用户组 / 所有主体。 */
  sourceOf?: (policy: AuthorizationPolicy) => ReactNode;
}

/** 某个主体命中的策略表；用户详情、用户组详情共用。 */
export default function PolicyTable({ policies, loading, emptyText, sourceOf }: Props) {
  const columns: ColumnsType<AuthorizationPolicy> = [
    {
      title: '策略',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Link to={`/policies/${encodeURIComponent(name)}`}>{name}</Link>,
    },
    ...(sourceOf
      ? [
          {
            title: '来源',
            key: 'source',
            render: (_: unknown, policy: AuthorizationPolicy) => sourceOf(policy),
          } as ColumnsType<AuthorizationPolicy>[number],
        ]
      : []),
    {
      title: '资源',
      key: 'resources',
      render: (_, policy) => (
        <Space size={4} wrap>
          {(policy.resources ?? []).map((resource, index) => (
            <Tag key={`${resource.kind}-${index}`} color="geekblue">
              {resourceSummary(resource)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '动作',
      key: 'verbs',
      render: (_, policy) => (
        <Space size={4} wrap>
          {(policy.verbs ?? []).map(verb => (
            <Tag key={verb} color={verb === 'write' ? 'volcano' : 'green'}>
              {verbLabel(verb)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '效果',
      dataIndex: 'effect',
      key: 'effect',
      render: (value: string) => (
        <Tag color={value === 'deny' ? 'red' : 'green'}>
          {value === 'deny' ? '拒绝（优先）' : '允许'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: string) => (
        <Tag color={value === 'disabled' ? 'default' : 'blue'}>
          {value === 'disabled' ? '停用' : '启用'}
        </Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (value?: number) =>
        value ? (
          <Typography.Text>{formatDate(new Date(value).toISOString())}</Typography.Text>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <Table<AuthorizationPolicy>
      rowKey="name"
      size="small"
      columns={columns}
      dataSource={policies}
      loading={loading}
      pagination={{
        pageSize: 20,
        showSizeChanger: true,
        showTotal: total => `共 ${total} 条策略`,
      }}
      locale={{ emptyText: emptyText ?? '没有命中的策略' }}
      scroll={{ x: 'max-content' }}
    />
  );
}
