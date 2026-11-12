import { useQuery } from '@tanstack/react-query';

import { fetchMe } from '@/api/auth';
import type { MeResponse } from '@/api/types';

/**
 * 当前登录账号（`GET /v1/auth/me`）。
 *
 * 令牌里的 `name` 只是签发时的快照，修改显示名后不会跟着变；需要展示身份的
 * 地方统一读这条查询。账号页、飞书绑定与调试台共用同一个 query key，React
 * Query 会去重，只发一次请求。
 */
export function useMe(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchMe,
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

/** 账号的可读名称：显示名优先，其次用户名；都没有时返回 undefined。 */
export function meDisplayName(me: MeResponse | undefined): string | undefined {
  const user = me?.user;
  if (!user) return undefined;
  return user.display_name?.trim() || user.username?.trim() || undefined;
}
