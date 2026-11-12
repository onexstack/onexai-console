import { useSyncExternalStore } from 'react';

/**
 * 令牌存储：本应用会话的唯一真相源。
 *
 * # 为什么它自己持有订阅者
 *
 * 令牌有三种变化途径——登录写入、登出清除、以及 401 之后被客户端清掉——而它们
 * 发生在不同的模块里。如果存储只管读写、广播另找一处，那么「401 清掉了令牌」就
 * 没人通知界面，用户会停在页面上反复看到同一个失败。让存储自己广播，就没有
 * 「哪条路径忘了通知」这个问题：一次写入或清除，一次广播。
 *
 * 依赖方向因此是单向的：`api/client.ts` 从这里读令牌，`auth/session.ts` 从这里
 * 写令牌，谁都不需要反过来 import。
 */

/**
 * 存储键。用本应用自己的前缀：OneX 宿主会往它自己的键写 iam 令牌，两者不能
 * 互相冒充，也不该互相覆盖。即使同域部署，键名也彼此独立。
 */
const TOKEN_KEY = 'onexai-console_onexai_token';

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前令牌；`null` 表示没有会话。 */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** 写入令牌并广播（登录）。 */
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  emit();
}

/** 清除令牌并广播（登出，或 401 之后由客户端调用）。 */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  emit();
}

/** 组件订阅会话状态。快照是一个字符串，因此天然稳定。 */
export function useSessionToken(): string | null {
  return useSyncExternalStore(subscribe, getToken, getToken);
}
