import { useMemo, useRef } from 'react';
import { useLocation } from 'react-router';
import { Button, Result } from 'antd';
import { ResourcePage, type ResourceListFilters } from '@/ui';
import { useLinkHandler, useNamespace, useTranslation } from '@/runtime';

import NamespaceSelect from '@/components/NamespaceSelect';
import { DESCRIPTOR_BY_KEY, RESOURCE_BY_KEY } from '@/api/resources';
import { rowActions } from '@/api/catalog/extras';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';

/**
 * 通用列表页。
 *
 * 路径的第一段是资源键（`/skills`、`/oncall-groups`…）。所有资源都是平铺路由，
 * 所以「第一段 = 资源键」成立；页面只负责取描述符、放操作和标题。
 */
export default function ResourceListPage() {
  const location = useLocation();
  const link = useLinkHandler();
  const { t } = useTranslation();
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  const key = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const detailPath = (id: string) => `/${key}/${encodeURIComponent(id)}`;
  const spec = RESOURCE_BY_KEY[key];
  const descriptor = DESCRIPTOR_BY_KEY[key];

  // 是否支持按业务空间浏览：以资源描述符里有没有 namespace 字段为准。
  // 12 个带该字段的资源共用同一套列表外壳，因此选择器位置天然一致。
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const writable = Boolean(spec?.binding.writable && (!spec.adminOnlyWrite || claims?.isAdmin));

  const namespace = useNamespace();
  const namespaceScoped = Boolean(spec?.fields.some(field => field.key === 'namespace'));
  const scopeFilters = useMemo((): ResourceListFilters | undefined => {
    if (!namespaceScoped || !namespace) return undefined;
    return { namespace: [namespace] };
  }, [namespaceScoped, namespace]);

  if (!spec || !descriptor) {
    return <Result status="404" title="未知资源" subTitle={`这个应用里没有「${key}」这一页。`} />;
  }

  return (
    <ResourcePage
      key={key}
      t={t}
      resource={descriptor}
      canWrite={writable}
      showTitle
      idHref={detailPath}
      onClickId={(id, _row, e) => void link(detailPath(id), e)}
      scopeSelector={namespaceScoped ? <NamespaceSelect /> : undefined}
      scopeFilters={scopeFilters}
      scopeKey={namespaceScoped ? namespace : undefined}
      leadingActions={
        writable
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
          },
        })
      }
    />
  );
}
