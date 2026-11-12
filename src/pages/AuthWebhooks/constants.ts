/**
 * Kubernetes 访问评审协议的两个原生路径。
 *
 * 与 client-go 在 kubeconfig 的 server 后面追加的路径一致：外部 apiserver 把
 * `--authentication-token-webhook-config-file` /
 * `--authorization-webhook-config-file` 指向本服务时不需要路径重写，页面里的
 * curl 与 kubeconfig 片段也能直接复用。
 *
 * 控制台自己走的是另一组路径（`/v1/authn/tokenreviews`、
 * `/v1/authz/subjectaccessreviews`）：那两条用管理员登录令牌，`/apis/*` 这两条
 * 用 `auth.webhook-token`。两组端点共用同一份认证器与授权链路，判决一致。
 */
export const TOKEN_REVIEW_PATH = '/apis/authentication.k8s.io/v1/tokenreviews';
export const SUBJECT_ACCESS_REVIEW_PATH = '/apis/authorization.k8s.io/v1/subjectaccessreviews';
