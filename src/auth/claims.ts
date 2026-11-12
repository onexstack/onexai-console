/**
 * 从 JWT 里读出展示用的身份。
 *
 * # 这不是鉴权
 *
 * 前端解出的 `is_admin` 只用来隐藏入口和写文案；真正的闸在服务端
 * （`/v1/admin/*`、`/v1/tickets`、`/v1/agent-command-coverage` 都要求管理员角色）。
 * 伪造这个字段不会让任何接口放行。
 *
 * onexai 没有 userinfo 端点，也没有刷新端点；身份只能从登录时拿到的令牌里读。
 */

export interface SessionClaims {
  userId?: string;
  name?: string;
  provider?: string;
  isAdmin: boolean;
  isSRE: boolean;
  exp?: number;
}

/** base64url → UTF-8 JSON。失败返回 null，不抛错。 */
export function decodeClaims(token: string | null | undefined): SessionClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  const payloadPart = parts[1];
  if (parts.length < 2 || !payloadPart) return null;
  try {
    const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
        .split('')
        .map(c => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    );
    const payload = JSON.parse(json) as Record<string, unknown>;
    return {
      userId: typeof payload['user_id'] === 'string' ? payload['user_id'] : undefined,
      name:
        typeof payload['name'] === 'string'
          ? payload['name']
          : typeof payload['sub'] === 'string'
            ? payload['sub']
            : undefined,
      provider: typeof payload['provider'] === 'string' ? payload['provider'] : undefined,
      isAdmin: payload['is_admin'] === true,
      isSRE: payload['is_sre'] === true,
      exp: typeof payload['exp'] === 'number' ? payload['exp'] : undefined,
    };
  } catch {
    return null;
  }
}

/** 令牌是否已过期（只做展示；服务端仍会验签并拒绝）。 */
export function isExpired(claims: SessionClaims | null): boolean {
  return Boolean(claims?.exp && claims.exp * 1000 <= Date.now());
}
