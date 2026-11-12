import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listPolicies } from '@/api/policies';
import { deriveUsableResources, matchPolicies, type PolicyMatch, type SubjectScope } from './authz';

/**
 * 某个主体的策略视图。
 *
 * 只拉一次全量策略（`limit: 0`），用户/用户组详情与策略页共用同一份缓存，
 * 避免按每个身份别名发一次请求。服务端本身就要把全量规则物化给 OPA，所以
 * 这里的读取成本与逐条查询不同量级。
 */
export function useSubjectPolicies(scope: SubjectScope, enabled = true) {
  const query = useQuery({
    queryKey: ['policies', 'all'],
    queryFn: () => listPolicies({ offset: 0, limit: 0 }),
    enabled,
    staleTime: 30_000,
  });

  // scope 每次渲染都是新对象；用内容做依赖，避免无意义的 useMemo 失效。
  const aliasKey = (scope.aliases ?? []).slice().sort().join('\u0000');
  const groupKey = [...(scope.groupNames ?? []), ...(scope.groupName ? [scope.groupName] : [])]
    .filter(Boolean)
    .sort()
    .join('\u0000');

  const matches = useMemo<PolicyMatch[]>(() => {
    const policies = query.data?.items ?? [];
    return matchPolicies(policies, {
      aliases: aliasKey ? aliasKey.split('\u0000') : [],
      groupNames: groupKey ? groupKey.split('\u0000') : [],
    });
  }, [query.data?.items, aliasKey, groupKey]);

  const usableResources = useMemo(() => deriveUsableResources(matches), [matches]);

  return {
    policies: query.data?.items ?? [],
    matches,
    direct: matches.filter(match => match.source === 'direct'),
    viaGroups: matches.filter(match => match.source === 'group'),
    wildcard: matches.filter(match => match.source === 'wildcard'),
    usableResources,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
