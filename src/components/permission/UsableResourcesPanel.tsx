import { useMemo, useState } from 'react';
import { Empty, Input, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { kindLabel, verbLabel } from '@/pages/Policies/options';
import type { UsableResourceRow } from './authz';

interface Props {
  rows: UsableResourceRow[];
  loading?: boolean;
}

/**
 * 「可操作资源」页签：按资源类型分页签，列出策略授予的名称与动作。
 *
 * 这是控制台近似视图，不展开命名空间继承与资源属性条件；最终判定以 OPA 为准。
 */
export default function UsableResourcesPanel({ rows, loading }: Props) {
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState<string>();

  const groups = useMemo(() => {
    const map = new Map<string, UsableResourceRow[]>();
    for (const row of rows) {
      const list = map.get(row.kind) ?? [];
      list.push(row);
      map.set(row.kind, list);
    }
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [rows]);

  const current = groups.find(([kind]) => kind === active) ?? groups[0];
  const search = keyword.trim().toLowerCase();
  const visible = current
    ? current[1].filter(row => !search || row.name.toLowerCase().includes(search))
    : [];

  const columns: ColumnsType<UsableResourceRow> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) =>
        name === '*' ? (
          <Tag color="green">全部（含后续新增）</Tag>
        ) : (
          <Typography.Text>{name}</Typography.Text>
        ),
    },
    {
      title: '权限',
      key: 'verbs',
      render: (_, row) => (
        <Space size={4} wrap>
          {row.verbs.map(verb => (
            <Tag key={verb} color={verb === 'write' ? 'volcano' : 'green'}>
              {verbLabel(verb)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '来源策略',
      key: 'sources',
      render: (_, row) => (
        <Space size={4} wrap>
          {row.sources.map(source => (
            <Tag key={source}>{source}</Tag>
          ))}
        </Space>
      ),
    },
  ];

  if (!loading && rows.length === 0) {
    return <Empty description="当前主体没有可操作资源，或所有授权均已停用" />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Input.Search
        allowClear
        placeholder="搜索资源名"
        value={keyword}
        onChange={event => setKeyword(event.target.value)}
        style={{ width: 280 }}
      />
      <Tabs
        activeKey={current?.[0]}
        onChange={setActive}
        items={groups.map(([kind, list]) => ({
          key: kind,
          label: `${kindLabel(kind)}（${list.length}）`,
          children: (
            <Table<UsableResourceRow>
              rowKey="key"
              size="small"
              loading={loading}
              columns={columns}
              dataSource={visible}
              pagination={false}
              locale={{ emptyText: search ? '没有匹配的资源' : '该类型下没有资源' }}
              scroll={{ x: 'max-content' }}
            />
          ),
        }))}
      />
    </Space>
  );
}
