import { useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import type { UserGroupMember } from '@/api/userGroups';
import { useUserDirectory } from '@/components/UserRef';
import {
  coverageOf,
  identitiesOf,
  memberLabel,
  memberOfUser,
  sameMember,
} from './members';

interface Props {
  value?: UserGroupMember[];
  onChange?: (members: UserGroupMember[]) => void;
  disabled?: boolean;
}

/**
 * 用户组成员编辑器。
 *
 * # 为什么既选账号又能手填身份
 *
 * 平台账号能自动带出四种身份别名，但它只覆盖本平台注册过的人。外部同学、
 * 离职后保留的飞书 user_id、没有绑定飞书的账号，都需要直接写身份。两种入口
 * 写的是同一种行，判定层不区分来源。
 *
 * # 覆盖度
 *
 * 只填账号 ID 的成员只会在浏览器路径命中；只填飞书 ID 的成员只会在 IM/Agent
 * 运行路径命中。这里把每一行实际覆盖的路径标出来，而不是在保存后才发现某个
 * 场景不生效。
 */
export default function MemberEditor({ value = [], onChange, disabled }: Props) {
  const directory = useUserDirectory();
  const [picked, setPicked] = useState<string[]>([]);
  const [manual, setManual] = useState({
    userID: '',
    username: '',
    larkUserID: '',
    openID: '',
    displayName: '',
  });
  const [manualError, setManualError] = useState<string | null>(null);

  const options = useMemo(
    () =>
      directory.users.map(user => ({
        value: user.id,
        label: `${user.label}（${user.username}）`,
        searchText: user.searchText,
      })),
    [directory.users]
  );

  const external = value.filter(member => !member.userID?.trim());

  const addPicked = () => {
    if (picked.length === 0) return;
    const additions: UserGroupMember[] = [];
    for (const id of picked) {
      const user = directory.users.find(item => item.id === id);
      if (!user) continue;
      const member = memberOfUser(user);
      if (value.some(existing => sameMember(existing, member))) continue;
      additions.push(member);
    }
    setPicked([]);
    if (additions.length > 0) onChange?.([...value, ...additions]);
  };

  const addManual = () => {
    const identity = {
      userID: manual.userID.trim(),
      username: manual.username.trim(),
      larkUserID: manual.larkUserID.trim(),
      openID: manual.openID.trim(),
      displayName: manual.displayName.trim(),
    };
    if (!identitiesOf(identity).length) {
      setManualError('至少填写一个身份标识');
      return;
    }
    if (value.some(existing => sameMember(existing, identity))) {
      setManualError('这个身份已经在成员列表里了');
      return;
    }
    setManualError(null);
    setManual({ userID: '', username: '', larkUserID: '', openID: '', displayName: '' });
    onChange?.([...value, identity]);
  };

  const remove = (member: UserGroupMember) => {
    onChange?.(value.filter(item => item !== member));
  };

  const columns: ColumnsType<UserGroupMember> = [
    {
      title: '成员',
      key: 'member',
      render: (_, member) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{memberLabel(member)}</Typography.Text>
          <Space size={4} wrap>
            {member.userID ? <Tag color="blue">账号 {shortId(member.userID)}</Tag> : null}
            {member.username ? <Tag color="geekblue">登录名 {member.username}</Tag> : null}
            {member.larkUserID ? <Tag color="green">飞书 {member.larkUserID}</Tag> : null}
            {member.openID ? <Tag color="cyan">open_id {shortId(member.openID)}</Tag> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: '覆盖路径',
      key: 'coverage',
      width: 190,
      render: (_, member) => {
        const coverage = coverageOf(member);
        return (
          <Space size={4} wrap>
            <Tag color={coverage.browser ? 'success' : 'default'}>
              {coverage.browser ? '浏览器 ✓' : '浏览器 ✗'}
            </Tag>
            <Tag color={coverage.lark ? 'success' : 'default'}>
              {coverage.lark ? 'IM/Agent ✓' : 'IM/Agent ✗'}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_, member) => (
        <Button
          type="link"
          size="small"
          danger
          disabled={disabled}
          onClick={() => remove(member)}
        >
          移除
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space.Compact style={{ width: '100%' }}>
        <Select
          mode="multiple"
          showSearch
          allowClear
          disabled={disabled || !directory.ready}
          value={picked}
          options={options}
          placeholder={
            directory.ready ? '搜索平台账号并添加' : '用户目录不可用，请在下方手动填写身份'
          }
          optionFilterProp="label"
          onChange={setPicked}
          style={{ flex: 1 }}
          notFoundContent={directory.ready ? '没有匹配的账号' : '目录不可用'}
        />
        <Button type="primary" disabled={disabled || picked.length === 0} onClick={addPicked}>
          添加
        </Button>
      </Space.Compact>

      {directory.ready && directory.users.length >= 2000 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          用户目录已加载 {directory.users.length} 个账号；更多账号请直接填写身份。
        </Typography.Text>
      ) : null}

      <Table<UserGroupMember>
        rowKey={member => identitiesOf(member).join('|') || memberLabel(member)}
        size="small"
        columns={columns}
        dataSource={value}
        pagination={false}
        locale={{ emptyText: '还没有成员' }}
      />

      <Card size="small" title="手动添加外部身份" styles={{ body: { paddingBottom: 8 } }}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space wrap>
            <Input
              placeholder="账号 ID（可空）"
              disabled={disabled}
              value={manual.userID}
              onChange={event => setManual({ ...manual, userID: event.target.value })}
              style={{ width: 210 }}
            />
            <Input
              placeholder="登录名（可空）"
              disabled={disabled}
              value={manual.username}
              onChange={event => setManual({ ...manual, username: event.target.value })}
              style={{ width: 170 }}
            />
            <Input
              placeholder="飞书 user_id（可空）"
              disabled={disabled}
              value={manual.larkUserID}
              onChange={event => setManual({ ...manual, larkUserID: event.target.value })}
              style={{ width: 180 }}
            />
            <Input
              placeholder="open_id（可空）"
              disabled={disabled}
              value={manual.openID}
              onChange={event => setManual({ ...manual, openID: event.target.value })}
              style={{ width: 180 }}
            />
            <Input
              placeholder="显示名（可空）"
              disabled={disabled}
              value={manual.displayName}
              onChange={event => setManual({ ...manual, displayName: event.target.value })}
              style={{ width: 150 }}
            />
            <Button disabled={disabled} onClick={addManual}>
              添加
            </Button>
          </Space>
          {manualError ? <Alert type="error" showIcon title={manualError} /> : null}
          {external.length > 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已手动添加 {external.length} 个外部身份；它们不依赖平台账号，判定时按填写的标识精确匹配。
            </Typography.Text>
          ) : null}
        </Space>
      </Card>
    </Space>
  );
}

/** 长 ID 只展示首尾，完整值由成员行的 Tag title 或复制入口提供。 */
function shortId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}
