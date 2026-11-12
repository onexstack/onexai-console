import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';

import { tokenReview, type TokenReviewRequest } from '@/api/authReviews';
import { getToken } from '@/auth/tokenStore';
import JsonBlock from './JsonBlock';

interface FormValues {
  token: string;
  audiences?: string[];
}

/**
 * 认证（TokenReview）。
 *
 * 提交 `authentication.k8s.io/v1 TokenReview`，页面只展示服务端的判断，
 * 不在前端解析或猜测 token 的身份：同一枚令牌在「能不能登录控制台」和
 * 「K8s 认证 webhook 认不认」两个问题上必须得到同一个答案，而这个答案只能
 * 由服务端那份解析器给出。
 */
export default function TokenReviewTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [result, setResult] = useState<TokenReviewRequest | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (values: FormValues) => {
    setLoading(true);
    try {
      const response = await tokenReview({
        token: values.token.trim(),
        ...(values.audiences?.length ? { audiences: values.audiences } : {}),
      });
      setResult(response);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '认证请求失败');
    } finally {
      setLoading(false);
    }
  };

  const useCurrentToken = () => {
    const current = getToken();
    if (!current) {
      message.warning('当前会话没有令牌，请先登录');
      return;
    }
    form.setFieldValue('token', current);
  };

  const clear = () => {
    form.resetFields();
    setResult(null);
  };

  const status = result?.status;
  const user = status?.user;
  const authenticated = status?.authenticated === true;

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small" title="发起认证">
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ audiences: [] }}>
          <Form.Item
            name="token"
            label="Token"
            rules={[{ required: true, message: '请输入要认证的 token' }]}
          >
            <Input.TextArea
              rows={4}
              placeholder="粘贴平台登录令牌（JWT）"
              autoComplete="off"
              spellCheck={false}
            />
          </Form.Item>
          <Form.Item
            name="audiences"
            label="Audiences"
            extra="会原样回显在 status.audiences 供调用方核对；内置 HS256 校验不按 audience 过滤。"
          >
            <Select mode="tags" placeholder="可选，例如 onexai" tokenSeparators={[',', ' ']} />
          </Form.Item>
          <Space wrap>
            <Button type="primary" htmlType="submit" loading={loading}>
              发起认证
            </Button>
            <Button onClick={useCurrentToken}>填入当前登录令牌</Button>
            <Button onClick={clear} disabled={loading}>
              清空
            </Button>
          </Space>
        </Form>
      </Card>

      {status && (
        <Card
          size="small"
          title="认证结果"
          extra={
            <Tag color={authenticated ? 'green' : 'red'}>
              {authenticated ? 'authenticated' : '未通过'}
            </Tag>
          }
        >
          {!authenticated && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={status.error || '认证未通过'}
              description="常见原因：令牌已过期、不是本平台签发的 JWT，或签发端与 oai-agent-apiserver 的 jwt.key 不一致。"
            />
          )}

          <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
            <Descriptions.Item label="username">{user?.username || '-'}</Descriptions.Item>
            <Descriptions.Item label="uid">{user?.uid || '-'}</Descriptions.Item>
            <Descriptions.Item label="groups" span={2}>
              {(user?.groups ?? []).length ? (
                <Space wrap size={[4, 4]}>
                  {user?.groups?.map(group => (
                    <Tag key={group}>{group}</Tag>
                  ))}
                </Space>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="audiences" span={2}>
              {(status.audiences ?? []).length ? (
                <Space wrap size={[4, 4]}>
                  {status.audiences?.map(audience => (
                    <Tag key={audience}>{audience}</Tag>
                  ))}
                </Space>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="extra" span={2}>
              {user?.extra && Object.keys(user.extra).length ? (
                <Space orientation="vertical" size={2}>
                  {Object.entries(user.extra).map(([key, value]) => (
                    <Typography.Text key={key} code>
                      {key}={value.join(',')}
                    </Typography.Text>
                  ))}
                </Space>
              ) : (
                '-'
              )}
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">
              原始响应（服务端已清空 spec.token，避免把凭据写进日志与代理）
            </Typography.Text>
            <JsonBlock value={result} />
          </div>
        </Card>
      )}
    </Space>
  );
}
