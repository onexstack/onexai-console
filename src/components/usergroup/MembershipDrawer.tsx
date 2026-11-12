import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Empty, Input, Space, Spin, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';

import type { AccountUser, FeishuBinding } from '@/api/types';
import {
  listUserGroups,
  updateUserGroup,
  type UserGroupMember,
} from '@/api/userGroups';
import { ResizableDrawer } from '@/ui';
import { memberHasAny } from './members';

type UserRow = AccountUser & { feishu?: FeishuBinding };

interface Props {
  open: boolean;
  user: UserRow | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 从用户一侧维护用户组归属。
 *
 * 与用户组页面编辑成员是同一份数据的两个入口：这里只勾选组，保存时对变化的
 * 组调用更新接口。组多时一次保存会发出多个请求，逐个汇报失败，避免一个组
 * 失败把其余成功也说成失败。
 */
export default function UserGroupMembershipDrawer({ open, user, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [keyword, setKeyword] = useState('');

  const query = useQuery({
    queryKey: ['user-groups', 'all'],
    queryFn: () => listUserGroups({ offset: 0, limit: 0 }),
    enabled: open,
    staleTime: 15_000,
  });

  const identities = useMemo(() => identitiesOfUser(user), [user]);

  useEffect(() => {
    if (!open || !query.data) return;
    setSelected(
      query.data.items
        .filter(group => group.members.some(member => memberHasAny(member, identities)))
        .map(group => group.name)
    );
    setKeyword('');
  }, [open, query.data, identities]);

  const groups = query.data?.items ?? [];
  const visible = keyword.trim()
    ? groups.filter(group => {
        const text = `${group.name} ${group.displayName} ${group.description}`.toLowerCase();
        return text.includes(keyword.trim().toLowerCase());
      })
    : groups;

  const save = async () => {
    if (!user) return;
    const member = memberOfUser(user);
    const changed = groups.filter(group => {
      const should = selected.includes(group.name);
      const has = group.members.some(existing => memberHasAny(existing, identities));
      return should !== has;
    });
    if (changed.length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const results = await Promise.allSettled(
        changed.map(group => {
          const should = selected.includes(group.name);
          const members = should
            ? [...group.members, member]
            : group.members.filter(existing => !memberHasAny(existing, identities));
          return updateUserGroup(group.name, {
            displayName: group.displayName,
            description: group.description,
            enabled: group.enabled,
            members,
          });
        })
      );
      const failed = results.filter(result => result.status === 'rejected').length;
      if (failed > 0) {
        const first = results.find(result => result.status === 'rejected') as
          | PromiseRejectedResult
          | undefined;
        message.error(
          `${changed.length - failed} 个组保存成功，${failed} 个失败：${
            first?.reason instanceof Error ? first.reason.message : '未知错误'
          }`
        );
      } else {
        message.success(`已更新 ${changed.length} 个用户组`);
      }
      onSaved();
      if (failed === 0) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResizableDrawer
      open={open}
      title={`关联用户组${user ? `：${user.username}` : ''}`}
      onClose={() => {
        if (!saving) onClose();
      }}
      defaultWidth={520}
      storageKey="user-group-membership"
      destroyOnHidden
      maskClosable={!saving}
      keyboard={!saving}
      closable={!saving}
      extra={
        <Space>
          <Button
            onClick={() => {
              if (!saving) onClose();
            }}
            disabled={saving}
          >
            取消
          </Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Input.Search
          allowClear
          placeholder="搜索用户组"
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
        />
        {query.isLoading ? <Spin /> : null}
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            title="读取用户组失败"
            description={query.error instanceof Error ? query.error.message : undefined}
          />
        ) : null}
        {!query.isLoading && !query.isError && visible.length === 0 ? (
          <Empty description={keyword ? '没有匹配的用户组' : '还没有用户组'} />
        ) : null}
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {visible.map(group => {
            const checked = selected.includes(group.name);
            return (
              <Checkbox
                key={group.name}
                checked={checked}
                disabled={saving}
                onChange={event => {
                  setSelected(prev =>
                    event.target.checked
                      ? [...prev, group.name]
                      : prev.filter(name => name !== group.name)
                  );
                }}
              >
                <Space direction="vertical" size={0}>
                  <Typography.Text>{group.displayName || group.name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {group.name} · {group.members.length} 人
                    {group.enabled ? '' : ' · 已停用'}
                  </Typography.Text>
                </Space>
              </Checkbox>
            );
          })}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          勾选表示该账号属于这个组。保存时会自动带上账号 ID、登录名和飞书身份；
          停用的组不会产生任何授权。
        </Typography.Text>
      </Space>
    </ResizableDrawer>
  );
}

/** 账号对外的全部身份别名。 */
function identitiesOfUser(user: UserRow | null): string[] {
  if (!user) return [];
  return [user.id, user.username, user.feishu?.lark_user_id, user.feishu?.open_id].filter(
    (value): value is string => Boolean(value && value.trim())
  );
}

/** 账号转成成员条目。 */
function memberOfUser(user: UserRow): UserGroupMember {
  return {
    userID: user.id,
    username: user.username,
    larkUserID: user.feishu?.lark_user_id || undefined,
    openID: user.feishu?.open_id || undefined,
    displayName: user.feishu?.name || user.display_name || user.username,
    email: user.email,
  };
}
