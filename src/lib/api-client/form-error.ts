/**
 * 401 的两副面孔：**会话失效**与**表单错误**。
 *
 * # 为什么它们必须分开
 *
 * 响应拦截器把 401 读成「会话没了」：先拿 refresh token 换一对新的、重放原请求，
 * 续不上就清空登录态、由路由层把人送回登录页。对业务请求这是对的——令牌被撤销、
 * 过期、被别的设备登出，都只有这一种表现。
 *
 * 但平台上有几条端点的 401 说的**不是**这件事，而是「你这次提交里填的凭据不对」：
 *
 * - `POST /auth/password/change`：当前密码不对。这是用户**正要在表单里改**的东西，
 *   是这套界面的正常一步，不是会话故障；
 * - 滑块验证码校验失败。
 *
 * 把它们当成会话失效，后果不是「提示不准」而是**一次误登出**：
 *
 * 1. 改密码时打错一次当前口令 → 401；
 * 2. 拦截器刷新令牌（这一步还会把 refresh token 轮换掉）→ 重放 → 仍是同一个 401
 *    （口令还是那个错的），而这次 `_retry` 已经是 true；
 * 3. 走到登出：**用户被自己的错别字踢下线**，而真正的答案（当前密码不对）只留在
 *    那两次被丢掉的响应体里，页面已经不在他眼前了。
 *
 * 判断依据只能是业务码，不能是路径：这几条端点**照常要令牌**（改密码要凭令牌知道
 * 改谁的），也照常该按过期主动刷新——与 `DEFAULT_TOKEN_EXEMPT_PATHS` 里那些「本来
 * 就没有令牌可带」的换令牌端点不是一回事。所以这里认码，且拦截器里的位置在刷新
 * 判断**之前**。
 *
 * # 清单为什么是闭集
 *
 * `Unauthenticated.InvalidCredentials` 是后端**唯一**一个「凭据比对失败」的答案
 * （见 onex `internal/pkg/errno/code.go`）：登录、改密码、验证码三处都回它，而鉴权
 * 中间件从不回它——令牌的问题用的是 `Unauthenticated.TokenInvalid` / 被登出的那条
 * 说明。两个方向都不会串：登录与验证码本就在免令牌清单里，改密码是这里唯一的活口。
 */

/**
 * 401 里属于「表单错误」的业务码。
 *
 * 后端对每一次凭据比对失败都回这一个码，且**故意不区分**「账号不存在」与「口令
 * 不对」（枚举保护）——所以这里是整族，不是逐端点一条。
 */
export const FORM_ERROR_CODES: readonly string[] = ['Unauthenticated.InvalidCredentials'];

/** 从响应体里读业务码，读不到返回空串。 */
function codeIn(body: unknown): string {
  if (body && typeof body === 'object' && 'code' in body) {
    const code = (body as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

/**
 * 这个 401 响应体说的是不是「表单错误」。
 *
 * 调用点已经确认过状态码是 401（见 `setupInterceptors` 的响应拦截器），这里只判
 * 正文里的码——同一个码在别的状态码下不会出现，多判一次状态只会多一处会漂移的分支。
 */
export function isFormErrorBody(body: unknown): boolean {
  return FORM_ERROR_CODES.includes(codeIn(body));
}
