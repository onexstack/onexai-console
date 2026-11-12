import { useMemo, useState } from 'react';
import { App, Button, Result, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';

import {
  deleteUserGroup,
  getUserGroup,
  updateUserGroup,
  type UserGroupMember,
} from '@/api/userGroups';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import PolicyTable from '@/components/permission/PolicyTable';
import SubjectAuthorizeDrawer, {
  type SubjectAuthorizeTarget,
} from '@/components/permission/SubjectAuthorizeDrawer';
import SubjectDetailLayout from '@/components/permission/SubjectDetailLayout';
import { TokenUnavailableNotice } from '@/components/permission/TokenUnavailable';
import UsableResourcesPanel from '@/components/permission/UsableResourcesPanel';
import { useSubjectPolicies } from '@/components/permission/useSubjectPolicies';
import UserGroupFormDrawer from '@/components/usergroup/FormDrawer';
import { useGoBack } from '@/runtime/hooks';
import { formatDate } from '@/lib/date';
import { InfoSection, StatusSwitch, type InfoItem } from '@/ui';

/**
 * 用户组详情：信息卡 + 「用户 / 权限策略 / 可操作资源」页签。
 *
 * 组名是策略里的授权标识，创建后不可改；详情页按组名读取，刷新和深链都成立。
 */
export default function UserGroupDetailPage() {
  const { name = '' } = useParams<{ name: string }>();
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const navigate = useNavigate();
  const goBack = useGoBack('/user-groups');
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();

  const [editOpen, setEditOpen] = useState(false);
  const [authorizeTarget, setAuthorizeTarget] = useState<SubjectAuthorizeTarget | null>(null);

  const isAdmin = Boolean(claims?.isAdmin);
  const query = useQuery({
    queryKey: ['user-groups', 'item', name],
    queryFn: () => getUserGroup(name),
    enabled: isAdmin && Boolean(name),
  });
  const group = query.data;
  const subject = useSubjectPolicies({ groupName: name }, isAdmin && Boolean(group));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['user-groups'] });
    await queryClient.invalidateQueries({ queryKey: ['policies'] });
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="403"
          title="需要管理员权限"
          subTitle="用户组详情只对管理员开放。请联系管理员为你的账号授予管理员角色。"
        />
      </div>
    );
  }

  const save = async (patch: { displayName?: string; description?: string }) => {
    if (!group) return;
    try {
      await updateUserGroup(group.name, {
        displayName: patch.displayName ?? group.displayName,
        description: patch.description ?? group.description,
        enabled: group.enabled,
        members: group.members,
      });
      message.success('已保存');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
      throw err;
    }
  };

  const toggle = async (next: boolean) => {
    if (!group) return;
    try {
      await updateUserGroup(group.name, {
        displayName: group.displayName,
        description: group.description,
        enabled: next,
        members: group.members,
      });
      message.success(next ? '已启用' : '已停用');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const confirmDelete = () => {
    if (!group) return;
    modal.confirm({
      title: `删除用户组 ${group.name}？`,
      content: '删除后成员关系一并清除；引用该组的策略不会删除，但会变成永不匹配。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteUserGroup(group.name);
        await queryClient.invalidateQueries({ queryKey: ['user-groups'] });
        message.success(`已删除用户组 ${group.name}`);
        navigate('/user-groups', { replace: true });
      },
    });
  };

  const items: InfoItem[] = group
    ? [
        { label: '用户组名', value: group.displayName || group.name },
        { label: '用户组 ID', value: group.name, rawValue: group.name, copyable: true },
        {
          label: '显示名',
          value: group.displayName || '-',
          editable: {
            currentValue: group.displayName ?? '',
            maxLength: 128,
            onSave: next => save({ displayName: next.trim() }),
          },
        },
        {
          label: '描述',
          value: group.description || '-',
          editable: {
            currentValue: group.description ?? '',
            maxLength: 512,
            onSave: next => save({ description: next.trim() }),
          },
        },
        { label: '成员数', value: `${group.members.length} 人` },
        {
          label: '状态',
          value: (
            <StatusSwitch
              checked={group.enabled}
              onLabel="启用"
              offLabel="停用"
              onChange={next => toggle(next)}
              confirm={{
                title: `${group.enabled ? '停用' : '启用'}用户组 ${group.name}？`,
                description: group.enabled
                  ? '停用后该组的全部授权立即暂停。'
                  : '启用后该组重新参与授权判定。',
                okText: group.enabled ? '停用' : '启用',
                okButtonProps: group.enabled ? { danger: true } : undefined,
                cancelText: '取消',
              }}
            />
          ),
        },
        { label: '创建时间', value: formatDate(group.createdAt) },
        { label: '更新时间', value: formatDate(group.updatedAt) },
      ]
    : [];

  const memberColumns: ColumnsType<UserGroupMember> = [
    {
      title: '成员',
      key: 'member',
      render: (_, member) =>
        member.displayName || member.username || member.userID || member.larkUserID || '-',
    },
    {
      title: '账号 ID',
      dataIndex: 'userID',
      key: 'userID',
      render: (value?: string) =>
        value ? <Link to={`/users/${encodeURIComponent(value)}`}>{value}</Link> : '-',
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (value?: string) => value || '-',
    },
    {
      title: '飞书 user_id',
      dataIndex: 'larkUserID',
      key: 'larkUserID',
      render: (value?: string) => value || '-',
    },
    {
      title: '飞书 open_id',
      dataIndex: 'openID',
      key: 'openID',
      render: (value?: string) => value || '-',
    },
    { title: '邮箱', dataIndex: 'email', key: 'email', render: (value?: string) => value || '-' },
  ];

  const tabs = group
    ? [
        {
          key: 'users',
          label: `用户（${group.members.length}）`,
          children: (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space>
                <Button onClick={() => setEditOpen(true)}>编辑成员</Button>
              </Space>
              {!group.enabled ? <Tag color="orange">该组已停用，成员不会产生任何授权</Tag> : null}
              <Table<UserGroupMember>
                rowKey={member =>
                  [member.userID, member.username, member.larkUserID, member.openID, member.email]
                    .filter(Boolean)
                    .join('|') || JSON.stringify(member)
                }
                size="small"
                columns={memberColumns}
                dataSource={group.members}
                pagination={false}
                locale={{ emptyText: '组内还没有成员' }}
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
              {!group.enabled ? <Tag color="orange">该组已停用，下列策略当前不生效</Tag> : null}
              <Space>
                <Button
                  onClick={() =>
                    setAuthorizeTarget({
                      kind: 'group',
                      label: group.displayName || group.name,
                      groupName: group.name,
                    })
                  }
                >
                  管理授权
                </Button>
              </Space>
              <PolicyTable
                policies={subject.matches.map(match => match.policy)}
                loading={subject.isLoading}
                emptyText="没有以该用户组为主体的策略"
              />
            </Space>
          ),
        },
        {
          key: 'resources',
          label: '可操作资源',
          children: (
            <UsableResourcesPanel
              rows={group.enabled ? subject.usableResources : []}
              loading={subject.isLoading}
            />
          ),
        },
      ]
    : [];

  const actions = group ? (
    <Space>
      <Button onClick={() => setEditOpen(true)}>编辑</Button>
      <Button
        onClick={() =>
          setAuthorizeTarget({
            kind: 'group',
            label: group.displayName || group.name,
            groupName: group.name,
          })
        }
      >
        授权
      </Button>
      <Button danger onClick={confirmDelete}>
        删除
      </Button>
    </Space>
  ) : null;

  return (
    <>
      <SubjectDetailLayout
        title={`用户组详情（${group?.name ?? name}）`}
        onBack={goBack}
        actions={actions}
        loading={query.isLoading}
        error={
          query.isError
            ? query.error instanceof Error
              ? query.error.message
              : '读取用户组失败'
            : undefined
        }
        onRetry={() => void query.refetch()}
        info={
          group ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <InfoSection title="用户组信息" items={items} />
              <TokenUnavailableNotice />
            </Space>
          ) : null
        }
        tabs={tabs}
      />

      <UserGroupFormDrawer
        open={editOpen}
        group={group ?? null}
        onClose={() => setEditOpen(false)}
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
