/**
 * 限流（HTTP 429）的统一语义与文案。
 *
 * # 为什么单独成文件
 *
 * 后端的限流码属于 `ResourceExhausted.*` 一族（见 onex-rfcs/api/generic.md），
 * 每个码对应一句**给用户看**的话：验证码要等、登录试得太多次、操作太频繁、
 * 档位请求过多可升级、内容过大、今日额度用完明天再来。把这份映射集中一处，各调用点就不必各自
 * 硬编码文案，也不会出现「同一个 429 在两个页面说法不一致」。
 *
 * # 与 413 的关系
 *
 * 体量超限（`ResourceExhausted.RequestTooLarge`，HTTP 413）也走这里：它和 429
 * 一样是「这次请求本身没错，但你不该这么发」，只是量纲不同（大小 vs 频率）。
 * 让调用方只认一族码，比让它分别处理 429 和 413 两套逻辑更简单。
 */

/** 一次限流的语义化结果，交给 onRateLimited 回调。 */
export interface RateLimitInfo {
  /** 后端业务码，如 `ResourceExhausted.TooManyRequests`；识别不到时为空串。 */
  code: string;
  /** HTTP 状态码：429（限流）或 413（体量超限）。 */
  status: number;
  /** 可直接展示给用户的文案。 */
  message: string;
  /** 后端 `Retry-After`（秒），无则为 undefined。 */
  retryAfter?: number;
}

/**
 * 档位额度那句文案里的行动点，控制台把它渲染成可点的会员入口。
 *
 * 它与句子一起定义，因为控制台是按这个子串把整句切成「前文 + 链接 + 后文」的
 * （见 `AgentChat` 的 `quotaAlertTitle`）。两处各写一份的话，改文案的人只会改一处，
 * 链接就落不到任何字上——页面看起来只是少了个入口，不会报错。
 */
export const TIER_RATE_LIMITED_CTA = '升级会员';

/** 后端限流码 → 面向用户的文案。 */
const RATE_LIMIT_MESSAGES: Record<string, string> = {
  'ResourceExhausted.SMSRateLimited': '验证码发送过于频繁，请稍后再试',
  'ResourceExhausted.LoginRateLimited': '登录尝试过于频繁，请稍后再试',
  'ResourceExhausted.TooManyRequests': '操作过于频繁，请稍后再试',
  // 每日额度与「慢一点」不是一回事：等到明天才清零，所以文案必须说清是今天没额度了，
  // 否则用户会照着「稍后再试」一路重试到半夜。
  'ResourceExhausted.DailyQuotaExceeded': '今日次数已用完，明天再来',
  'ResourceExhausted.TierRateLimited': `非会员请求额度已经用完，${TIER_RATE_LIMITED_CTA}即可无限畅用`,
  // 平台 token 预算与档位额度不是一回事，所以文案也不能复用上面那句：升级会员
  // 提不动它，能提的是运营。写成「请升级会员」会让人买了会员再来撞一次同一堵墙；
  // 而「稍后再试」也对不上——预算要等到下一个周期才归零，不是过一会儿就行的。
  'ResourceExhausted.TokenBudgetExceeded': '本期 AI 用量额度已用尽，请联系运营调整',
  'ResourceExhausted.RequestTooLarge': '内容过大，请精简后重试',
};

/** 默认文案：识别不到具体码时使用。 */
export const RATE_LIMIT_FALLBACK_MESSAGE = '操作过于频繁，请稍后再试';

/**
 * rateLimitMessage 把后端业务码翻译成用户文案。
 *
 * @param code - 后端业务码，如 `ResourceExhausted.TooManyRequests`
 * @param fallback - 后端已给出的 message；为空时用默认文案
 */
export function rateLimitMessage(code: string, fallback?: string): string {
  if (code && RATE_LIMIT_MESSAGES[code]) return RATE_LIMIT_MESSAGES[code];
  // No platform code at all: the refusal came from the gateway, not a service.
  // Tyk answers a throttled request with `{"error":"API Rate limit exceeded"}`,
  // which carries no contract code and is English. Prefer the platform's own
  // sentence over echoing it.
  if (!code) return RATE_LIMIT_FALLBACK_MESSAGE;
  // A platform code this map does not know: the backend's own message is the
  // best available, and it is already user-facing.
  return fallback || RATE_LIMIT_FALLBACK_MESSAGE;
}

/** rateLimitCode 从响应体里读业务码，读不到返回空串。 */
export function rateLimitCode(data: unknown): string {
  if (data && typeof data === 'object' && 'code' in data) {
    const code = (data as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

/**
 * isRateLimited 判断一次响应是否属于限流族（429 或 413）。
 *
 * 413 归入这里，是因为它和 429 一样属于「改请求本身没用、要改发送方式」的
 * 失败。把它们分开会让每个调用点多一个几乎相同的分支。
 */
export function isRateLimited(status: number | undefined): boolean {
  return status === 429 || status === 413;
}

/** parseRetryAfter 从响应头里读 Retry-After 秒数，读不到返回 undefined。 */
export function parseRetryAfter(headers: unknown): number | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown>;
  const raw = record['retry-after'] ?? record['Retry-After'];
  const seconds = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
