import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, App, Button, Card, Input, Result, Space, Switch, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { deleteUserGroup, listUserGroups, updateUserGroup, type UserGroup } from '@/api/userGroups';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import { formatDate } from '@/lib/date';
import UserGroupFormDrawer from '@/components/usergroup/FormDrawer';
import SubjectAuthorizeDrawer, {
  type SubjectAuthorizeTarget,
} from '@/components/permission/SubjectAuthorizeDrawer';
import { openTokenUnavailable } from '@/components/permission/TokenUnavailable';
import {
  EllipsisText,
  MoreActions,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_ID_TEXT_MAX_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  ResponsiveTable,
} from '@/ui';

/**
 * 用户组管理（管理员）。
 *
 * 组是策略的授权对象：规则写 `subject_type=group, subject_id=<组名>`，成员
 * 变化不需要改策略。页面只维护成员关系与启用状态，不直接写任何授权规则。
 */
export default function UserGroupsPage() {
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();

  const [keyword, setKeyword] = useState('');
  const [drawer, setDrawer] = useState<{ open: boolean; group: UserGroup | null }>({
    open: false,
    group: null,
  });
  const [savingName, setSavingName] = useState<string | null>(null);
  const [authorizeTarget, setAuthorizeTarget] = useState<SubjectAuthorizeTarget | null>(null);

  const query = useQuery({
    queryKey: ['user-groups', { keyword }],
    queryFn: () => listUserGroups({ offset: 0, limit: 0, keyword }),
    enabled: Boolean(claims?.isAdmin),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['user-groups'] });
  };

  if (!claims?.isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="403"
          title="需要管理员权限"
          subTitle="用户组只对管理员开放。请联系管理员为你的账号授予管理员角色。"
        />
      </div>
    );
  }

  const toggle = async (group: UserGroup, enabled: boolean) => {
    setSavingName(group.name);
    try {
      await updateUserGroup(group.name, {
        displayName: group.displayName,
        description: group.description,
        enabled,
        members: group.members,
      });
      message.success(enabled ? '已启用' : '已停用');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingName(null);
    }
  };

  const remove = async (group: UserGroup) => {
    try {
      await deleteUserGroup(group.name);
      message.success(`已删除用户组 ${group.name}`);
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const columns: ColumnsType<UserGroup> = [
    {
      title: '用户组名称',
      dataIndex: 'name',
      key: 'name',
      width: RESOURCE_ID_COLUMN_WIDTH,
      render: (value: string, group) => (
        <Space direction="vertical" size={0} style={{ maxWidth: RESOURCE_ID_TEXT_MAX_WIDTH }}>
          <Typography.Link
            strong
            onClick={() => navigate(`/user-groups/${encodeURIComponent(group.name)}`)}
            title={value}
          >
            {group.displayName || value}
          </Typography.Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {value}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '用户数量',
      key: 'members',
      render: (_, group) => (
        <Space size={4} wrap>
          <Tag color="blue">{group.members.length} 人</Tag>
          {group.members.slice(0, 2).map((member, index) => (
            <Typography.Text key={index} type="secondary" style={{ fontSize: 12 }}>
              {member.displayName || member.username || member.userID || member.larkUserID}
            </Typography.Text>
          ))}
          {group.members.length > 2 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              等
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (value?: string) => (
        <EllipsisText maxWidth={280} title={value}>
          {value || '-'}
        </EllipsisText>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (value: boolean, group) => (
        <Switch
          size="small"
          checked={value}
          loading={savingName === group.name}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={next => void toggle(group, next)}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => formatDate(value),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (value: string) => formatDate(value),
    },
    {
      title: '操作',
      key: 'actions',
      ...RESOURCE_ACTION_COLUMN,
      render: (_, group) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => setDrawer({ open: true, group })}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => openTokenUnavailable(modal, group.displayName || group.name)}
          >
            查看 Token
          </Button>
          <MoreActions
            items={[
              { key: 'authorize', label: '授权' },
              { key: 'delete', label: '删除', danger: true },
            ]}
            onClick={({ key }) => {
              if (key === 'authorize') {
                setAuthorizeTarget({
                  kind: 'group',
                  label: group.displayName || group.name,
                  groupName: group.name,
                });
                return;
              }
              if (key === 'delete') {
                modal.confirm({
                  title: `删除用户组 ${group.name}？`,
                  content: '删除后成员关系一并清除；引用该组的策略不会删除，但会变成永不匹配。',
                  okText: '删除',
                  okButtonProps: { danger: true },
                  cancelText: '取消',
                  onOk: () => remove(group),
                });
              }
            }}
          />
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        用户组
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        把一批账号组织成一个授权对象。策略按组名授权，成员变化即时生效，不需要修改策略；
        停用组会暂停该组的全部授权。同一个人可用账号 ID、登录名、飞书 user_id 或 open_id
        标识，覆盖不同访问路径。
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="搜索组名、显示名或描述"
            prefix={<SearchOutlined />}
            style={{ width: 280 }}
            onSearch={value => setKeyword(value.trim())}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setDrawer({ open: true, group: null })}
          >
            新建用户组
          </Button>
          <Typography.Text type="secondary">共 {query.data?.total ?? 0} 个用户组</Typography.Text>
        </Space>
      </Card>

      {query.isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          title="读取用户组失败"
          description={query.error instanceof Error ? query.error.message : undefined}
        />
      ) : null}

      <ResponsiveTable<UserGroup>
        rowKey="name"
        size="middle"
        loading={query.isLoading}
        columns={columns}
        dataSource={query.data?.items ?? []}
        {...RESOURCE_TABLE_LAYOUT}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 个用户组`,
        }}
      />

      <UserGroupFormDrawer
        open={drawer.open}
        group={drawer.group}
        onClose={() => setDrawer({ open: false, group: null })}
        onSaved={() => void refresh()}
      />

      <SubjectAuthorizeDrawer
        open={authorizeTarget !== null}
        target={authorizeTarget}
        onClose={() => setAuthorizeTarget(null)}
        onSaved={() => void refresh()}
      />
    </div>
  );
}
