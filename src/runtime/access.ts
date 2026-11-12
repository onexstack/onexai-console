/**
 * 只对管理员有意义的入口。
 *
 * 这里只是「不显示」：服务端仍然要求管理员角色，页面也会再拦一次。把入口藏
 * 起来是为了让普通用户不点进一个必然 403 的页面，不是鉴权。
 *
 * 名单与后端的鉴权一一对应（括号内是它在侧栏中的位置）：
 * - `/users`：chat 服务的用户（`/v1/users`，RequireAdmin）——身份与授权 → 权限控制；
 * - `/authz-rules`：访问控制规则（`/v1/agent/authorizationrules`，agent 的
 *   governancePaths）——身份与授权；
 * - `/tickets`：chat 服务的 `GET /v1/tickets`，挂了 RequireAdmin——工单中心；
 * - `/async-tasks`：agent 运行记录（`/v1/admin/agent/runs`，整组 `/v1/admin/*`
 *   要求管理员）——智能中心 → 自动化。
 * - `/observability`：观测中心（`/v1/admin/agent/runs/monitor`、`/stuck` 等
 *   管理面聚合）——观测中心；该分组对普通用户整组隐藏。
 *   （`/command-coverage` 同样是管理员接口，但入口已隐藏，不在菜单里。）
 *
 * 个人访问密钥（`/v1/aksk`）**不在**名单里：每个账号管理自己的一对凭据，服务端
 * 登录即可用；它已并入账号页，不再占侧栏。服务间凭据（secrets）没有侧栏入口，
 * 只有路由。
 *
 * 其余业务资源（智能体、模型、知识库等）普通用户可读，写操作按 owner 隔离
 * ——那是服务端的事，入口不需要隐藏。值班组读接口对登录用户开放、写接口要求
 * 管理员，页面自己按 `isAdmin` 收窄按钮。引用授权与平台能力编排普通用户可读
 * （写操作仅管理员），因此「身份与授权」分组对普通用户仍然非空。
 *
 * 值班周报（`/oncall-weekly`）也不在名单里：它是纯占位页，尚未调用任何受保护
 * 接口，所有登录用户可见。它与 `/oncall-groups` 首段不同，不会命中值班组那条
 * 「读放行、写收紧」的规则。
 */
export const ADMIN_ONLY_PATHS = new Set([
  '/users',
  '/user-groups',
  '/policies',
  '/authz-rules',
  '/tickets',
  '/async-tasks',
  '/observability',
]);

/**
 * 路径是否属于管理员专属入口。
 *
 * 按第一段判断，所以 `/tickets/tkt-1` 这类详情页也会命中；侧栏菜单的叶子 key
 * 是精确路径，两者可以共用同一份名单。
 */
export function isAdminOnlyPath(path: string): boolean {
  const first = path.split('/').filter(Boolean)[0];
  return first ? ADMIN_ONLY_PATHS.has(`/${first}`) : false;
}
