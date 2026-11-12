import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from './client';

/**
 * 全局查询客户端。
 *
 * - 4xx 不重试（401/403/404 重试只会让用户多等一次同样的失败）；
 * - 网络错误、5xx、429 最多重试 2 次；
 * - 错误提示通过一个由 AppShell 注册的桥接函数交给 antd `App.useApp()`——
 *   模块级拿不到 antd 的上下文，直接调静态 `message` 又会丢掉主题。
 */

let notify: ((message: string) => void) | null = null;

/** 由 AppShell 在 `<AntApp>` 内注册；卸载时传 null。 */
export function setQueryErrorNotifier(fn: ((message: string) => void) | null): void {
  notify = fn;
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  const status = error.status;
  if (status === undefined) return true; // 网络错误
  if (status === 429) return true;
  return status >= 500;
}

function report(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) return; // 会话闸会处理
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : '请求失败';
  notify?.(message);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => count < 2 && isRetryable(error),
    },
    mutations: { retry: 0 },
  },
  queryCache: new QueryCache({
    // `meta.silent` 用于「失败是预期内的」页面块（如首页对非管理员隐藏的统计）：
    // 它们自己渲染降级文案，不需要再弹一次全局错误。
    onError: (error, query) => {
      if (query.meta?.['silent']) return;
      report(error);
    },
  }),
  mutationCache: new MutationCache({ onError: report }),
});
