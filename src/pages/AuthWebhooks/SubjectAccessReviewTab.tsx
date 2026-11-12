import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router';

import {
  subjectAccessReview,
  type SubjectAccessReviewRequest,
  type SubjectAccessReviewSpec,
} from '@/api/authReviews';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import { RESOURCE_KIND_OPTIONS } from '@/pages/Policies/options';
import JsonBlock from './JsonBlock';

interface FormValues {
  requestType: 'resource' | 'nonResource';
  user: string;
  groups?: string[];
  verb: string;
  resource?: string;
  name?: string;
  namespace?: string;
  subresource?: string;
  agent?: string;
  extra?: string;
  path?: string;
}

/**
 * 资源名候选来自授权策略页的同一份 kind 表：控制台写策略和这里发评审
 * 用的是同一个词汇，复用一份才不会出现「策略里有、评审发不出去」。
 * `*` 是策略里的通配，不是一个可以评审的资源。
 */
const RESOURCE_OPTIONS = RESOURCE_KIND_OPTIONS.filter(option => option.value !== '*').map(
  option => ({ value: option.value, label: `${option.value}（${option.label}）` })
);

const VERBS = [
  { value: 'get', label: 'get（读）' },
  { value: 'list', label: 'list（读）' },
  { value: 'watch', label: 'watch（读）' },
  { value: 'create', label: 'create（写）' },
  { value: 'update', label: 'update（写）' },
  { value: 'patch', label: 'patch（写）' },
  { value: 'delete', label: 'delete（写）' },
  { value: 'deletecollection', label: 'deletecollection（写）' },
];

/**
 * 授权（SubjectAccessReview）。
 *
 * 页面只把表单翻译成 Kubernetes 请求体，判决完全来自服务端：同一份
 * AuthorizationRule / OPA / 外部 PDP 链路既回答运行期，也回答这里。
 */
export default function SubjectAccessReviewTab() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const [form] = Form.useForm<FormValues>();
  const [result, setResult] = useState<SubjectAccessReviewRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const requestType = Form.useWatch('requestType', form) ?? 'resource';

  const submit = async (values: FormValues) => {
    let extra: Record<string, string[]> | undefined;
    if (values.extra?.trim()) {
      try {
        const parsed = JSON.parse(values.extra) as Record<string, unknown>;
        extra = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (Array.isArray(value)) {
            extra[key] = value.map(String);
          } else if (value !== undefined && value !== null) {
            extra[key] = [String(value)];
          }
        }
      } catch {
        message.error('extra 必须是合法 JSON 对象');
        return;
      }
    }

    if (values.agent?.trim()) {
      extra = { ...(extra ?? {}), 'onexai.io/agent': [values.agent.trim()] };
    }

    const spec: SubjectAccessReviewSpec =
      values.requestType === 'nonResource'
        ? {
            user: values.user.trim(),
            groups: values.groups ?? [],
            extra,
            nonResourceAttributes: {
              verb: values.verb,
              path: values.path?.trim() || '/',
            },
          }
        : {
            user: values.user.trim(),
            groups: values.groups ?? [],
            extra,
            resourceAttributes: {
              verb: values.verb,
              group: 'onexai.io',
              version: 'v1',
              resource: (values.resource || 'agent').trim(),
              name: values.name?.trim() || undefined,
              namespace: values.namespace?.trim() || undefined,
              subresource: values.subresource?.trim() || undefined,
            },
          };

    setLoading(true);
    try {
      setResult(await subjectAccessReview(spec));
    } catch (err) {
      message.error(err instanceof Error ? err.message : '鉴权请求失败');
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    form.resetFields();
    setResult(null);
  };

  const status = result?.status;
  const verdict = status?.allowed ? 'allowed' : status?.denied ? 'denied' : 'no opinion';
  const verdictColor = status?.allowed ? 'green' : status?.denied ? 'red' : 'orange';

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        title="SubjectAccessReview 回答“某主体能否对某资源执行某动作”"
        description="请求体与 Kubernetes authorization.k8s.io/v1 SubjectAccessReview 一致。管理员可查询任意主体；普通用户会被服务端强制为当前登录身份。服务端把 get/list/watch 折算为 read、其余折算为 write，NoOpinion 一律 fail-closed 为 denied。"
      />

      <Card size="small" title="发起鉴权">
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={{
            requestType: 'resource',
            user: claims?.userId ?? '',
            groups: [],
            verb: 'get',
            resource: 'agent',
          }}
        >
          <Form.Item name="requestType" label="请求类型">
            <Radio.Group
              optionType="button"
              options={[
                { label: '资源请求', value: 'resource' },
                { label: '非资源请求', value: 'nonResource' },
              ]}
            />
          </Form.Item>

          <Space size="large" wrap>
            <Form.Item
              name="user"
              label="用户（spec.user）"
              rules={[{ required: true, message: '请输入用户' }]}
              style={{ minWidth: 260 }}
            >
              <Input placeholder="例如 go.kong" />
            </Form.Item>
            <Form.Item
              name="groups"
              label="用户组（spec.groups）"
              style={{ minWidth: 260 }}
              extra="会作为 group_codes 参与策略匹配，对应 AuthorizationRule 的 group 主体。"
            >
              <Select mode="tags" placeholder="例如 oai-chat" tokenSeparators={[',', ' ']} />
            </Form.Item>
            <Form.Item
              name="verb"
              label="动词"
              rules={[{ required: true }]}
              style={{ minWidth: 200 }}
            >
              <Select options={VERBS} />
            </Form.Item>
          </Space>

          {requestType === 'nonResource' ? (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                title="非资源请求在本平台恒为 denied"
                description="平台的授权模型按 kind:name 寻址，没有路径维度。服务端对 nonResourceAttributes 一律返回 denied 且不写 evaluationError——「策略没被问过的问题不能给 allow」正是 fail-closed 的预期行为。"
              />
              <Form.Item name="path" label="路径（nonResourceAttributes.path）">
                <Input placeholder="例如 /healthz" />
              </Form.Item>
            </>
          ) : (
            <>
              <Space size="large" wrap>
                <Form.Item
                  name="resource"
                  label="资源（resource）"
                  style={{ minWidth: 260 }}
                  extra="控制台 kind（agent）与 K8s 复数写法（agents）都可以，服务端会统一映射。"
                >
                  <AutoComplete
                    options={RESOURCE_OPTIONS}
                    placeholder="例如 agent / memories / models"
                    filterOption={(input, option) => {
                      const text = `${String(option?.value ?? '')} ${String(
                        option?.label ?? ''
                      )}`.toLowerCase();
                      return text.includes(input.toLowerCase());
                    }}
                  />
                </Form.Item>
                <Form.Item name="name" label="名称（name）" style={{ minWidth: 220 }}>
                  <Input placeholder="例如 helper" />
                </Form.Item>
                <Form.Item name="namespace" label="命名空间（namespace）" style={{ minWidth: 220 }}>
                  <Input placeholder="可选" />
                </Form.Item>
                <Form.Item
                  name="subresource"
                  label="子资源（subresource）"
                  style={{ minWidth: 200 }}
                >
                  <Input placeholder="可选" />
                </Form.Item>
              </Space>
              <Form.Item
                name="agent"
                label="Agent 作用域（extra: onexai.io/agent）"
                extra="用于匹配 AuthorizationRule 的 agentNames；资源本身是 agent 时留空即可（name 会作为 agentNames）。"
              >
                <Input placeholder="可选，例如 k8s-sre-agent" />
              </Form.Item>
            </>
          )}

          <Form.Item name="extra" label="额外属性（spec.extra，JSON 对象）">
            <Input.TextArea rows={3} placeholder='{"env": "prod"}' />
          </Form.Item>

          <Space wrap>
            <Button type="primary" htmlType="submit" loading={loading}>
              发起鉴权
            </Button>
            <Button onClick={clear} disabled={loading}>
              清空
            </Button>
          </Space>
        </Form>
      </Card>

      {status && (
        <Card
          size="small"
          title="鉴权结果"
          extra={
            <Space>
              <Tag color={verdictColor}>{verdict}</Tag>
              {status.evaluationError && <Tag color="orange">evaluationError</Tag>}
            </Space>
          }
        >
          <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
            <Descriptions.Item label="allowed">{String(status.allowed)}</Descriptions.Item>
            <Descriptions.Item label="denied">{String(Boolean(status.denied))}</Descriptions.Item>
            <Descriptions.Item label="reason" span={2}>
              {status.reason || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="evaluationError" span={2}>
              {status.evaluationError ? (
                <Typography.Text type="danger">{status.evaluationError}</Typography.Text>
              ) : (
                '-'
              )}
            </Descriptions.Item>
          </Descriptions>

          <Space style={{ marginTop: 16 }} wrap>
            <Button size="small" onClick={() => navigate('/policies')}>
              去授权策略查看
            </Button>
            <Typography.Text type="secondary">
              该结果与运行时判定来自同一策略链路；denied 时先看 reason 命中了哪条规则。
            </Typography.Text>
          </Space>

          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">原始请求与响应</Typography.Text>
            <JsonBlock value={result} />
          </div>
        </Card>
      )}
    </Space>
  );
}
