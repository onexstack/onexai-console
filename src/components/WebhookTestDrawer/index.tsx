import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMutation } from '@tanstack/react-query';

import {
  testSubjectAccessReview,
  testTokenReview,
  type ReviewTestResponse,
  type SubjectAccessReviewStatus,
  type TokenReviewStatus,
} from '@/api/webhookTests';
import { decodeClaims } from '@/auth/claims';
import { getToken, useSessionToken } from '@/auth/tokenStore';
import { ResizableDrawer } from '@/ui';

/**
 * 认证 / 鉴权 Webhook 的在线测试。
 *
 * 测试只调用这一个 Webhook，不经过平台的认证/授权链路：页面要回答的是
 * 「这个后端本身给出什么判决」，所以结果区同时展示后端返回的 HTTP 状态、
 * 耗时、原始响应体和解析出的 status。平台侧的调用错误（不可达、超时、
 * 非 2xx、无法解析）单独展示，避免和后端的业务拒绝混在一起。
 */
export default function WebhookTestDrawer({
  open,
  onClose,
  name,
  type,
  namespace,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  /** authentication | authorization */
  type: string;
  namespace?: string;
}) {
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const authentication = type === 'authentication';

  const [tokenForm] = Form.useForm<{ token: string; audiences: string[] }>();
  const [sarForm] = Form.useForm<{
    user: string;
    groups?: string[];
    verb: string;
    resource: string;
    name?: string;
    namespace?: string;
    agent?: string;
  }>();

  const [tokenResult, setTokenResult] = useState<ReviewTestResponse<TokenReviewStatus>>();
  const [sarResult, setSarResult] = useState<ReviewTestResponse<SubjectAccessReviewStatus>>();

  const tokenReview = useMutation({
    mutationFn: (values: { token: string; audiences: string[] }) =>
      testTokenReview(name, namespace, {
        token: values.token.trim(),
        audiences: values.audiences?.length ? values.audiences : undefined,
      }),
    onSuccess: setTokenResult,
    onError: err => message.error(err instanceof Error ? err.message : '测试失败'),
  });

  const subjectAccessReview = useMutation({
    mutationFn: (values: {
      user: string;
      groups?: string[];
      verb: string;
      resource: string;
      name?: string;
      namespace?: string;
      agent?: string;
    }) =>
      testSubjectAccessReview(name, namespace, {
        user: values.user.trim(),
        groups: values.groups?.length ? values.groups : undefined,
        extra: values.agent ? { 'onexai.io/agent-name': [values.agent] } : undefined,
        resourceAttributes: {
          verb: values.verb,
          group: 'onexai.io',
          version: 'v1',
          resource: values.resource.trim(),
          name: values.name?.trim() || undefined,
          namespace: values.namespace?.trim() || undefined,
        },
      }),
    onSuccess: setSarResult,
    onError: err => message.error(err instanceof Error ? err.message : '测试失败'),
  });

  return (
    <ResizableDrawer
      title={`测试 · ${name}`}
      open={open}
      onClose={onClose}
      defaultWidth={640}
      storageKey="webhook-test"
      destroyOnHidden
    >
      {authentication ? (
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            平台会向该 Webhook 发送 <Typography.Text code>POST</Typography.Text> +
            {' '}
            <Typography.Text code>authentication.k8s.io/v1 TokenReview</Typography.Text>
            ，由它回答「这个 token 是谁」。
          </Typography.Paragraph>
          <Form
            form={tokenForm}
            layout="vertical"
            initialValues={{ token: claims?.userId ? token : undefined, audiences: [] }}
            onFinish={values => tokenReview.mutate(values)}
          >
            <Form.Item
              name="token"
              label="Token"
              rules={[{ required: true, message: '请输入要认证的 token' }]}
            >
              <Input.TextArea rows={4} placeholder="粘贴要交给该 Webhook 的 Bearer token" />
            </Form.Item>
            <Form.Item
              name="audiences"
              label="Audiences"
              extra="对应 TokenReview.spec.audiences；留空表示不限定。"
            >
              <Select mode="tags" tokenSeparators={[',', ' ']} placeholder="回车添加" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={tokenReview.isPending}>
              发起 TokenReview
            </Button>
          </Form>
          {tokenResult && <ReviewResult result={tokenResult} title="TokenReview 结果" />}
        </Space>
      ) : (
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            平台会向该 Webhook 发送 <Typography.Text code>POST</Typography.Text> +
            {' '}
            <Typography.Text code>authorization.k8s.io/v1 SubjectAccessReview</Typography.Text>
            ，由它回答「这个主体能否使用该 Agent / 工具」。
          </Typography.Paragraph>
          <Form
            form={sarForm}
            layout="vertical"
            initialValues={{
              user: claims?.userId ?? claims?.name ?? '',
              groups: [],
              verb: 'get',
              resource: 'agents',
            }}
            onFinish={values => subjectAccessReview.mutate(values)}
          >
            <Form.Item
              name="user"
              label="User"
              rules={[{ required: true, message: '请输入主体' }]}
            >
              <Input placeholder="SubjectAccessReview.spec.user" />
            </Form.Item>
            <Form.Item name="groups" label="Groups">
              <Select mode="tags" tokenSeparators={[',', ' ']} placeholder="回车添加" />
            </Form.Item>
            <Form.Item name="verb" label="Verb" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'get', label: 'get（读）' },
                  { value: 'update', label: 'update（写）' },
                  { value: 'create', label: 'create' },
                  { value: 'delete', label: 'delete' },
                ]}
              />
            </Form.Item>
            <Form.Item name="resource" label="Resource" rules={[{ required: true }]}>
              <Input placeholder="agents / skills / mcpservers …" />
            </Form.Item>
            <Form.Item name="name" label="资源名">
              <Input placeholder="可选；留空表示不针对具体对象" />
            </Form.Item>
            <Form.Item name="namespace" label="命名空间">
              <Input placeholder={namespace || '可选'} />
            </Form.Item>
            <Form.Item
              name="agent"
              label="Agent（extra）"
              extra="写入 extra['onexai.io/agent-name']，便于后端按 Agent 判定。"
            >
              <Input placeholder="可选" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={subjectAccessReview.isPending}>
              发起 SubjectAccessReview
            </Button>
          </Form>
          {sarResult && <ReviewResult result={sarResult} title="SubjectAccessReview 结果" />}
        </Space>
      )}
    </ResizableDrawer>
  );
}

/** 列表行/详情页的「测试」入口。非认证、鉴权类型的 Webhook 没有可测的协议。 */
export function WebhookTestAction({
  name,
  type,
  namespace,
  appearance = 'link',
}: {
  name: string;
  type: string;
  namespace?: string;
  appearance?: 'link' | 'button';
}) {
  const [open, setOpen] = useState(false);
  // The test endpoint requires an administrator: it calls an arbitrary
  // configured endpoint with platform-issued content. Hiding it for other
  // callers is clearer than a 403 from a button that should not exist.
  if (decodeClaims(getToken())?.isAdmin !== true) {
    return null;
  }
  if (type !== 'authentication' && type !== 'authorization') {
    return null;
  }
  return (
    <>
      <Button
        size={appearance === 'link' ? 'small' : undefined}
        type={appearance === 'link' ? 'link' : 'default'}
        style={appearance === 'link' ? { padding: 0 } : undefined}
        onClick={() => setOpen(true)}
      >
        测试
      </Button>
      <WebhookTestDrawer
        open={open}
        onClose={() => setOpen(false)}
        name={name}
        type={type}
        namespace={namespace}
      />
    </>
  );
}

/** 展示一次测试调用：后端说了什么，以及平台是否成功把请求送到。 */
function ReviewResult<S>({
  result,
  title,
}: {
  result: ReviewTestResponse<S>;
  title: string;
}) {
  return (
    <Space orientation="vertical" size="small" style={{ width: '100%' }}>
      {result.error && <Alert type="error" showIcon title={result.error} />}
      <Descriptions size="small" column={2} bordered title={title}>
        <Descriptions.Item label="HTTP 状态">
          <Tag color={result.httpStatus && result.httpStatus >= 200 && result.httpStatus < 300 ? 'green' : 'red'}>
            {result.httpStatus ?? '—'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="耗时">
          {result.latencyMs === undefined ? '—' : `${result.latencyMs} ms`}
        </Descriptions.Item>
        <Descriptions.Item label="status" span={2}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(result.status ?? null, null, 2)}
          </pre>
        </Descriptions.Item>
        <Descriptions.Item label="原始响应" span={2}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {result.raw || '（空）'}
          </pre>
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}
