import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Result,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { createUser, deleteUser, listUsers, updateUser } from '@/api/auth';
import type { AccountUser, CreateUserInput, FeishuBinding } from '@/api/types';
import { listUserGroups } from '@/api/userGroups';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import { formatDate } from '@/lib/date';
import { displayNamePatch } from '@/lib/display-name';
import { memberHasAny } from '@/components/usergroup/members';
import UserGroupMembershipDrawer from '@/components/usergroup/MembershipDrawer';
import SubjectAuthorizeDrawer, {
  type SubjectAuthorizeTarget,
} from '@/components/permission/SubjectAuthorizeDrawer';
import { openTokenUnavailable } from '@/components/permission/TokenUnavailable';
import { userAliasesOf } from '@/components/permission/authz';
import {
  EllipsisText,
  MoreActions,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_ID_TEXT_MAX_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  ResponsiveTable,
  StatusSwitch,
} from '@/ui';

type UserRow = AccountUser & { feishu?: FeishuBinding };

import { ROLE_OPTIONS } from './roles';

/**
 * 用户（管理员）。
 *
 * # 入口不是权限
 *
 * 菜单对普通用户隐藏、页面在这里也拦一道，但真正的闸是服务端的
 * `/v1/users` + `RequireAdmin`：前端隐藏只影响「看见」，不影响「做到」。
 *
 * # 行内动作与整页表单
 *
 * 状态开关和角色下拉留在行内：禁用和降权应当立刻生效，也应当被一眼看到。
 * 新建用户和修改显示名各有自己的弹窗，因为它们要么有多个必填字段（用户名、
 * 密码），要么不是「一眼就能改对」的单值。删除走一次确认，并且不允许删除
 * 当前登录的账号。
 */
export default function UsersPage() {
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();

  const [createForm] = Form.useForm<CreateUserInput>();
  const [editForm] = Form.useForm<{ display_name?: string; role?: string }>();
  // 新建用户时显示名默认跟随用户名，用户手改后不再覆盖。
  const displayNameEdited = useRef(false);
  const handleCreateValuesChange = (changed: Record<string, unknown>) => {
    const patch = displayNamePatch(
      changed,
      { nameKey: 'username', displayNameKey: 'display_name' },
      displayNameEdited
    );
    if (patch) createForm.setFieldValue('display_name', patch.value);
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<UserRow | null>(null);
  const [saving, setSaving] = useState(false);
  /** 批量删除的选中行；当前登录账号永远不可选。 */
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);
  /** 关联用户组抽屉的当前账号。 */
  const [membershipUser, setMembershipUser] = useState<UserRow | null>(null);
  /** 授权抽屉的目标账号。 */
  const [authorizeTarget, setAuthorizeTarget] = useState<SubjectAuthorizeTarget | null>(null);

  const query = useQuery({
    queryKey: ['users', { page, pageSize, keyword, status }],
    queryFn: () => listUsers({ page, pageSize, keyword, status }),
    enabled: Boolean(claims?.isAdmin),
  });

  // 用户组列与「关联用户组」抽屉共用同一份全量组数据。组数量是组织规模级，
  // 不分页比在每一行发一次请求更省。
  const groupsQuery = useQuery({
    queryKey: ['user-groups', 'all'],
    queryFn: () => listUserGroups({ offset: 0, limit: 0 }),
    enabled: Boolean(claims?.isAdmin),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['users'] });
    await queryClient.invalidateQueries({ queryKey: ['user-groups'] });
  };

  /** 这一行账号命中的用户组。 */
  const groupsOf = (row: UserRow) => {
    const identities = [row.id, row.username, row.feishu?.lark_user_id, row.feishu?.open_id].filter(
      (value): value is string => Boolean(value && value.trim())
    );
    return (groupsQuery.data?.items ?? []).filter(group =>
      group.members.some(member => memberHasAny(member, identities))
    );
  };

  if (!claims?.isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="403"
          title="需要管理员权限"
          subTitle="用户列表只对管理员开放。请联系管理员为你的账号授予管理员角色。"
        />
      </div>
    );
  }

  const update = async (row: UserRow, patch: { status?: string; role?: string }) => {
    try {
      await updateUser(row.id, patch);
      message.success('已保存');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const submitCreate = async () => {
    let values: CreateUserInput;
    try {
      values = await createForm.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await createUser({
        ...values,
        username: values.username.trim(),
        display_name: values.display_name?.trim() || undefined,
      });
      message.success(`已创建账号 ${values.username.trim()}，现在可以用它登录`);
      setCreateOpen(false);
      displayNameEdited.current = false;
      createForm.resetFields();
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建账号失败');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (row: UserRow) => {
    editForm.setFieldsValue({ display_name: row.display_name, role: row.role ?? '' });
    setEditRow(row);
  };

  const submitEdit = async () => {
    if (!editRow) return;
    let values: { display_name?: string; role?: string };
    try {
      values = await editForm.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await updateUser(editRow.id, {
        display_name: values.display_name?.trim() ?? '',
        role: values.role ?? '',
      });
      message.success('已保存');
      setEditRow(null);
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: UserRow) => {
    try {
      await deleteUser(row.id);
      setSelectedRowKeys(keys => keys.filter(id => id !== row.id));
      message.success(`已删除账号 ${row.username}`);
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除账号失败');
    }
  };

  /**
   * 批量删除。
   *
   * 服务端没有批量端点，逐个删除并用 `allSettled` 汇总：一个失败不能掩盖
   * 其余成功的结果。当前账号在行选择里已禁用，这里再过滤一次作为兜底。
   */
  const removeBatch = async () => {
    const ids = selectedRowKeys.filter(id => id !== claims.userId);
    if (ids.length === 0) return;
    setRemoving(true);
    try {
      const results = await Promise.allSettled(ids.map(id => deleteUser(id)));
      const failed = results.filter(result => result.status === 'rejected').length;
      if (failed > 0) {
        message.error(`已删除 ${ids.length - failed} 个账号，${failed} 个删除失败`);
      } else {
        message.success(`已删除 ${ids.length} 个账号`);
      }
      setSelectedRowKeys([]);
      await refresh();
    } finally {
      setRemoving(false);
    }
  };

  const columns: ColumnsType<UserRow> = [
    {
      title: '用户名/ID',
      dataIndex: 'username',
      key: 'username',
      width: RESOURCE_ID_COLUMN_WIDTH,
      render: (value: string, row) => (
        <Space direction="vertical" size={0} style={{ maxWidth: RESOURCE_ID_TEXT_MAX_WIDTH }}>
          <span>
            <Typography.Link
              strong
              onClick={() => navigate(`/users/${encodeURIComponent(row.id)}`)}
              title={value}
            >
              {value}
            </Typography.Link>
            {row.id === claims.userId ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                （当前登录）
              </Typography.Text>
            ) : null}
          </span>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, maxWidth: RESOURCE_ID_TEXT_MAX_WIDTH }}
            ellipsis={{ tooltip: row.id }}
          >
            {row.id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '姓名',
      dataIndex: 'display_name',
      key: 'display_name',
      // auto 布局下靠单元格内的像素上限截断，避免长文本把整张表撑宽。
      render: (value?: string) => (
        <EllipsisText maxWidth={160} title={value}>
          {value || '-'}
        </EllipsisText>
      ),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (value?: string) => (
        <EllipsisText maxWidth={220} title={value}>
          {value || '-'}
        </EllipsisText>
      ),
    },
    {
      title: '用户组',
      key: 'groups',
      render: (_, row) => {
        const groups = groupsOf(row);
        if (groups.length === 0) {
          return <Typography.Text type="secondary">未分组</Typography.Text>;
        }
        return (
          <Space size={4} wrap>
            {groups.map(group => (
              <Tag key={group.name} color={group.enabled ? 'blue' : 'default'}>
                {group.displayName || group.name}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (value: string, row) => (
        <Select
          size="small"
          value={value || ''}
          options={ROLE_OPTIONS}
          style={{ width: 120 }}
          disabled={row.id === claims.userId}
          onChange={role => void update(row, { role })}
        />
      ),
    },
    {
      title: '用户状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: string, row) => {
        const active = value === 'active';
        const self = row.id === claims.userId;
        // 与资源列表同一套交互：状态就是开关。禁用是敏感动作，仍走一次确认。
        // 确认框必须由 StatusSwitch 内部承载：外部 Popconfirm 克隆进来的事件和 ref
        // 会被函数组件丢掉，点了根本不会弹。
        return (
          <StatusSwitch
            checked={active}
            onLabel="正常"
            offLabel="已禁用"
            disabled={self}
            onChange={next => update(row, { status: next ? 'active' : 'disabled' })}
            confirm={{
              title: `${active ? '禁用' : '启用'} ${row.username}？`,
              description: active
                ? '禁用后该账号无法登录；已签发的令牌会在短时间内失效。'
                : '启用后该账号可以重新登录。',
              okText: active ? '禁用' : '启用',
              okButtonProps: active ? { danger: true } : undefined,
              cancelText: '取消',
            }}
          />
        );
      },
    },
    {
      title: '飞书',
      key: 'feishu',
      render: (_, row) => {
        const feishu = row.feishu;
        if (!feishu) {
          return <Typography.Text type="secondary">未绑定</Typography.Text>;
        }
        return (
          <Space direction="vertical" size={2}>
            <Space size={4}>
              <Tag color="blue">已绑定</Tag>
              <Typography.Link
                onClick={() =>
                  navigate(`/account?tab=feishu&open=${encodeURIComponent(feishu.open_id)}`)
                }
              >
                管理智能体
              </Typography.Link>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {feishu.name || feishu.open_id}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '注册时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (value: string) => formatDate(value),
    },
    {
      title: '操作',
      key: 'actions',
      ...RESOURCE_ACTION_COLUMN,
      render: (_, row) => {
        const self = row.id === claims.userId;
        return (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() =>
                setAuthorizeTarget({
                  kind: 'user',
                  label: row.username,
                  identities: userAliasesOf(row),
                })
              }
            >
              授权
            </Button>
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => openTokenUnavailable(modal, row.username)}
            >
              查看 Token
            </Button>
            <MoreActions
              items={[
                { key: 'edit', label: '编辑' },
                { key: 'groups', label: '关联用户组' },
                { key: 'password', label: '重置密码' },
                {
                  key: 'delete',
                  label: self ? <span title="不能删除当前登录的账号">删除</span> : '删除',
                  danger: true,
                  disabled: self,
                },
              ]}
              onClick={({ key }) => {
                if (key === 'edit') {
                  openEdit(row);
                  return;
                }
                if (key === 'groups') {
                  setMembershipUser(row);
                  return;
                }
                if (key === 'password') {
                  navigate(`/users/${encodeURIComponent(row.id)}/password`, {
                    state: { username: row.username },
                  });
                  return;
                }
                if (key === 'delete') {
                  // 菜单项里塞不进 Popconfirm（点击会先关闭下拉），所以用模态确认。
                  modal.confirm({
                    title: `删除账号 ${row.username}？`,
                    content: '删除后无法恢复：该账号的凭据与飞书绑定会一并清除。',
                    okText: '删除',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: () => remove(row),
                  });
                }
              }}
            />
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        用户
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        管理平台账号：新建、编辑、启用 / 禁用、调整角色、重置密码、删除。新建时设置的用户名和
        密码可直接用于登录；账号的飞书绑定由用户自己在「账号设置」里完成，绑定后的可用智能体
        可在「飞书绑定」里配置。
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="搜索用户名或显示名"
            prefix={<SearchOutlined />}
            style={{ width: 260 }}
            onSearch={value => {
              setKeyword(value.trim());
              setSelectedRowKeys([]);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 140 }}
            value={status}
            onChange={value => {
              setStatus(value);
              setSelectedRowKeys([]);
              setPage(1);
            }}
            options={[
              { value: 'active', label: '正常' },
              { value: 'disabled', label: '已禁用' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
            刷新
          </Button>
          <Button
            type="primary"
            onClick={() => {
              displayNameEdited.current = false;
              setCreateOpen(true);
            }}
          >
            新建
          </Button>
          <Typography.Text type="secondary">共 {query.data?.total ?? 0} 个账号</Typography.Text>
        </Space>
      </Card>

      {query.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          title="读取账号列表失败"
          description={query.error instanceof Error ? query.error.message : undefined}
        />
      )}

      <ResponsiveTable<UserRow>
        rowKey="id"
        size="middle"
        loading={query.isLoading}
        columns={columns}
        dataSource={query.data?.users ?? []}
        // 中间列按内容、整表铺满卡片；操作列贴右缘并吸附。
        {...RESOURCE_TABLE_LAYOUT}
        rowSelection={{
          selectedRowKeys,
          onChange: keys => setSelectedRowKeys(keys.map(String)),
          // 当前账号不允许被删除，也不允许被批量选中。
          getCheckboxProps: row => ({ disabled: row.id === claims.userId }),
        }}
        footer={() => (
          <Space wrap>
            <Typography.Text type="secondary">已选中 {selectedRowKeys.length} 条</Typography.Text>
            <Button
              size="small"
              disabled={selectedRowKeys.length === 0}
              onClick={() => setSelectedRowKeys([])}
            >
              取消选择
            </Button>
            <Popconfirm
              title={`确定删除选中的 ${selectedRowKeys.length} 个账号吗？`}
              description="删除后无法恢复：这些账号的凭据与飞书绑定会一并清除。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              disabled={selectedRowKeys.length === 0}
              onConfirm={() => void removeBatch()}
            >
              <Button
                size="small"
                danger
                disabled={selectedRowKeys.length === 0}
                loading={removing}
              >
                批量删除
              </Button>
            </Popconfirm>
          </Space>
        )}
        pagination={{
          current: page,
          pageSize,
          total: query.data?.total ?? 0,
          showSizeChanger: true,
          showTotal: total => `共 ${total} 个账号`,
          onChange: (nextPage, nextSize) => {
            setSelectedRowKeys([]);
            setPage(nextPage);
            setPageSize(nextSize);
          },
        }}
      />

      <Modal
        title="新建用户"
        open={createOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void submitCreate()}
        onCancel={() => {
          setCreateOpen(false);
          displayNameEdited.current = false;
          createForm.resetFields();
        }}
      >
        <Alert
          type="info"
          showIcon
          style={{ margin: '12px 0 16px' }}
          title="创建后即可登录"
          description="账号使用用户名 + 密码登录本平台。用户名创建后不可修改；密码可由管理员随时重置。"
        />
        <Form
          form={createForm}
          layout="vertical"
          requiredMark={false}
          onValuesChange={handleCreateValuesChange}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              {
                pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/,
                message: '3-32 位，以字母或数字开头，只允许字母、数字、下划线、点和连字符',
              },
            ]}
          >
            <Input placeholder="登录用用户名" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码至少 8 位' },
              { max: 72, message: '密码不能超过 72 个字节' },
            ]}
          >
            <Input.Password placeholder="至少 8 位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="display_name" label="显示名（可选）">
            <Input placeholder="在控制台里显示的名字" />
          </Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="role" label="角色" initialValue="" style={{ flex: 1 }}>
              <Select options={ROLE_OPTIONS} />
            </Form.Item>
            <Form.Item name="status" label="状态" initialValue="active" style={{ flex: 1 }}>
              <Select
                options={[
                  { value: 'active', label: '正常' },
                  { value: 'disabled', label: '已禁用' },
                ]}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <UserGroupMembershipDrawer
        open={membershipUser !== null}
        user={membershipUser}
        onClose={() => setMembershipUser(null)}
        onSaved={() => void refresh()}
      />

      <SubjectAuthorizeDrawer
        open={authorizeTarget !== null}
        target={authorizeTarget}
        onClose={() => setAuthorizeTarget(null)}
        onSaved={() => void refresh()}
      />

      <Modal
        title={`编辑账号 ${editRow?.username ?? ''}`}
        open={editRow !== null}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void submitEdit()}
        onCancel={() => setEditRow(null)}
      >
        <Form form={editForm} layout="vertical" requiredMark={false} style={{ marginTop: 16 }}>
          <Form.Item name="display_name" label="显示名">
            <Input placeholder="留空则显示用户名" maxLength={32} />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select options={ROLE_OPTIONS} disabled={editRow?.id === claims.userId} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
