import axios from 'axios';
import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';

import { isFormErrorBody } from './form-error';
import {
  isRateLimited,
  parseRetryAfter,
  rateLimitCode,
  rateLimitMessage,
  type RateLimitInfo,
} from './rate-limit';

// Re-export axios and types
export { axios };
export type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse };

// 401 里「表单错误」与「会话失效」的分野，见 ./form-error
export { isFormErrorBody, FORM_ERROR_CODES } from './form-error';

// 限流（429/413）的语义与文案，见 ./rate-limit
export {
  isRateLimited,
  parseRetryAfter,
  rateLimitCode,
  rateLimitMessage,
  RATE_LIMIT_FALLBACK_MESSAGE,
  TIER_RATE_LIMITED_CTA,
} from './rate-limit';
export type { RateLimitInfo } from './rate-limit';

/**
 * API 配置接口
 *
 * 与 sub-app-runtime 的 ApiConfig 保持一致
 */
export interface ApiConfig {
  /** OpenAPI 文档源 URL 或文件路径（用于 CLI 生成） */
  openapi?: string;

  /** API 基础 URL */
  baseURL: string;

  /** 请求超时时间（毫秒），默认 30000 */
  timeout?: number;

  /** 默认请求头 */
  headers?: Record<string, string>;

  /**
   * 自定义获取 Token 函数（可选）
   * 不提供时自动从 auth.storagePrefix 推断
   */
  getToken?: () => string | null | Promise<string | null>;

  /**
   * 同步读取**当前** access token，不做任何刷新（可选）。
   *
   * 只用于免令牌端点（tokenExemptPaths）：豁免的语义是「不主动刷新、401
   * 不重试」，不是「不许带令牌」——`/auth/refresh` 这类请求手里有现成
   * token 就带上，网关若要求 Authorization 头存在也能通过。但它绝不能走
   * `getToken`：apps/main 的 `getToken` 会在本地 TTL 判过期时**先刷一次**，
   * 刷新请求再走到这里就成了无界递归（见 tokenExemptPaths 一节）。
   *
   * 不提供时免令牌端点照旧不带令牌（原有行为）。
   */
  getRawToken?: () => string | null;

  /**
   * 自定义 401 处理函数（可选）
   * 不提供时触发 'onex-console:auth:unauthorized' 事件
   */
  onUnauthorized?: () => void;

  /**
   * 全局错误处理（可选）
   */
  onError?: (error: AxiosError) => void;

  /**
   * HTTP 错误回调（可选）。
   * 在响应拦截器提取 HTTP 状态码和业务消息后调用，
   * 适合接入全局通知系统（notify.error）或可观测性上报（reportHttpError）。
   *
   * @param status - HTTP 状态码
   * @param message - 从 response.data.message 提取的业务错误消息（或 error.message）
   * @param config - 原始请求配置
   */
  onResponseError?: (status: number, message: string, config?: AxiosRequestConfig) => void;

  /**
   * 限流回调（可选）。当响应是 429（或 413 体量超限）时，在响应拦截器把
   * 后端业务码翻译成用户文案后调用一次，适合接入全局提示（notify.warning）。
   *
   * 与 onResponseError 的区别：onResponseError 面向**所有** HTTP 错误，适合
   * 上报；本回调只处理限流，且已带好「请稍后再试」这类可展示文案和可选的
   * Retry-After，调用点不需要再判断状态码。
   *
   * 限流**不重试**：自动重放会把一次超限放大成持续的请求风暴，正是限流要挡的。
   */
  onRateLimited?: (info: RateLimitInfo) => void;

  /**
   * 401 时尝试刷新 Token 并重试原请求（可选）
   * 返回新 Token 则携带重试；返回 null 或抛错则不重试（走 onUnauthorized）
   */
  refreshToken?: () => Promise<string | null>;

  /**
   * Token 主动刷新阈值（秒），默认 300（5 分钟）。
   * 当 JWT token 距过期时间小于此阈值时，在请求前主动刷新，
   * 避免请求发出后 token 恰好过期导致 401。
   * 设为 0 可关闭主动刷新。
   */
  tokenRefreshThreshold?: number;

  /**
   * 「免令牌端点」清单：既**不注入** Authorization，也**不因 401 触发刷新重试**。
   * 默认见 {@link DEFAULT_TOKEN_EXEMPT_PATHS}，此处传入的是**追加**项（与默认清单
   * 取并集），不是替换——默认清单是正确性下限，不是可以覆盖掉的偏好。
   *
   * # 不是后端的 `auth.public-paths`
   *
   * 名字刻意避开「public」：**两者不是一回事**，照着后端白名单抄会出错。
   * 判据是「这个请求需不需要出现在 Authorization 里」，而不是「后端要不要令牌」。
   *
   * 后端 `auth.public-paths` 里有一条 `/auth/logout`，但它的 handler 要从令牌里取
   * 用户身份（`auth.IdentityFrom(ctx)`）才能注销对应会话。把它放进这个清单，请求
   * 就不带令牌了，服务端拿到空身份、返回 204——**用户点了退出，服务端会话还在**。
   * 后端把登出列为公开，是为了让拿着过期令牌的人也能调通；不是让调用方不必带令牌。
   *
   * # 为什么这个清单必须存在
   *
   * 刷新令牌的 `/auth/refresh` 与业务请求走**同一个 axios 实例**，于是它自己
   * 也要过这两个拦截器。而它恰恰是「还没有新令牌时」发出的请求，两个拦截器
   * 都会认定它需要令牌，各自踩进自己的死循环（两条都真实发生过）：
   *
   * - **401 自锁**：业务请求 401 → 刷新（`isRefreshing = true`）→ 刷新请求也
   *   401 → 它落进**同一个** 401 分支 → 再次进入刷新 → 此时已有刷新在飞，
   *   于是挂进等待队列。而队列只由在飞的那次刷新来唤醒，在飞的刷新又正
   *   `await` 着这个请求。两边互等，永不 settle；`isRefreshing` 卡死为 true，
   *   之后每个 401 请求都进队列陪葬，整个页面永远加载不完。
   * - **无限递归**：请求拦截器在令牌过期时先刷新再注入，而刷新请求本身也要
   *   先过这一步 —— 新令牌尚未写回，判定仍是「已过期」，于是再刷一次……
   *   无界的嵌套 refresh，主线程被 promise 链拖垮。
   *
   * 两者同源：**「去换令牌」的请求不能以「必须带令牌」为前提**。
   *
   * # 匹配方式
   *
   * `url` 在网关模式下会被改写成带前缀的路径（`/onex/iam/auth/refresh`），
   * 开发代理下则是 `/api/auth/refresh`，所以字符串按**包含**匹配而不是全等，
   * 需要更精确的约束时用正则。请求 `url` 认不出来时按普通请求处理（照旧注入、
   * 照旧刷新），保守地维持原有行为。
   *
   * 注意：只有「不靠令牌也能完成」的端点才属于这里。把 `/auth/userinfo`、
   * `/auth/logout` 这类需要令牌来定位身份的端点放进来，会让它拿不到令牌——
   * 前者必然 401，后者更隐蔽：不报错，但什么也没做。
   */
  tokenExemptPaths?: (string | RegExp)[];
}

/**
 * 应用配置接口（简化版，用于 API 客户端）
 *
 * 从 app.config 提取的必要字段
 */
export interface AppConfigForApi {
  /** 应用名称 */
  name: string;
  /** 认证配置 */
  auth: {
    /** 存储 key 前缀 */
    storagePrefix?: string;
    /** 存储类型（与 @onex-console/auth 的 AuthConfig.storage 对齐） */
    storage?: 'localStorage' | 'sessionStorage' | 'memory';
  };
  /** API 配置 */
  api?: ApiConfig;
}

/**
 * API 客户端实例接口
 */
export interface ApiClient {
  /** axios 实例 */
  instance: AxiosInstance;
  /** 获取当前配置 */
  getConfig: () => ApiConfig;
}

// ─── 内部工具函数 ─────────────────────────────────────────────────────────────

/**
 * 默认的免令牌端点清单（见 {@link ApiConfig.tokenExemptPaths} 里「为什么必须存在」）。
 *
 * 只列**换取令牌本身**的端点——调用它们时本来就（还）没有令牌：
 * 任何一次都必须能发出去，且失败时应当把错误原样交给调用方
 * （如「密码错误」要显示在表单上），而不是触发一次刷新、再把用户登出。
 *
 * 与后端的 `auth.public-paths` 有交集但不是同一份：这里**不含** `/auth/logout`
 * （它的 handler 要靠令牌里的身份才知道注销谁，不带令牌就只是空转），也不含
 * `POST /v1/users`（前端注册走 `/auth/register`，而按路径匹配的 `'POST /v1/users'`
 * 会连需要令牌的列表接口一起豁免掉）。理由见 `ApiConfig.tokenExemptPaths`。
 */
export const DEFAULT_TOKEN_EXEMPT_PATHS: (string | RegExp)[] = [
  // 逐条对齐后端 iam 的 `auth.public-paths`（configs/ox-iam-apiserver.yaml）。
  // 刻意写具体路径而不是 `/auth/` 这类前缀：多豁免一个端点不会报错，只会让一个
  // **本该带令牌**的请求静默地不发令牌，那是更难查的故障。
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/sms/send',
  '/auth/sms/login',
  '/auth/wechat/authorize',
  '/auth/wechat/callback',
  '/auth/wechat/login',
  // 滑块验证码。取挑战与提交落点都是「被拒绝的人」在做——他正因为被要求验证码
  // 而来到这里，所以同样没有令牌。
  //
  // 一条就够，不需要再列 `/auth/captcha/verify`：下面的匹配是**包含**而不是全等
  // （理由见 {@link isTokenExempt}），`/auth/captcha` 已经覆盖了它的子路径。
  '/auth/captcha',
  // 开发模式的假扫码页（后端 `wechat.provider: dev` 才开）。
  '/auth/wechat/dev/',
];

/**
 * 判断某个请求 URL 是否属于免令牌端点。
 *
 * 字符串按「包含」匹配：网关模式会把 `/auth/refresh` 改写成
 * `/onex/iam/auth/refresh`，开发代理下是 `/api/auth/refresh`，全等匹配
 * 在这两种模式下都命中不了。
 */
function isTokenExempt(url: string | undefined, patterns: (string | RegExp)[]): boolean {
  // 认不出 URL 就按**普通请求**处理（照旧注入令牌、401 照旧刷新）。
  // 判不出来时保守地维持原有行为，比把它误当成免令牌端点更安全：后者会让
  // 一次真正的会话过期既不注入令牌、也不触发登出，用户卡在页面上没有出口。
  if (!url) return false;
  return patterns.some(pattern =>
    typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)
  );
}

/**
 * 从 JWT token 字符串解码 exp 字段（不验证签名）。
 * 仅用于客户端判断 token 是否即将过期，不作安全校验。
 * 返回 Unix timestamp（秒），解码失败返回 null。
 */
function getJwtExpiration(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64 → JSON
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * 从 AxiosError 的响应体中提取业务错误消息，写回 error.message。
 * 后续 onResponseError / onError 可直接用 error.message 显示给用户。
 *
 * 查找顺序：response.data.message → response.data.msg → response.data.error → 原始 message
 */
function applyResponseMessageToAxiosError(error: AxiosError): void {
  const data = error.response?.data as Record<string, unknown> | undefined;
  if (!data) return;
  const msg =
    (typeof data['message'] === 'string' && data['message']) ||
    (typeof data['msg'] === 'string' && data['msg']) ||
    (typeof data['error'] === 'string' && data['error']);
  if (msg) {
    error.message = msg;
  }
}

// ─── setupInterceptors ────────────────────────────────────────────────────────

/**
 * 为 axios 实例设置拦截器
 *
 * 特性：
 * - 请求前自动注入 Authorization Bearer token
 * - 支持主动 token 刷新（tokenRefreshThreshold）
 * - 401 并发刷新去重：多个并发 401 只发起一次 refreshToken，
 *   其余请求入队等待新 token 后重放
 * - 免令牌端点（tokenExemptPaths，默认 DEFAULT_TOKEN_EXEMPT_PATHS）不注入令牌、401 也不刷新：
 *   刷新令牌的请求本身就在这个实例上，不豁免会与上面的去重互锁
 * - 401 的业务码属于「表单错误」族（FORM_ERROR_CODES，见 ./form-error）时也不刷新、
 *   不登出：那是要显示在表单里的错误（当前口令不对），不是会话失效
 * - 从响应体提取业务错误消息并写回 error.message
 * - onResponseError 回调统一处理 HTTP 错误（适合对接通知系统）
 *
 * @example
 * ```ts
 * import axios from 'axios';
 * import { setupInterceptors } from '@onex-console/api-client';
 *
 * const instance = axios.create({ baseURL: '/api' });
 * setupInterceptors(instance, {
 *   getToken: () => localStorage.getItem('token'),
 *   onUnauthorized: () => window.location.href = '/login',
 *   onResponseError: (status, message) => notify.error(message),
 * });
 * ```
 */
export function setupInterceptors(
  instance: AxiosInstance,
  config: Pick<
    ApiConfig,
    | 'getToken'
    | 'onUnauthorized'
    | 'onError'
    | 'onResponseError'
    | 'onRateLimited'
    | 'refreshToken'
    | 'tokenRefreshThreshold'
    | 'tokenExemptPaths'
    | 'getRawToken'
  >
): void {
  const {
    getToken,
    getRawToken,
    onUnauthorized,
    onError,
    onResponseError,
    onRateLimited,
    refreshToken,
    tokenRefreshThreshold = 300,
    tokenExemptPaths = [],
  } = config;

  // 追加而不是替换：默认清单是**正确性下限**（少了它就会挂死），不是偏好设置。
  // 让调用方声明的是「还有哪些端点免令牌」，而不是「替我把下限也一起重写一遍」。
  const exemptPaths = [...DEFAULT_TOKEN_EXEMPT_PATHS, ...tokenExemptPaths];

  // ── 并发刷新去重状态 ──────────────────────────────────────────────────────
  // 多个并发 401 只发起一次 refreshToken；其余进入订阅队列等待新 token。
  let isRefreshing = false;
  type RefreshSubscriber = {
    resolve: (token: string) => void;
    reject: (reason: unknown) => void;
  };
  let refreshSubscribers: RefreshSubscriber[] = [];

  /** 刷新成功后，用新 token 通知所有等待中的请求 */
  function onRefreshSuccess(newToken: string): void {
    refreshSubscribers.forEach(sub => sub.resolve(newToken));
    refreshSubscribers = [];
  }

  /** 刷新失败后，拒绝所有等待中的请求 */
  function onRefreshFailure(reason: unknown): void {
    refreshSubscribers.forEach(sub => sub.reject(reason));
    refreshSubscribers = [];
  }

  /**
   * 发起 token 刷新。同一时间只有一次进行中；
   * 并发调用方进入 refreshSubscribers 队列等待结果。
   */
  async function performRefresh(): Promise<string | null> {
    if (!refreshToken) return null;

    if (isRefreshing) {
      // 当前已有刷新进行中，入队等待
      return new Promise<string>((resolve, reject) => {
        refreshSubscribers.push({ resolve, reject });
      });
    }

    isRefreshing = true;
    try {
      const newToken = await refreshToken();
      if (newToken) {
        onRefreshSuccess(newToken);
        return newToken;
      }
      onRefreshFailure(new Error('Token refresh returned null'));
      return null;
    } catch (err) {
      onRefreshFailure(err);
      return null;
    } finally {
      isRefreshing = false;
    }
  }

  // ── 请求拦截器：注入 token + 主动刷新 ────────────────────────────────────
  instance.interceptors.request.use(
    async (requestConfig: InternalAxiosRequestConfig) => {
      if (!getToken) return requestConfig;

      // 免令牌端点：不做「过期前主动刷新」、401 也不进刷新重试——它们自己就是
      // 「换令牌」的那一步，进刷新逻辑会与去重互锁（见 ApiConfig.tokenExemptPaths
      // 的递归/自锁两节）。
      //
      // 但豁免不等于「不许带令牌」：手里有现成 access token 就原样带上（读
      // `getRawToken`，**同步、不刷新**），网关若校验 Authorization 头的存在性
      // 也能通过。没带到的代价与原来相同——这些端点本来就不靠它鉴权。
      if (isTokenExempt(requestConfig.url, exemptPaths)) {
        const rawToken = getRawToken?.();
        if (rawToken) requestConfig.headers.set('Authorization', `Bearer ${rawToken}`);
        return requestConfig;
      }

      let token = await getToken();
      if (!token) return requestConfig;

      // 主动检查 JWT 过期：若 token 在 tokenRefreshThreshold 秒内到期则先刷新
      if (tokenRefreshThreshold > 0 && refreshToken) {
        const exp = getJwtExpiration(token);
        if (exp !== null) {
          const secondsUntilExpiry = exp - Math.floor(Date.now() / 1000);
          if (secondsUntilExpiry < tokenRefreshThreshold) {
            const refreshed = await performRefresh();
            if (refreshed) token = refreshed;
          }
        }
      }

      requestConfig.headers.set('Authorization', `Bearer ${token}`);
      return requestConfig;
    },
    (error: AxiosError) => Promise.reject(error)
  );

  // ── 响应拦截器：错误处理 ─────────────────────────────────────────────────
  instance.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      // 从响应体提取业务错误消息
      applyResponseMessageToAxiosError(error);

      const status = error.response?.status;

      // ── 401 处理：并发去重刷新 ────────────────────────────────────────────
      if (status === 401) {
        const original = error.config as
          | (InternalAxiosRequestConfig & { _retry?: boolean })
          | undefined;

        // 免令牌端点 401 直接交给调用方，不进刷新。
        //
        // 这里必须**先于**下面的刷新分支判断：`/auth/refresh` 自己 401（refresh
        // token 失效、被轮换、或网关重置过）时会走到这里，而此刻若去刷新，
        // `isRefreshing` 已是 true（正是这次刷新设的），请求会挂进等待队列等一个
        // 「由自己唤醒」的结果——自锁，两边永不 settle，页面永远转圈。
        //
        // 也不走 onUnauthorized：登录密码错、验证码错都是免令牌端点的 401，
        // 那时候把用户「登出」并派发未授权事件，是把表单错误升级成了会话错误。
        // 真正的会话失效由调用方（refreshAndStore → 外层请求的 401 分支）判定。
        if (isTokenExempt(original?.url, exemptPaths)) {
          return Promise.reject(error);
        }

        // 表单错误同样直接交给调用方：这个 401 说的是「你这次填的凭据不对」，而那句
        // 话要显示在**表单里**。当成会话失效处理的代价见 ./form-error 文件头——
        // 改密码时打错一次当前口令，最后会走到登出，用户被自己的错别字踢下线。
        //
        // 位置在刷新判断**之前**：这类 401 不会因为换了一对新令牌而变成成功（错的
        // 还是那个口令），所以刷新是一次纯粹的浪费，而它轮换掉的 refresh token 还会
        // 让随后那次必然失败的重试把用户登出。
        if (isFormErrorBody(error.response?.data)) {
          return Promise.reject(error);
        }

        if (refreshToken && original && !original._retry) {
          original._retry = true;

          const newToken = await performRefresh();

          if (newToken) {
            original.headers.set('Authorization', `Bearer ${newToken}`);
            return instance(original);
          }
        }

        // 刷新失败或无 refreshToken，触发未授权处理
        if (onUnauthorized) {
          onUnauthorized();
        } else {
          window.dispatchEvent(new CustomEvent('onex-console:auth:unauthorized'));
        }

        return Promise.reject(error);
      }

      // ── 限流处理：429（频率）与 413（体量）─────────────────────────────────
      //
      // 不重试：能走到这里的请求已经撞上了某条上限，自动重放只会把「一次超限」
      // 放大成一串请求——正是限流要挡的东西。把文案换成可展示的一句，并把
      // Retry-After（后端给了才有）透出，由调用点决定提示还是倒计时。
      if (status !== undefined && isRateLimited(status)) {
        const code = rateLimitCode(error.response?.data);
        const info: RateLimitInfo = {
          code,
          status,
          message: rateLimitMessage(code, error.message),
          retryAfter: parseRetryAfter(error.response?.headers),
        };
        error.message = info.message;
        onRateLimited?.(info);
      }

      // ── HTTP 错误通知回调 ─────────────────────────────────────────────────
      if (status && onResponseError) {
        onResponseError(status, error.message, error.config);
      }

      // ── 全局错误处理 ──────────────────────────────────────────────────────
      onError?.(error);

      return Promise.reject(error);
    }
  );
}

// ─── createApiClientFromAppConfig ────────────────────────────────────────────

/**
 * 从 app.config 创建 API 客户端
 *
 * 自动处理 Token 和 401，与 sub-app-runtime 深度集成
 *
 * @param appConfig - 应用配置（app.config.tsx 导出的配置）
 * @returns API 客户端对象
 *
 * @example
 * ```ts
 * // api/index.ts
 * import { createApiClientFromAppConfig } from '@onex-console/api-client';
 * import appConfig from '../app.config';
 *
 * export const apiClient = createApiClientFromAppConfig(appConfig);
 * ```
 */
export function createApiClientFromAppConfig(appConfig: AppConfigForApi): ApiClient {
  const { name, auth, api } = appConfig;

  if (!api) {
    throw new Error(`[${name}] app.config 中缺少 api 配置`);
  }

  const {
    baseURL,
    timeout = 30000,
    headers,
    getToken,
    onUnauthorized,
    onError,
    onResponseError,
    refreshToken,
    tokenRefreshThreshold,
    tokenExemptPaths,
  } = api;

  // 创建 axios 实例
  const instance = axios.create({
    baseURL,
    timeout,
    headers: {
      'X-App-Name': name,
      ...headers,
    },
  });

  // 设置拦截器
  setupInterceptors(instance, {
    // 如果没有自定义 getToken，自动从 auth 配置推断（尊重 storage 类型）
    // 注意：token 存储键与 @onex-console/auth 保持一致（`<prefix>_access_token`）
    getToken:
      getToken ??
      (() => {
        const prefix = auth.storagePrefix ?? 'onex-console_auth';
        const key = `${prefix}_access_token`;
        // memory 存储是实例私有、外部不可读取，需调用方提供 getToken
        if (auth.storage === 'memory') {
          return null;
        }
        if (typeof window === 'undefined') {
          return null;
        }
        const storage =
          auth.storage === 'sessionStorage' ? window.sessionStorage : window.localStorage;
        return storage.getItem(key);
      }),
    onUnauthorized,
    onError,
    onResponseError,
    refreshToken,
    tokenRefreshThreshold,
    tokenExemptPaths,
  });

  return {
    instance,
    getConfig: () => api,
  };
}

// ─── createApiClient ──────────────────────────────────────────────────────────

/**
 * 创建 API 客户端实例（独立使用）
 *
 * @param config - API 配置
 * @returns API 客户端对象
 *
 * @example
 * ```ts
 * import { createApiClient } from '@onex-console/api-client';
 *
 * const { instance } = createApiClient({
 *   baseURL: '/api',
 *   getToken: () => localStorage.getItem('token'),
 *   onResponseError: (status, message) => notify.error(message),
 * });
 * ```
 */
export function createApiClient(config: ApiConfig): ApiClient {
  const {
    baseURL,
    timeout = 30000,
    headers,
    getToken,
    onUnauthorized,
    onError,
    onResponseError,
    refreshToken,
    tokenRefreshThreshold,
    tokenExemptPaths,
  } = config;

  // 创建 axios 实例
  const instance = axios.create({
    baseURL,
    timeout,
    headers,
  });

  // 设置拦截器
  setupInterceptors(instance, {
    getToken,
    onUnauthorized,
    onError,
    onResponseError,
    refreshToken,
    tokenRefreshThreshold,
    tokenExemptPaths,
  });

  return {
    instance,
    getConfig: () => config,
  };
}

// ============================================================================
// 向后兼容的导出（已废弃，将在未来版本移除）
// ============================================================================

/**
 * @deprecated 请使用 ApiConfig 代替
 */
export type ApiClientConfig = ApiConfig;

/**
 * @deprecated 请使用 setupInterceptors 代替
 */
export function setupAxiosInterceptors(
  instance: AxiosInstance,
  config: {
    getToken?: () => string | null | Promise<string | null>;
    onUnauthorized?: () => void;
    onError?: (error: AxiosError) => void;
  }
): void {
  setupInterceptors(instance, config);
}

/**
 * @deprecated 请使用 createApiClient 代替
 */
export function createAxiosInstance(config: ApiConfig): AxiosInstance {
  return createApiClient(config).instance;
}

/**
 * @deprecated 不再需要，API 配置已合并到 app.config
 */
export function defineApiConfig<T extends ApiConfig>(config: T): T {
  return config;
}

// ============================================================================
// SSE（流式请求）
// ============================================================================

/**
 * 流式端点的 fetch 助手。见 `./stream` 的模块注释：这类端点进不了契约，
 * 生成 CLI 会主动剔除它们，且 EventSource 不能带 Authorization 头。
 */
export { streamRequest, subscribeSse, parseSse, StreamRequestError } from './stream';
export type { SseEvent, StreamRequestOptions, SubscribeSseOptions } from './stream';
export { installHttpCache, DEFAULT_CACHE_TTL_MS, DEFAULT_FRESH_HEADER } from './http-cache';
export type { HttpCache, HttpCacheOptions } from './http-cache';
