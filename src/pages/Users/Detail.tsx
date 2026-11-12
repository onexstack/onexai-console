import { useMemo, useState } from 'react';
import { App, Button, Result, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';

import { deleteUser, getUser, updateUser } from '@/api/auth';
import type { UserGroup } from '@/api/userGroups';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import PolicyTable from '@/components/permission/PolicyTable';
import SubjectAuthorizeDrawer, {
  type SubjectAuthorizeTarget,
} from '@/components/permission/SubjectAuthorizeDrawer';
import SubjectDetailLayout from '@/components/permission/SubjectDetailLayout';
import { TokenUnavailableNotice } from '@/components/permission/TokenUnavailable';
import UsableResourcesPanel from '@/components/permission/UsableResourcesPanel';
import { userAliasesOf } from '@/components/permission/authz';
import { useSubjectPolicies } from '@/components/permission/useSubjectPolicies';
import UserGroupMembershipDrawer from '@/components/usergroup/MembershipDrawer';
import { groupsOfUser, useUserGroups } from '@/components/usergroup/useUserGroups';
import { useGoBack } from '@/runtime/hooks';
import { InfoSection, StatusSwitch, type InfoItem } from '@/ui';
import { formatDate } from '@/lib/date';
import { ROLE_OPTIONS, roleLabel } from './roles';

/**
 * 用户详情：信息卡 + 「用户组 / 权限策略 / 可操作资源」页签。
 *
 * 数据按 ID 读取，刷新和从聊天窗口复制来的链接都成立；不依赖列表行通过
 * navigation state 传过来的对象。
 */
export default function UserDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const navigate = useNavigate();
  const goBack = useGoBack('/users');
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();

  const [membershipOpen, setMembershipOpen] = useState(false);
  const [authorizeTarget, setAuthorizeTarget] = useState<SubjectAuthorizeTarget | null>(null);

  const isAdmin = Boolean(claims?.isAdmin);
  const query = useQuery({
    queryKey: ['users', 'item', id],
    queryFn: () => getUser(id),
    enabled: isAdmin && Boolean(id),
  });
  const user = query.data;

  const groupsQuery = useUserGroups(isAdmin && Boolean(user));
  const userGroups = groupsOfUser(user, groupsQuery.groups);
  const aliases = userAliasesOf(user);
  // 停用组不产生任何授权；成员关系仍展示在「用户组」页签里，但不参与策略命中。
  const subject = useSubjectPolicies(
    { aliases, groupNames: userGroups.filter(group => group.enabled).map(group => group.name) },
    isAdmin && Boolean(user)
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['users'] });
    await queryClient.invalidateQueries({ queryKey: ['user-groups'] });
    await queryClient.invalidateQueries({ queryKey: ['policies'] });
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="403"
          title="需要管理员权限"
          subTitle="用户详情只对管理员开放。请联系管理员为你的账号授予管理员角色。"
        />
      </div>
    );
  }

  const self = user?.id === claims?.userId;

  const saveDisplayName = async (next: string) => {
    if (!user) return;
    try {
      await updateUser(user.id, { display_name: next.trim() });
      message.success('已保存');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
      throw err;
    }
  };

  const saveRole = async (next: string) => {
    if (!user) return;
    try {
      await updateUser(user.id, { role: next });
      message.success('已保存');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
      throw err;
    }
  };

  const toggleStatus = async (next: boolean) => {
    if (!user) return;
    try {
      await updateUser(user.id, { status: next ? 'active' : 'disabled' });
      message.success(next ? '已启用' : '已禁用');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const confirmDelete = () => {
    if (!user) return;
    modal.confirm({
      title: `删除账号 ${user.username}？`,
      content: '删除后无法恢复：该账号的凭据与飞书绑定会一并清除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteUser(user.id);
        await queryClient.invalidateQueries({ queryKey: ['users'] });
        message.success(`已删除账号 ${user.username}`);
        navigate('/users', { replace: true });
      },
    });
  };

  const items: InfoItem[] = user
    ? [
        { label: '账号名', value: user.username },
        {
          label: '账号 ID',
          value: user.id,
          rawValue: user.id,
          copyable: true,
        },
        {
          label: '显示名',
          value: user.display_name || '-',
          editable: {
            currentValue: user.display_name ?? '',
            maxLength: 32,
            onSave: saveDisplayName,
          },
        },
        { label: '邮箱', value: user.email || '-' },
        {
          label: '角色',
          value: roleLabel(user.role),
          editable: self
            ? undefined
            : {
                type: 'select',
                options: ROLE_OPTIONS,
                currentValue: user.role ?? '',
                onSave: saveRole,
              },
        },
        {
          label: '状态',
          value: (
            <StatusSwitch
              checked={user.status === 'active'}
              onLabel="正常"
              offLabel="已禁用"
              disabled={self}
              onChange={next => toggleStatus(next)}
              confirm={{
                title: `${user.status === 'active' ? '禁用' : '启用'} ${user.username}？`,
                description:
                  user.status === 'active'
                    ? '禁用后该账号无法登录；已签发的令牌会在短时间内失效。'
                    : '启用后该账号可以重新登录。',
                okText: user.status === 'active' ? '禁用' : '启用',
                okButtonProps: user.status === 'active' ? { danger: true } : undefined,
                cancelText: '取消',
              }}
            />
          ),
        },
        {
          label: '飞书',
          value: user.feishu ? (
            <Space size={4} wrap>
              <Tag color="blue">已绑定</Tag>
              <Typography.Text>{user.feishu.name || user.feishu.open_id}</Typography.Text>
            </Space>
          ) : (
            <Typography.Text type="secondary">未绑定</Typography.Text>
          ),
        },
        { label: '注册时间', value: formatDate(user.created_at) },
        {
          label: '上次登录',
          value: user.last_login_at ? formatDate(user.last_login_at) : '-',
        },
      ]
    : [];

  const groupColumns: ColumnsType<UserGroup> = [
    {
      title: '用户组名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, group) => (
        <Link to={`/user-groups/${encodeURIComponent(name)}`}>{group.displayName || name}</Link>
      ),
    },
    { title: '组 ID', dataIndex: 'name', key: 'id', render: (name: string) => name },
    {
      title: '成员',
      key: 'members',
      render: (_, group) => `${group.members.length} 人`,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled: boolean) => (
        <Tag color={enabled ? 'blue' : 'default'}>{enabled ? '启用' : '停用'}</Tag>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (value?: string) => value || '-',
    },
  ];

  const sourceOf = (policyName: string) => {
    const match = subject.matches.find(item => item.policy.name === policyName);
    if (!match) return '-';
    if (match.source === 'direct') return <Tag color="blue">直接</Tag>;
    if (match.source === 'wildcard') return <Tag color="orange">所有主体</Tag>;
    return <Tag color="purple">用户组：{match.via}</Tag>;
  };

  const tabs = user
    ? [
        {
          key: 'groups',
          label: `用户组（${userGroups.length}）`,
          children: (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space>
                <Button onClick={() => setMembershipOpen(true)}>编辑关联</Button>
              </Space>
              <Table<UserGroup>
                rowKey="name"
                size="small"
                columns={groupColumns}
                dataSource={userGroups}
                loading={groupsQuery.isLoading}
                pagination={false}
                locale={{ emptyText: '未加入任何用户组' }}
                scroll={{ x: 'max-content' }}
              />
            </Space>
          ),
        },
        {
          key: 'policies',
          label: `权限策略（${subject.matches.length}）`,
          children: (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space>
                <Button
                  onClick={() =>
                    setAuthorizeTarget({
                      kind: 'user',
                      label: user.username,
                      identities: aliases,
                    })
                  }
                >
                  管理授权
                </Button>
              </Space>
              <PolicyTable
                policies={subject.matches.map(match => match.policy)}
                loading={subject.isLoading}
                sourceOf={match => sourceOf(match.name)}
                emptyText="没有直接或经由用户组命中的策略"
              />
            </Space>
          ),
        },
        {
          key: 'resources',
          label: '可操作资源',
          children: (
            <UsableResourcesPanel rows={subject.usableResources} loading={subject.isLoading} />
          ),
        },
      ]
    : [];

  const actions = user ? (
    <Space>
      <Button
        onClick={() =>
          navigate(`/users/${encodeURIComponent(user.id)}/password`, {
            state: { username: user.username },
          })
        }
      >
        修改密码
      </Button>
      <Button
        onClick={() =>
          setAuthorizeTarget({
            kind: 'user',
            label: user.username,
            identities: aliases,
          })
        }
      >
        授权
      </Button>
      <Button danger disabled={self} onClick={confirmDelete}>
        删除
      </Button>
    </Space>
  ) : null;

  return (
    <>
      <SubjectDetailLayout
        title={`用户详情（${user?.username ?? id}）`}
        onBack={goBack}
        actions={actions}
        loading={query.isLoading}
        error={
          query.isError
            ? query.error instanceof Error
              ? query.error.message
              : '读取账号失败'
            : undefined
        }
        onRetry={() => void query.refetch()}
        info={
          user ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <InfoSection title="用户信息" items={items} />
              <TokenUnavailableNotice />
            </Space>
          ) : null
        }
        tabs={tabs}
      />

      <UserGroupMembershipDrawer
        open={membershipOpen}
        user={user ?? null}
        onClose={() => setMembershipOpen(false)}
        onSaved={() => void refresh()}
      />
      <SubjectAuthorizeDrawer
        open={authorizeTarget !== null}
        target={authorizeTarget}
        onClose={() => setAuthorizeTarget(null)}
        onSaved={() => void refresh()}
      />
    </>
  );
}
