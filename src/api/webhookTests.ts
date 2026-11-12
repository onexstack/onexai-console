/**
 * 认证 / 鉴权 Webhook 的在线测试。
 *
 * 测试端点挂在 Webhook 资源下，并要求管理员身份；它**只调用被测试的那一个**
 * Webhook，不经过平台的认证/授权链路。这样测出来的才是「这个后端本身怎么
 * 回答」，而不是「平台当前配置下会给出什么结论」。
 */
import { agentClient, request } from './client';
import { AGENT } from './endpoints';

/** TokenReview 的 status。字段名与 Kubernetes 的响应一致。 */
export type TokenReviewStatus = {
  authenticated?: boolean;
  user?: {
    username?: string;
    uid?: string;
    groups?: string[];
    extra?: Record<string, string[]>;
  };
  audiences?: string[];
  error?: string;
};

/** SubjectAccessReview 的 status。 */
export type SubjectAccessReviewStatus = {
  allowed?: boolean;
  denied?: boolean;
  reason?: string;
  evaluationError?: string;
};

/** 一次测试调用的结果：后端说了什么，而不是平台判了什么。 */
export type ReviewTestResponse<S> = {
  /** 后端返回的 HTTP 状态；请求未到达时为 0/未设置。 */
  httpStatus?: number;
  latencyMs?: number;
  /** 后端返回的原始响应体（截断到 1 MiB）。 */
  raw?: string;
  status?: S;
  /** 平台侧的调用错误（不可达、超时、非 2xx、无法解析）。 */
  error?: string;
};

export type TokenReviewTestInput = {
  token: string;
  audiences?: string[];
};

export type SubjectAccessReviewTestInput = {
  user: string;
  groups?: string[];
  extra?: Record<string, string[]>;
  resourceAttributes?: {
    namespace?: string;
    verb: string;
    group?: string;
    version?: string;
    resource: string;
    subresource?: string;
    name?: string;
  };
  nonResourceAttributes?: { path: string; verb: string };
};

/** 向指定认证 Webhook 发一次 TokenReview。 */
export async function testTokenReview(
  name: string,
  namespace: string | undefined,
  input: TokenReviewTestInput
): Promise<ReviewTestResponse<TokenReviewStatus>> {
  return request<ReviewTestResponse<TokenReviewStatus>>(agentClient, {
    url: AGENT.webhookTokenReviewTest(name, namespace),
    method: 'POST',
    data: {
      apiVersion: 'authentication.k8s.io/v1',
      kind: 'TokenReview',
      spec: input,
    },
  });
}

/** 向指定鉴权 Webhook 发一次 SubjectAccessReview。 */
export async function testSubjectAccessReview(
  name: string,
  namespace: string | undefined,
  input: SubjectAccessReviewTestInput
): Promise<ReviewTestResponse<SubjectAccessReviewStatus>> {
  return request<ReviewTestResponse<SubjectAccessReviewStatus>>(agentClient, {
    url: AGENT.webhookSubjectAccessReviewTest(name, namespace),
    method: 'POST',
    data: {
      apiVersion: 'authorization.k8s.io/v1',
      kind: 'SubjectAccessReview',
      spec: input,
    },
  });
}
