import { FeishuBindingsPanel } from '@/pages/FeishuBindings/FeishuBindingsPanel';

/**
 * 账号页的「飞书绑定」板块。
 *
 * 顶部「我的飞书」卡负责账号级绑定 / 解绑，下方列表管理飞书身份与 `@peer`
 * 可用智能体；两者都由 `FeishuBindingsPanel` 组织。`AccountPage` 已经提供
 * `.content` 滚动容器，不能再套一层 `ResourceShell`（会重复叠加
 * `--page-gutter` 与嵌套滚动）。
 */
export default function FeishuBindingsView() {
  return <FeishuBindingsPanel />;
}
