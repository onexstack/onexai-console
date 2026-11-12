import type { ReactNode } from 'react';
import {
  IdcardOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
} from '@ant-design/icons';

/**
 * 账号页的板块元数据。
 *
 * 板块由 URL 的 `?tab=` 决定，默认「基本信息」；未知值也回落到基本信息，
 * 避免手改地址栏时出现空白页。
 */
export type AccountTabKey = 'info' | 'security' | 'credentials' | 'feishu';

export interface AccountSectionMeta {
  key: AccountTabKey;
  title: string;
  icon: ReactNode;
}

export const ACCOUNT_SECTIONS: AccountSectionMeta[] = [
  { key: 'info', title: '基本信息', icon: <IdcardOutlined /> },
  { key: 'security', title: '安全设置', icon: <SafetyOutlined /> },
  { key: 'credentials', title: '凭据管理', icon: <SafetyCertificateOutlined /> },
  { key: 'feishu', title: '飞书绑定', icon: <LinkOutlined /> },
];

export const DEFAULT_ACCOUNT_TAB: AccountTabKey = 'info';

export function parseAccountTab(raw: string | null | undefined): AccountTabKey {
  return raw === 'security' || raw === 'credentials' || raw === 'feishu'
    ? raw
    : DEFAULT_ACCOUNT_TAB;
}
