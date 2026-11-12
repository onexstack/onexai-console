import { useMemo, useRef } from 'react';
import { useLocation } from 'react-router';
import { Button, Result, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';

import { ScheduleUserName } from '@/components/UserRef';
import { ResourcePage, type ProTableColumn, type ResourceListFilters } from '@/ui';
import { useLinkHandler, useNamespace, useTranslation } from '@/runtime';
import NamespaceSelect from '@/components/NamespaceSelect';
import { DESCRIPTOR_BY_KEY, RESOURCE_BY_KEY } from '@/api/resources';
import { rowActions } from '@/api/catalog/extras';
import { listCurrent } from '@/api/oncall';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import type { OncallCurrentResponse } from '@/api/types';
import { formatInZone } from '@/components/oncall/time';

/**
 * 值班组列表。
 *
 * 复用通用列表的搜索、分页、移动端卡片与删除；额外两列来自 /v1/oncall-current
 * 的批量求值（当前值班人、下一次交接）。列表接口本身仍只返回组元数据。
 */
export default function OncallGroupListPage() {
  const location = useLocation();
  const link = useLinkHandler();
  const { t } = useTranslation();
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  const key = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const detailPath = (id: string) => `/${key}/${encodeURIComponent(id)}`;
  const spec = RESOURCE_BY_KEY[key];
  const base = DESCRIPTOR_BY_KEY[key];
  const token = useSessionToken();
  const isAdmin = useMemo(() => Boolean(decodeClaims(token)?.isAdmin), [token]);

  const namespace = useNamespace();
  const namespaceScoped = Boolean(spec?.fields.some(field => field.key === 'namespace'));
  const scopeFilters = useMemo((): ResourceListFilters | undefined => {
    if (!namespaceScoped || !namespace) return undefined;
    return { namespace: [namespace] };
  }, [namespaceScoped, namespace]);

  const currentQuery = useQuery({
    queryKey: ['oncall', 'current', 'all'],
    queryFn: () => listCurrent(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const currentByName = useMemo(() => {
    const map = new Map<string, OncallCurrentResponse>();
    for (const item of currentQuery.data?.items ?? []) {
      map.set(item.group, item);
    }
    return map;
  }, [currentQuery.data]);

  const descriptor = useMemo(() => {
    if (!base) return undefined;
    const currentColumn: ProTableColumn<Record<string, unknown>> = {
      title: '当前值班',
      key: 'oncallCurrent',
      render: (_value, record) => {
        const current = currentByName.get(String(record.name ?? ''));
        const member = current?.current;
        if (!member) {
          return (
            <Typography.Text type="secondary">
              {current?.source === 'regen' ? 'Regen 旧排班' : '未配置'}
            </Typography.Text>
          );
        }
        return (
          <>
            <Typography.Text>
              <ScheduleUserName value={member.userName} />
            </Typography.Text>
            {member.isOverride ? (
              <Tag bordered={false} color="purple" style={{ marginInlineStart: 6 }}>
                代班
              </Tag>
            ) : null}
            {member.until ? (
              <Typography.Text type="secondary" style={{ marginInlineStart: 6, fontSize: 12 }}>
                至 {formatInZone(member.until, current?.timezone || 'UTC', 'MM-DD HH:mm')}
              </Typography.Text>
            ) : null}
          </>
        );
      },
    };
    const nextColumn: ProTableColumn<Record<string, unknown>> = {
      title: '下一次交接',
      key: 'oncallNextChange',
      render: (_value, record) => {
        const current = currentByName.get(String(record.name ?? ''));
        if (!current?.current?.until) return '-';
        return formatInZone(current.current.until, current.timezone || 'UTC', 'YYYY-MM-DD HH:mm');
      },
    };
    return {
      ...base,
      deletable: isAdmin,
      extraColumns: [...(base.extraColumns ?? []), currentColumn, nextColumn],
    };
  }, [base, currentByName, isAdmin]);

  if (!spec || !descriptor) {
    return <Result status="404" title="未知资源" subTitle={`这个应用里没有「${key}」这一页。`} />;
  }

  return (
    <ResourcePage
      key={key}
      t={t}
      resource={descriptor}
      // 值班组「读对登录用户开放、写要求管理员」，列表里的状态开关必须一起收窄。
      canWrite={isAdmin}
      showTitle
      idHref={detailPath}
      onClickId={(id, _row, e) => void link(detailPath(id), e)}
      scopeSelector={namespaceScoped ? <NamespaceSelect /> : undefined}
      scopeFilters={scopeFilters}
      scopeKey={namespaceScoped ? namespace : undefined}
      leadingActions={
        spec.binding.writable && isAdmin
          ? () => (
              <Button type="primary" onClick={event => void link(`/${key}/new`, event)}>
                新建
              </Button>
            )
          : undefined
      }
      onReady={api => {
        refreshRef.current = api.refresh;
      }}
      rowActions={item =>
        rowActions(key, {
          id: String(item[spec.idKey] ?? ''),
          record: item,
          refresh: () => {
            void refreshRef.current?.();
            void currentQuery.refetch();
          },
        })
      }
    />
  );
}
