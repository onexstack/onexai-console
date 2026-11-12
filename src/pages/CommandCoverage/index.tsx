import { useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Spin, Statistic, Table, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { getCommandCoverage } from '@/api/chat';
import { PageHeader, PageSurface } from '@/ui';

/**
 * 命令覆盖报告。
 *
 * 命令是 deny-by-default 的：没有任何 AgentBinding 覆盖的智能体，看起来和正常的
 * 一模一样，直到有人在会话里输入一个命令。这个页面存在的唯一目的，就是让
 * 「谁一条命令都没有」变得可见。
 */
export default function CommandCoveragePage() {
  const [keyword, setKeyword] = useState('');
  const query = useQuery({
    queryKey: ['chat', 'command-coverage'],
    queryFn: getCommandCoverage,
    staleTime: 30_000,
  });

  const agents = useMemo(() => {
    const list = query.data?.agents ?? [];
    const q = keyword.trim().toLowerCase();
    const filtered = q ? list.filter(item => item.agent.toLowerCase().includes(q)) : list;
    // 没有覆盖的排前面：这是这个报告要回答的问题。
    return [...filtered].sort((a, b) => (a.rules?.length ?? 0) - (b.rules?.length ?? 0));
  }, [query.data, keyword]);

  // 标题先于状态：加载 / 出错时也要有页面标题，否则整页只剩一个转圈。
  const header = <PageHeader title="命令覆盖" inset={false} />;

  if (query.isLoading) {
    return (
      <PageSurface>
        {header}
        <Spin />
      </PageSurface>
    );
  }
  if (query.isError) {
    return (
      <PageSurface>
        {header}
        <Alert
          type="error"
          showIcon
          title="读取命令覆盖失败"
          description={(query.error as Error).message}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      </PageSurface>
    );
  }

  const total = query.data?.agents?.length ?? 0;
  const withNothing = query.data?.withNothing ?? 0;

  return (
    <PageSurface>
      {header}
      <Alert
        type={withNothing > 0 ? 'warning' : 'success'}
        showIcon
        style={{ marginBottom: 16 }}
        title={
          withNothing > 0
            ? `${withNothing} 个智能体没有任何命令覆盖`
            : '所有智能体都至少被一条规则覆盖'
        }
        description="命令是 deny-by-default 的。没有被覆盖的智能体在会话里输入命令不会有任何反应，而它看起来和正常智能体没有区别。"
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Card size="small" style={{ minWidth: 180 }}>
          <Statistic title="智能体总数" value={total} />
        </Card>
        <Card size="small" style={{ minWidth: 180 }}>
          <Statistic
            title="无命令覆盖"
            value={withNothing}
            valueStyle={{ color: withNothing > 0 ? 'var(--color-warning)' : undefined }}
          />
        </Card>
        <Card size="small" style={{ minWidth: 180 }}>
          <Statistic title="已覆盖" value={total - withNothing} />
        </Card>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input
          allowClear
          placeholder="按智能体名筛选"
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          style={{ maxWidth: 280 }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
          刷新
        </Button>
      </div>

      <Table
        size="small"
        rowKey="agent"
        dataSource={agents}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty description="这个部署还没有智能体" /> }}
        columns={[
          {
            title: '智能体',
            dataIndex: 'agent',
            key: 'agent',
            render: (name: string) => (
              <Link to={`/agents/${encodeURIComponent(name)}`}>{name}</Link>
            ),
          },
          {
            title: '覆盖规则',
            dataIndex: 'rules',
            key: 'rules',
            render: (rules?: string[]) =>
              rules && rules.length > 0 ? (
                rules.map(rule => (
                  <Tag key={rule} color="blue">
                    {rule}
                  </Tag>
                ))
              ) : (
                <Tag color="red">无</Tag>
              ),
          },
          {
            title: '命令',
            dataIndex: 'commands',
            key: 'commands',
            render: (commands?: string[]) => (commands?.length ? commands.join(' ') : '-'),
          },
          {
            title: 'Skill',
            dataIndex: 'skills',
            key: 'skills',
            width: 220,
            render: (skills?: string[]) => (skills?.length ? skills.join(', ') : '-'),
          },
        ]}
      />
    </PageSurface>
  );
}
