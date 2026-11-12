import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { listUserGroups, type UserGroup } from '@/api/userGroups';
import { memberHasAny } from './members';
import { userAliasesOf, type UserRow } from '@/components/permission/authz';

/**
 * 全量用户组的共享读取。
 *
 * 组数量是组织规模级，不分页比在每一行/每个详情页发一次请求更省；缓存键与
 * 用户列表、成员关系抽屉保持一致，写完统一 invalidate 即可。
 */
export function useUserGroups(enabled = true) {
  const query = useQuery({
    queryKey: ['user-groups', 'all'],
    queryFn: () => listUserGroups({ offset: 0, limit: 0 }),
    enabled,
    staleTime: 30_000,
  });

  const groups = query.data?.items ?? [];
  return {
    groups,
    byName: new Map(groups.map(group => [group.name, group])),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** 某个账号所在的全部用户组（任一身份别名命中）。 */
export function groupsOfUser(user: UserRow | null | undefined, groups: UserGroup[]): UserGroup[] {
  if (!user) return [];
  const identities = userAliasesOf(user);
  return groups.filter(group => group.members.some(member => memberHasAny(member, identities)));
}

/**
 * 组名 → 可点击的详情链接。
 *
 * 解析不到时原样显示组名：策略可以引用一个刚被删除的组，页面不应因此报错。
 */
export function GroupRef({
  name,
  link = true,
  fallback,
}: {
  name: string;
  link?: boolean;
  fallback?: ReactNode;
}) {
  const { byName } = useUserGroups();
  const group = byName.get(name);
  const label = group?.displayName ? `${group.displayName}（${name}）` : name;
  if (!link) return <>{fallback ?? label}</>;
  return <Link to={`/user-groups/${encodeURIComponent(name)}`}>{label}</Link>;
}
