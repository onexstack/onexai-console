import { useMemo } from 'react';
import { Alert, Button, Card, Empty, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';

import {
  getPolicy,
  normalizeSubjectKind,
  subjectsOf,
  type AuthorizationPolicy,
} from '@/api/policies';
import { UserAliasRef } from '@/components/UserRef';
import { GroupRef } from '@/components/usergroup/useUserGroups';
import { formatDate } from '@/lib/date';
import { kindLabel, verbLabel } from './options';
import styles from './styles.module.scss';

interface Props {
  name?: string;
  onEdit: (policy: AuthorizationPolicy) => void;
  onDelete: (policy: AuthorizationPolicy) => void;
  onToggleStatus: (policy: AuthorizationPolicy, next: boolean) => Promise<void> | void;
}

/**
 * 策略页右栏：选中策略的详情。
 *
 * 独立按名称读取，刷新和深链都能还原；用户/用户组主体折叠为账号与组链接，
 * 但解析不到的身份别名原样展示——策略可以引用一个已删除的组或历史身份。
 */
export default function PolicyDetailPane({ name, onEdit, onDelete, onToggleStatus }: Props) {
  const query = useQuery({
    queryKey: ['policies', 'item', name],
    queryFn: () => getPolicy(name as string),
    enabled: Boolean(name),
  });
  const policy = query.data;

  const subjectGroups = useMemo(() => {
    const groups: Record<'user' | 'group' | 'serviceaccount' | 'other', string[]> = {
      user: [],
      group: [],
      serviceaccount: [],
      other: [],
    };
    if (!policy) return groups;
    for (const subject of subjectsOf(policy)) {
      const kind = normalizeSubjectKind(subject.kind);
      if (subject.name === '*') {
        groups.other.push('*');
        continue;
      }
      if (kind === 'User') groups.user.push(subject.name);
      else if (kind === 'Group') groups.group.push(subject.name);
      else if (kind === 'ServiceAccount') groups.serviceaccount.push(subject.name);
      else groups.other.push(`${subject.kind}/${subject.name}`);
    }
    return {
      user: [...new Set(groups.user)],
      group: [...new Set(groups.group)],
      serviceaccount: [...new Set(groups.serviceaccount)],
      other: [...new Set(groups.other)],
    };
  }, [policy]);

  const resourceGroups = useMemo(() => {
    if (!policy) return [] as { kind: string; names: string[] }[];
    const map = new Map<string, Set<string>>();
    for (const resource of policy.resources ?? []) {
      const names = map.get(resource.kind) ?? new Set<string>();
      for (const name of resource.names) names.add(name);
      map.set(resource.kind, names);
    }
    return [...map.entries()].map(([kind, names]) => ({ kind, names: [...names] }));
  }, [policy]);

  if (!name) {
    return (
      <Card>
        <Empty description="暂无选中策略" />
      </Card>
    );
  }

  if (query.isLoading) {
    return (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin />
        </div>
      </Card>
    );
  }

  if (query.isError || !policy) {
    return (
      <Card>
        <Alert
          type="error"
          showIcon
          title="读取策略失败"
          description={query.error instanceof Error ? query.error.message : undefined}
        />
      </Card>
    );
  }

  const wildcard = subjectGroups.other.includes('*');
  const subjectTabs = [
    {
      key: 'users',
      label: `用户（${subjectGroups.user.length}）`,
      children:
        subjectGroups.user.length === 0 ? (
          <Typography.Text type="secondary">暂无对应授权对象</Typography.Text>
        ) : (
          <Space size={8} wrap>
            {subjectGroups.user.map(alias => (
              <UserAliasRef key={alias} value={alias} />
            ))}
          </Space>
        ),
    },
    {
      key: 'groups',
      label: `用户组（${subjectGroups.group.length}）`,
      children:
        subjectGroups.group.length === 0 ? (
          <Typography.Text type="secondary">暂无对应授权对象</Typography.Text>
        ) : (
          <Space size={8} wrap>
            {subjectGroups.group.map(group => (
              <GroupRef key={group} name={group} />
            ))}
          </Space>
        ),
    },
  ];
  if (subjectGroups.serviceaccount.length > 0 || subjectGroups.other.length > 0) {
    subjectTabs.push({
      key: 'others',
      label: `其他主体（${subjectGroups.serviceaccount.length + subjectGroups.other.length}）`,
      children: (
        <Space size={4} wrap>
          {wildcard ? <Tag color="red">所有主体</Tag> : null}
          {subjectGroups.serviceaccount.map(name => (
            <Tag key={`sa/${name}`} color="cyan">
              服务账号：{name}
            </Tag>
          ))}
          {subjectGroups.other
            .filter(value => value !== '*')
            .map(value => (
              <Tag key={value}>{value}</Tag>
            ))}
        </Space>
      ),
    });
  }

  const resourceColumns: ColumnsType<{ name: string }> = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '权限',
      key: 'verbs',
      render: () => (
        <Space size={4} wrap>
          {(policy.verbs ?? ['read']).map(verb => (
            <Tag key={verb} color={verb === 'write' ? 'volcano' : 'green'}>
              {verbLabel(verb)}
            </Tag>
          ))}
        </Space>
      ),
    },
  ];

  const resourceTabs = resourceGroups.map(group => {
    const all = group.names.includes('*');
    return {
      key: group.kind,
      label: `${kindLabel(group.kind)}（${all ? 1 : group.names.length}）`,
      children: all ? (
        <Typography.Text>全部{kindLabel(group.kind)}（含后续新增）</Typography.Text>
      ) : (
        <Table<{ name: string }>
          rowKey="name"
          size="small"
          columns={resourceColumns}
          dataSource={group.names.map(value => ({ name: value }))}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      ),
    };
  });

  return (
    <Card>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div className={styles.detailHeader}>
          <div>
            <Typography.Title level={4} className={styles.detailTitle}>
              {policy.name}
            </Typography.Title>
            <Space size={4} wrap className={styles.detailMeta}>
              <Tag color={policy.effect === 'deny' ? 'red' : 'green'}>
                {policy.effect === 'deny' ? '拒绝（优先）' : '允许'}
              </Tag>
              <Tag color={policy.status === 'disabled' ? 'default' : 'blue'}>
                {policy.status === 'disabled' ? '停用' : '启用'}
              </Tag>
              {(policy.verbs ?? ['read']).map(verb => (
                <Tag key={verb} color={verb === 'write' ? 'volcano' : 'green'}>
                  {verbLabel(verb)}
                </Tag>
              ))}
              {policy.updatedAt ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  更新于 {formatDate(new Date(policy.updatedAt).toISOString())}
                </Typography.Text>
              ) : null}
            </Space>
          </div>
          <Space>
            <Button onClick={() => onToggleStatus(policy, policy.status === 'disabled')}>
              {policy.status === 'disabled' ? '启用' : '停用'}
            </Button>
            <Button onClick={() => onEdit(policy)}>编辑</Button>
            <Button danger onClick={() => onDelete(policy)}>
              删除
            </Button>
          </Space>
        </div>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {policy.description || '无备注'}
        </Typography.Paragraph>

        <Card size="small" title="用户｜用户组">
          <Tabs items={subjectTabs} />
        </Card>

        <Card size="small" title="资源">
          {resourceTabs.length > 0 ? (
            <Tabs items={resourceTabs} />
          ) : (
            <Empty description="该策略没有配置资源" />
          )}
        </Card>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          最终是否允许由服务端按 deny 优先、无匹配拒绝的规则计算；这里展示的是策略配置，
          不是逐请求的判定结果。
        </Typography.Text>
      </Space>
    </Card>
  );
}
