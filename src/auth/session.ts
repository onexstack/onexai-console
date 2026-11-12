import { loginWithLark, loginWithPassword, register as registerRequest } from '@/api/auth';
import { clearToken, setToken } from './tokenStore';

/**
 * 本应用的会话动作。
 *
 * 状态本身在 `tokenStore.ts`（它自己广播变化），这里只有两个会改变状态的调用，
 * 以及一段必须写下来的边界。
 *
 * # 与宿主登录的关系：没有关系
 *
 * 宿主已经登录过，不代表这里登录过；这里登出也不影响宿主。两边是不同的平台、
 * 不同的签发者、不同的密钥——onexai 验不了 OneX 的 iam 令牌，反之亦然。将来要
 * 统一身份，正确做法是让 onexai 信任 OneX 的 iam（或接飞书 SSO），而不是让这个
 * 子应用去偷宿主的令牌：那会让「谁在操作」在服务端变成一句无法验证的话。
 */

/**
 * 登录并写入令牌。
 *
 * 服务端现在用 chat.user 里的 bcrypt 哈希校验凭据（见 onexai 的
 * biz/v1/auth.Login）；失败原样抛出，交给表单显示。
 */
export async function signIn(username: string, password: string): Promise<void> {
  const response = await loginWithPassword(username, password);
  setToken(response.token);
}

/**
 * 注册并直接进入应用。
 *
 * 后端在注册成功时同时签发令牌：用户点了一次「注册」，期待的结果是「进去了」，
 * 拆成注册 + 再登录会让同一动作有两种失败态。
 */
export async function signUp(
  username: string,
  password: string,
  displayName?: string
): Promise<void> {
  const response = await registerRequest(username, password, displayName);
  setToken(response.token);
}

/**
 * 完成飞书 OAuth 登录。
 *
 * 返回登录后要回到的站内路径（后端从签名过的 state 里解出来）；没有就返回
 * `undefined`，由调用方落到首页。
 */
export async function signInWithLark(code: string, state: string): Promise<string | undefined> {
  const response = await loginWithLark(code, state);
  setToken(response.token);
  return response.redirect;
}

/**
 * 登出。
 *
 * 只清本地令牌：onexai 签的是无状态 JWT，服务端不持有会话，所以「登出」在这台
 * 浏览器上就是把这枚令牌抹掉。
 */
export function signOut(): void {
  clearToken();
}
