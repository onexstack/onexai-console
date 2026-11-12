import { AccessKeyPanel } from '@/pages/Credentials/AccessKeyPanel';

/**
 * 账号页的「凭据管理」板块。
 *
 * 个人 AK/SK 只在这里出现（旧地址 `/credentials` 重定向到本页签）。面板由
 * `AccessKeyPanel` 提供；账号页已经由 `AccountPage` 提供 `.content` 滚动容器，
 * 不能再套一层 `ResourceShell`（会重复叠加 `--page-gutter` 与嵌套滚动）。
 */
export default function CredentialsView() {
  return <AccessKeyPanel />;
}
