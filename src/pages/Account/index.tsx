import { useSearchParams } from 'react-router';
import { Alert, Button, Skeleton } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import clsx from 'clsx';

import { useMe } from '@/auth/useMe';

import CredentialsView from './CredentialsView';
import FeishuBindingsView from './FeishuBindingsView';
import InfoView from './InfoView';
import SecurityView from './SecurityView';
import { ACCOUNT_SECTIONS, parseAccountTab, type AccountTabKey } from './sections';
import styles from './styles.module.scss';

/**
 * 账号设置。
 *
 * 版式对齐 onex-console 的账号中心：左侧「账号管理」导航 + 右侧卡片，当前板块由
 * URL 的 `?tab=` 决定。根节点标 `data-page-surface="flush"`，水平内缩只由
 * `--page-gutter` 提供，保持与其它整页一致的左边缘。
 *
 * 账号数据在这里拉一次，「基本信息」「安全设置」共用同一份 `['auth','me']`
 * 查询；「凭据管理」走 `/v1/aksk`；「飞书绑定」用 `/v1/feishu-bindings`
 * 与同一份 `['auth','me']`（面板内同 key 查询由 React Query 去重），都只认
 * 令牌里的用户。
 */
export default function AccountPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseAccountTab(searchParams.get('tab'));

  const meQuery = useMe();
  const me = meQuery.data;

  const selectTab = (key: AccountTabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    // `open` 只在飞书绑定板块里有意义；离开时清掉，避免下次回来抽屉自己弹开。
    if (key !== 'feishu') next.delete('open');
    setSearchParams(next);
  };

  return (
    <div className={styles.page} data-page-surface="flush">
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTitle}>账号管理</div>
        <nav className={styles.sidebarNav} aria-label="账号管理">
          {ACCOUNT_SECTIONS.map(item => (
            <button
              key={item.key}
              type="button"
              className={clsx(
                styles.sidebarItem,
                activeTab === item.key && styles.sidebarItemActive
              )}
              aria-current={activeTab === item.key ? 'page' : undefined}
              onClick={() => selectTab(item.key)}
            >
              <span className={styles.sidebarIcon}>{item.icon}</span>
              <span>{item.title}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className={styles.content}>
        {/* 凭据与飞书绑定只认令牌里的用户，不依赖 `/v1/auth/me`：账号信息读失败时它们仍然可用。 */}
        {activeTab === 'credentials' ? (
          <CredentialsView />
        ) : activeTab === 'feishu' ? (
          <FeishuBindingsView />
        ) : meQuery.isLoading ? (
          <Skeleton active avatar paragraph={{ rows: 8 }} />
        ) : meQuery.isError || !me ? (
          <Alert
            type="error"
            showIcon
            title="读取账号信息失败"
            description={meQuery.error instanceof Error ? meQuery.error.message : undefined}
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void meQuery.refetch()}>
                重试
              </Button>
            }
          />
        ) : activeTab === 'info' ? (
          <InfoView me={me} />
        ) : (
          <SecurityView me={me} />
        )}
      </main>
    </div>
  );
}
