import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Alert, App, Button, Form, Input, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';

import { resetUserPassword } from '@/api/auth';
import PageLayout from '@/components/PageLayout';
import { useGoBack } from '@/runtime';
import { useIsMobile } from '@/ui';

/**
 * 管理员重置某个账号的密码。
 *
 * 原来是 `/users` 里的弹窗；与新建/编辑页统一成整页表单，路由是
 * `/users/:id/password`。用户名通过进入时的 `location.state` 带过来，
 * 直接打开深链时退回显示 id。
 */
export default function UserPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const isMobile = useIsMobile('lg');
  const [form] = Form.useForm<{ password: string; confirm: string }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const segments = location.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[1] ?? '');
  const username = (location.state as { username?: string } | null)?.username || id;
  const goBack = useGoBack('/users');

  const submit = async () => {
    let values: { password: string; confirm: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSaving(true);
    setError('');
    try {
      await resetUserPassword(id, values.password);
      message.success(`已重置 ${username} 的密码`);
      navigate('/users');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置密码失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLayout
      title="重置密码"
      onBack={goBack}
      footer={
        <>
          <Button size="large" onClick={goBack}>
            取消
          </Button>
          <Button size="large" type="primary" loading={saving} onClick={() => void submit()}>
            重置
          </Button>
        </>
      }
    >
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        重置 {username} 的密码
      </Typography.Title>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 24 }}
        title="管理员重置不需要旧密码"
        description="重置后请把新密码通过安全渠道告知用户，并建议其登录后自行修改。"
      />

      <Form
        form={form}
        size="large"
        layout={isMobile ? 'vertical' : 'horizontal'}
        labelCol={isMobile ? undefined : { flex: '140px' }}
        wrapperCol={isMobile ? undefined : { flex: '0 1 420px' }}
        requiredMark={false}
        onFinish={() => void submit()}
      >
        <Form.Item
          name="password"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 8, message: '密码至少 8 位' },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新密码"
          dependencies={['password']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>

      {error && <Alert type="error" showIcon title={error} style={{ marginTop: 16 }} />}
    </PageLayout>
  );
}
