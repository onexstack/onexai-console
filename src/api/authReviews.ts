import { agentClient, request } from './client';
import { AGENT } from './endpoints';

/**
 * Kubernetes 访问评审协议（TokenReview / SubjectAccessReview）。
 *
 * 形状与 Kubernetes API 一一对应，控制台不做字段改名：这样页面里的请求体
 * 可以直接复制到 curl / kubeconfig 接入说明里，也可以被任何 K8s 工具复用。
 */

export interface K8sUserInfo {
  username: string;
  uid?: string;
  groups?: string[];
  extra?: Record<string, string[]>;
}

export interface TokenReviewStatus {
  authenticated: boolean;
  user?: K8sUserInfo;
  audiences?: string[];
  error?: string;
}

export interface TokenReviewRequest {
  apiVersion: 'authentication.k8s.io/v1';
  kind: 'TokenReview';
  spec: {
    token: string;
    audiences?: string[];
  };
  status?: TokenReviewStatus;
}

export interface ResourceAttributes {
  namespace?: string;
  verb: string;
  group?: string;
  version?: string;
  resource: string;
  subresource?: string;
  name?: string;
}

export interface NonResourceAttributes {
  path: string;
  verb: string;
}

export interface SubjectAccessReviewSpec {
  user: string;
  groups?: string[];
  extra?: Record<string, string[]>;
  resourceAttributes?: ResourceAttributes;
  nonResourceAttributes?: NonResourceAttributes;
}

export interface SubjectAccessReviewStatus {
  allowed: boolean;
  denied?: boolean;
  reason?: string;
  evaluationError?: string;
}

export interface SubjectAccessReviewRequest {
  apiVersion: 'authorization.k8s.io/v1';
  kind: 'SubjectAccessReview';
  spec: SubjectAccessReviewSpec;
  status?: SubjectAccessReviewStatus;
}

export interface AuthWebhookInfo {
  callerAuthConfigured: boolean;
  tokenReviewPath: string;
  subjectAccessReviewPath: string;
  authzBackends: string[];
  /** 生效的 AuthenticationConfiguration 文件；空表示只用 flag / 内置 HS256。 */
  authenticationConfig?: string;
  /** 生效的 AuthorizationConfiguration 文件；空表示用 authz.webhook.endpoints。 */
  authorizationConfig?: string;
}

export async function tokenReview(spec: TokenReviewRequest['spec']): Promise<TokenReviewRequest> {
  return request<TokenReviewRequest>(agentClient, {
    url: AGENT.tokenReviews,
    method: 'POST',
    data: {
      apiVersion: 'authentication.k8s.io/v1',
      kind: 'TokenReview',
      spec,
    },
  });
}

export async function subjectAccessReview(
  spec: SubjectAccessReviewSpec,
): Promise<SubjectAccessReviewRequest> {
  return request<SubjectAccessReviewRequest>(agentClient, {
    url: AGENT.subjectAccessReviews,
    method: 'POST',
    data: {
      apiVersion: 'authorization.k8s.io/v1',
      kind: 'SubjectAccessReview',
      spec,
    },
  });
}

export async function getAuthWebhookInfo(): Promise<AuthWebhookInfo> {
  return request<AuthWebhookInfo>(agentClient, {
    url: AGENT.authWebhookInfo,
    method: 'GET',
  });
}
