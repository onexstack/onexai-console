import { useMemo } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Result,
  Row,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import { getAuthWebhookInfo } from '@/api/authReviews';
import PageLayout from '@/components/PageLayout';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import CodeBlock from './CodeBlock';
import { SUBJECT_ACCESS_REVIEW_PATH, TOKEN_REVIEW_PATH } from './constants';
import { subjectAccessReviewCurl, tokenReviewCurl, webhookKubeconfig } from './examples';
import SubjectAccessReviewTab from './SubjectAccessReviewTab';
import TokenReviewTab from './TokenReviewTab';

/**
 * 访问评审（TokenReview / SubjectAccessReview）调试台。
 *
 * 页面不自己判断权限：两个 Tab 只把请求原样交给服务端的评审端点，再把判决和
 * 原始 JSON 展示出来。管理员可以查询任意主体；普通用户会被服务端强制为当前
 * 登录身份（见后端 UserGuard 与 handler）。
 *
 * 页面同时是这两个端点的说明：它们把平台的认证器与授权策略以 Kubernetes 的
 * webhook 协议暴露出去，调用方是 kube-apiserver / declserver 这类外部进程，
 * 而不是浏览器。
 */
export default function AuthWebhooksPage() {
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const isAdmin = Boolean(claims?.isAdmin);

  const info = useQuery({
    queryKey: ['auth-webhook-info'],
    queryFn: getAuthWebhookInfo,
    // 两个控制台端点都在服务端的治理路径（/v1/authn/*）下，非管理员必然 403；
    // enabled 省掉的是一次注定失败的请求，也是页面上唯一一次「不该发」的调用。
    enabled: isAdmin,
    staleTime: 30_000,
  });

  if (!isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="403"
          title="需要管理员权限"
          subTitle="访问评审会暴露部分策略与令牌校验结果，只对管理员开放。"
        />
      </div>
    );
  }

  const infoValues = info.data;
  const tokenReviewPath = infoValues?.tokenReviewPath || TOKEN_REVIEW_PATH;
  const subjectAccessReviewPath = infoValues?.subjectAccessReviewPath || SUBJECT_ACCESS_REVIEW_PATH;
  const callerAuthConfigured = Boolean(infoValues?.callerAuthConfigured);
  const authzBackends = infoValues?.authzBackends ?? [];
  const subject = { user: claims?.userId || claims?.name || 'go.kong', groups: [] as string[] };

  return (
    <PageLayout
      title="认证 / 授权 Webhook"
      titleExtra={
        <Button icon={<ReloadOutlined />} loading={info.isFetching} onClick={() => info.refetch()}>
          刷新状态
        </Button>
      }
    >
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          title="TokenReview 回答“这个令牌是谁”，SubjectAccessReview 回答“这个主体能不能对这个资源做这个动作”"
          description="两者是 Kubernetes 的 webhook 认证 / 授权协议，oai-agent-apiserver 作为 webhook server 实现它们。页面只负责发出请求并展示结果，判决全部来自服务端的认证器与策略链路。"
        />

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card
              size="small"
              style={{ height: '100%' }}
              title="认证 · TokenReview"
              extra={<Tag color="blue">authentication.k8s.io/v1</Tag>}
            >
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                输入一个令牌，返回它代表的身份：authenticated、username、uid、groups、extra
                以及失败原因。服务端先尝试已配置的 Kubernetes 认证器链（如 OIDC），再退回平台内置的
                HS256 校验——与 HTTP 中间件用的是同一份实现。
              </Typography.Paragraph>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="作用">
                  让 kube-apiserver / declserver 用平台账号完成认证，不必另建一套身份源；
                  也是排查「这个令牌为什么登录不上」的入口。
                </Descriptions.Item>
                <Descriptions.Item label="端点">
                  <Typography.Text code copyable={{ text: tokenReviewPath }}>
                    {tokenReviewPath}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="调用方凭据">
                  {info.isLoading ? (
                    '读取中…'
                  ) : callerAuthConfigured ? (
                    <Tag color="green">已配置 auth.webhook-token</Tag>
                  ) : (
                    <Tag color="orange">未配置：原生端点返回 503</Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="认证配置">
                  {info.isLoading ? (
                    '读取中…'
                  ) : infoValues?.authenticationConfig ? (
                    <Typography.Text code copyable={{ text: infoValues.authenticationConfig }}>
                      {infoValues.authenticationConfig}
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">未使用配置文件：内置 HS256</Typography.Text>
                  )}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card
              size="small"
              style={{ height: '100%' }}
              title="授权 · SubjectAccessReview"
              extra={<Tag color="purple">authorization.k8s.io/v1</Tag>}
            >
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                输入主体与资源动作，返回 allowed / denied / reason / evaluationError。服务端 把 K8s
                动词折算成平台的 read / write，把资源名折算成 kind，再交给运行时同一套
                AuthorizationRule / OPA / Webhook 策略评估。
              </Typography.Paragraph>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="作用">
                  让外部组件按平台同一套授权策略做决策（K8s webhook authorizer 协议）；
                  也是排查「某人为什么没有权限」的入口，结论与运行时一致。
                </Descriptions.Item>
                <Descriptions.Item label="端点">
                  <Typography.Text code copyable={{ text: subjectAccessReviewPath }}>
                    {subjectAccessReviewPath}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="授权后端">
                  {info.isLoading ? (
                    '读取中…'
                  ) : authzBackends.length ? (
                    <Space wrap size={[4, 4]}>
                      {authzBackends.map(backend => (
                        <Tag key={backend}>{backend}</Tag>
                      ))}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">未启用</Typography.Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="授权配置">
                  {info.isLoading ? (
                    '读取中…'
                  ) : infoValues?.authorizationConfig ? (
                    <Typography.Text code copyable={{ text: infoValues.authorizationConfig }}>
                      {infoValues.authorizationConfig}
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">
                      未使用配置文件：内置 OPA + webhook.endpoints
                    </Typography.Text>
                  )}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        </Row>

        {info.isError && (
          <Alert
            type="error"
            showIcon
            title="无法读取评审端点状态"
            description={info.error instanceof Error ? info.error.message : '请求失败'}
          />
        )}

        {!info.isLoading && !info.isError && !callerAuthConfigured && (
          <Alert
            type="warning"
            showIcon
            title="原生 /apis 端点未启用"
            description="未配置 auth.webhook-token 时，Kubernetes 原生评审端点返回 503，不会以无认证方式暴露。本页两个 Tab 使用管理员登录令牌调用控制台端点，不受影响。"
          />
        )}

        <Tabs
          items={[
            { key: 'token', label: '认证（TokenReview）', children: <TokenReviewTab /> },
            {
              key: 'subjectaccess',
              label: '授权（SubjectAccessReview）',
              children: <SubjectAccessReviewTab />,
            },
            {
              key: 'integration',
              label: '接入说明',
              children: (
                <Space orientation="vertical" size="large" style={{ width: '100%' }}>
                  <Alert
                    type="info"
                    showIcon
                    title="页面按钮与下面的示例走两组端点，凭据不同、判决相同"
                    description="两个 Tab 用管理员登录令牌调用 /v1/authn/tokenreviews 与 /v1/authz/subjectaccessreviews；下面的 curl / kubeconfig 走 Kubernetes 原生路径 /apis/*，调用方凭据是 auth.webhook-token（缺失或错误返回 401）。两组端点复用同一份认证器与授权链路。"
                  />

                  <Card size="small" title="TokenReview（认证）">
                    <Typography.Paragraph type="secondary">
                      $WEBHOOK_TOKEN 是服务端 auth.webhook-token；$JWT 是被评审的平台令牌。
                    </Typography.Paragraph>
                    <CodeBlock code={tokenReviewCurl()} ariaLabel="复制 TokenReview curl" />
                  </Card>

                  <Card size="small" title="SubjectAccessReview（授权）">
                    <Typography.Paragraph type="secondary">
                      主体示例取当前管理员；resource 用 Kubernetes 的复数写法，服务端会映射回平台
                      kind。
                    </Typography.Paragraph>
                    <CodeBlock
                      code={subjectAccessReviewCurl(subject)}
                      ariaLabel="复制 SubjectAccessReview curl"
                    />
                  </Card>

                  <Card size="small" title="kubeconfig 片段">
                    <Typography.Paragraph type="secondary">
                      供 declserver / kube-apiserver 的 --authentication-token-webhook-config-file
                      与 --authorization-webhook-config-file 使用。server
                      必须是调用方进程能访问的地址 （本机部署默认
                      http://127.0.0.1:9181），不是浏览器看到的代理路径。
                    </Typography.Paragraph>
                    <CodeBlock code={webhookKubeconfig()} ariaLabel="复制 kubeconfig" />
                  </Card>
                </Space>
              ),
            },
          ]}
        />
      </Space>
    </PageLayout>
  );
}
