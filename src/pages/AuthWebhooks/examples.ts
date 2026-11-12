import { AGENT_BASE_URL } from '@/api/client';

import { SUBJECT_ACCESS_REVIEW_PATH, TOKEN_REVIEW_PATH } from './constants';

/**
 * 浏览器当前能访问到的评审服务地址。
 *
 * 开发期 `AGENT_BASE_URL` 是 `/api/onexai/agent`（rsbuild 代理），生产期是
 * `PUBLIC_ONEXAI_AGENT_BASE_URL`。两种情况下 `new URL(base, origin)` 都是
 * 一个能直接 curl 的绝对地址——页面里的示例因此不写死端口：9181 只在某一种
 * 部署里成立，而代理路径在当前部署里一定成立。
 */
export function reviewBaseURL(): string {
  const base = AGENT_BASE_URL.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(base)) return base;
  if (typeof window === 'undefined') return base;
  try {
    return new URL(base, window.location.origin).toString().replace(/\/+$/, '');
  } catch {
    return base;
  }
}

/**
 * kubeconfig 里的 `server`：必须是**调用方进程**（kube-apiserver / declserver）
 * 能访问的地址，而不是浏览器地址。
 *
 * 开发期 `AGENT_BASE_URL` 是浏览器侧的代理路径，别的进程解析不了；此时退回
 * 本机服务地址。部署配置成绝对地址时才需要把它换成集群内可解析的名字。
 */
export function webhookServerURL(): string {
  const base = AGENT_BASE_URL.replace(/\/+$/, '');
  return /^https?:\/\//i.test(base) ? base : 'http://127.0.0.1:9181';
}

/**
 * TokenReview 的 curl 示例。
 *
 * `$WEBHOOK_TOKEN` 是服务端 `auth.webhook-token`（kubeconfig 用户的 bearer），
 * `$JWT` 是**被评审**的平台令牌。两者不是同一个东西：前者证明「调用方有权发起
 * 评审」，后者回答「这个令牌是谁」。
 */
export function tokenReviewCurl(base = reviewBaseURL()): string {
  return `curl -s -X POST '${base}${TOKEN_REVIEW_PATH}' \\
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"apiVersion":"authentication.k8s.io/v1","kind":"TokenReview","spec":{"token":"'"$JWT"'","audiences":["onexai"]}}'`;
}

/**
 * SubjectAccessReview 的 curl 示例。
 *
 * 主体默认取当前管理员，示例因此可以直接跑；`resource` 用 Kubernetes 的复数
 * 写法，服务端会把 `agents` / `mcpservers` 这类名字映射回平台的 kind。
 */
export function subjectAccessReviewCurl(
  subject: { user: string; groups?: string[] },
  base = reviewBaseURL()
): string {
  const body = JSON.stringify({
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SubjectAccessReview',
    spec: {
      user: subject.user,
      ...(subject.groups?.length ? { groups: subject.groups } : {}),
      resourceAttributes: {
        verb: 'get',
        group: 'onexai.io',
        version: 'v1',
        resource: 'agents',
        name: 'helper',
      },
    },
  });
  return `curl -s -X POST '${base}${SUBJECT_ACCESS_REVIEW_PATH}' \\
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '${body}'`;
}

/** 供 kube-apiserver / declserver 的 webhook 配置使用的 kubeconfig 片段。 */
export function webhookKubeconfig(server = webhookServerURL()): string {
  return `apiVersion: v1
kind: Config
clusters:
  - name: onexai-agent
    cluster:
      server: ${server}
users:
  - name: webhook-caller
    user:
      token: <auth.webhook-token>
contexts:
  - name: webhook
    context: { cluster: onexai-agent, user: webhook-caller }
current-context: webhook`;
}
