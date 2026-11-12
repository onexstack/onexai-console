import { getToken, setToken } from './tokenStore';

/**
 * 开发期会话旁路。
 *
 * `pnpm dev` 时如果设置了 `DEV_BYPASS_LOGIN=true`，`rsbuild.config.ts` 会用本机
 * 配置里的 `jwt.key` 签一枚管理员令牌，注入到 `PUBLIC_DEV_JWT`。这里在 React
 * 首次渲染前把它写进令牌存储，`SessionGate` 看到令牌就不再渲染登录页。
 *
 * # 为什么不在这里签令牌
 *
 * 签名要用后端共用的 `jwt.key`。把它放进浏览器 bundle 等于把「签发任意管理员
 * 令牌」的能力交给任何一个打开页面的人——即便只有开发环境，也没有理由这么做。
 * 签名留在 Node 侧的 dev server 里，浏览器只拿到一枚 24 小时后过期的结果。
 *
 * # 不覆盖已有登录
 *
 * 已经通过表单登录过时保留那枚令牌：旁路是「省掉一次登录」的兜底，不是把身份
 * 强行换成 dev-bypass。
 */
export function applyDevSessionToken(): void {
  const token = process.env.PUBLIC_DEV_JWT;
  if (!token) return;
  if (getToken()) return;
  setToken(token);
}
