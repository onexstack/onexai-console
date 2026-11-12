import { useEffect, useState } from 'react';
import { App, Button, Form, Input, Space, Switch, Typography } from 'antd';

import {
  createUserGroup,
  updateUserGroup,
  type UserGroup,
  type UserGroupInput,
  type UserGroupMember,
} from '@/api/userGroups';
import { ResizableDrawer } from '@/ui';
import MemberEditor from './MemberEditor';

interface FormValues {
  name: string;
  displayName?: string;
  description?: string;
  enabled: boolean;
  members: UserGroupMember[];
}

interface Props {
  open: boolean;
  /** null 表示新建。编辑时 name 不可改。 */
  group: UserGroup | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 用户组新建/编辑抽屉。
 *
 * 组名是策略里的 group subject_id，创建后不可修改：改名会让所有引用它的规则
 * 静默失配。需要换名字时应当新建一个组、迁移策略后再删除旧组。
 */
export default function UserGroupFormDrawer({ open, group, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(group);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      name: group?.name ?? '',
      displayName: group?.displayName ?? '',
      description: group?.description ?? '',
      enabled: group?.enabled ?? true,
      members: group?.members ?? [],
    });
  }, [open, group, form]);

  const submit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const input: UserGroupInput = {
      name: values.name.trim(),
      displayName: values.displayName?.trim() ?? '',
      description: values.description?.trim() ?? '',
      enabled: values.enabled,
      members: values.members ?? [],
    };
    setSaving(true);
    try {
      if (isEdit) {
        await updateUserGroup(input.name, {
          displayName: input.displayName,
          description: input.description,
          enabled: input.enabled,
          members: input.members,
        });
        message.success('用户组已保存');
      } else {
        await createUserGroup(input);
        message.success(`用户组 ${input.name} 已创建`);
      }
      onSaved();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存用户组失败');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (saving) return;
    onClose();
  };

  return (
    <ResizableDrawer
      open={open}
      title={isEdit ? `编辑用户组 ${group?.name ?? ''}` : '新建用户组'}
      onClose={close}
      defaultWidth={720}
      minWidth={520}
      storageKey="user-group-form"
      destroyOnHidden
      maskClosable={!saving}
      keyboard={!saving}
      closable={!saving}
      extra={
        <Space>
          <Button onClick={close} disabled={saving}>
            取消
          </Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false} disabled={saving}>
        <Form.Item
          name="name"
          label="组名"
          extra="策略里通过这个名字引用用户组；创建后不可修改。"
          rules={[
            { required: true, message: '请输入组名' },
            {
              pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/,
              message: '字母或数字开头，只允许字母、数字、下划线、点和连字符，最长 64 位',
            },
          ]}
        >
          <Input placeholder="例如 dept-ai" maxLength={64} disabled={isEdit} />
        </Form.Item>
        <Form.Item name="displayName" label="显示名">
          <Input placeholder="给运营看的中文名" maxLength={128} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea placeholder="这个组负责什么、由谁维护" maxLength={512} rows={2} />
        </Form.Item>
        <Form.Item
          name="enabled"
          label="启用"
          valuePropName="checked"
          extra="停用后组内成员不再继承该组的策略授权，成员列表保留。"
        >
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
        <Form.Item
          name="members"
          label="成员"
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              同一个人可以只填一种身份；不同身份覆盖不同访问路径，详见每行提示。
            </Typography.Text>
          }
        >
          <MemberEditor />
        </Form.Item>
      </Form>
    </ResizableDrawer>
  );
}
