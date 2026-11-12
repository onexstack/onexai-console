import { useEffect, useState } from 'react';
import { Alert, App, Form, Input, Modal } from 'antd';

import { changePassword } from '@/api/auth';
import type { AccountUser } from '@/api/types';

import styles from './styles.module.scss';

interface PasswordFormValues {
  oldPassword?: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * 修改当前账号的登录密码。
 *
 * 原来是整页 `/account/password`；与 onex-console 一致改成安全设置里的弹窗。
 * 失败信息留在弹窗内，不关闭，用户可以直接改完重试。
 */
export default function PasswordModal({
  open,
  onClose,
  provider,
}: {
  open: boolean;
  onClose: () => void;
  provider: AccountUser['provider'];
}) {
  const [form] = Form.useForm<PasswordFormValues>();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 打开时清空表单与错误：Modal 关闭时不渲染 children，`form` 在关闭态调用
  // `resetFields` 会触发「useForm 未连接到 Form」的警告。
  useEffect(() => {
    if (open) {
      form.resetFields();
      setError('');
    }
  }, [open, form]);

  const submit = async () => {
    let values: PasswordFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSaving(true);
    setError('');
    try {
      await changePassword(values.oldPassword ?? '', values.newPassword);
      message.success('密码已更新');
      form.resetFields();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改密码失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="修改密码"
      open={open}
      width={460}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      mask={{ closable: !saving }}
      closable={!saving}
      keyboard={!saving}
      onOk={() => void submit()}
      onCancel={() => {
        if (!saving) onClose();
      }}
    >
      {error && <Alert type="error" showIcon className={styles.modalError} title={error} />}

      <p className={styles.modalHint}>飞书登录创建的账号如果还没有设置过密码，当前密码留空即可。</p>

      <Form
        form={form}
        className={styles.modalForm}
        layout="vertical"
        requiredMark={false}
        onFinish={() => void submit()}
      >
        <Form.Item name="oldPassword" label="当前密码">
          <Input.Password
            placeholder={provider === 'lark' ? '未设置密码时可留空' : '当前密码'}
            autoComplete="current-password"
          />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 8, message: '密码至少 8 位' },
          ]}
        >
          <Input.Password placeholder="至少 8 位" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password placeholder="再输入一次" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
