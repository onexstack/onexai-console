/**
 * OneX 智能平台应用入口。
 *
 * 业务配置在 `app.config.tsx`；运行时的实现（布局 / 路由 / 主题 / i18n）在
 * `src/runtime`，组件与 design tokens 在 `src/ui`。
 */
import { applyDevSessionToken } from '@/auth/devSession';
import { createApp } from '@/runtime';

import config from './app.config';
// 设计令牌（`:root` 与 `[data-theme='dark']` 两套 CSS 自定义属性）。
// 必须早于组件样式：组件 SCSS 里的 `var(--color-*)` 依赖它。
import './ui/styles/tokens.scss';
import './styles/index.scss';

// 必须在 createApp 之前：SessionGate 在首次渲染时就要看到令牌。
// 未开启 `DEV_BYPASS_LOGIN` 时是空操作。
applyDevSessionToken();

createApp(config);
