import { createContext, useCallback, useContext } from 'react';
import { useLocation, useNavigate, type NavigateOptions } from 'react-router';

import { openInNewTabIfModified, type LinkClickEvent } from '@/lib/link';
import { getWujieRouteInfo, isInWujie } from './wujie';
import type { AppConfig } from './types';

// ─── 应用配置 ────────────────────────────────────────────────────────────────

const AppConfigContext = createContext<AppConfig | null>(null);

export const AppConfigProvider = AppConfigContext.Provider;

/** 读取应用配置；必须在 Provider 内使用。 */
export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext);
  if (!config) {
    throw new Error('useAppConfig 必须在 <AppConfigProvider> 内使用');
  }
  return config;
}

/** 安全形态：没有 Provider 时返回 null（供可能脱离树使用的工具 hook）。 */
export function useAppConfigSafe(): AppConfig | null {
  return useContext(AppConfigContext);
}

// ─── 返回上一页 ──────────────────────────────────────────────────────────────

/**
 * 安全的「返回上一页」：站内有上一条就退回去，没有（新标签页、外链、直达、
 * 刷新落地）才落到 `fallback`。
 *
 * 判据是 React Router 写在 `history.state.idx` 里的下标：初始记录恒为 0、
 * 站内每次 push 递增。`idx > 0` 才说明确实有站内的上一条可退——裸
 * `navigate(-1)` 在深链场景会静默失败停在原地、甚至把用户带离本站。
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();

  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
      return;
    }
    // replace：用 fallback 顶掉这条孤立的详情页记录，避免它留在栈里再被
    // 「前进」撞见一次。
    navigate(fallback, { replace: true });
  }, [fallback, navigate]);
}

// ─── 带修饰键的点击 ──────────────────────────────────────────────────────────

/**
 * 一次「去某处」的点击：普通左键走 SPA 内跳转，⌘/Ctrl/中键开新标签页、
 * Shift 开新窗口。返回 `true` 表示已经开过新标签，调用方不要再跳。
 *
 * # 为什么修饰键要自己处理
 *
 * 在 Wujie 沙箱里，浏览器照着 `<a>` 的 `href` 走是错的——Wujie 会把子应用写下
 * 的 `href` 绝对化到子应用自己的 origin（本机 dev 是另一个端口），而真正要打开
 * 的页面在宿主的 `/app/<名字>/…` 下。所以这里一律自己 `window.open` 拼宿主地址
 * （`hostOrigin + basePath`），并且必须先 `preventDefault`。
 *
 * 独立运行（含 iframe）时 `basePath`/`hostOrigin` 为空，但部署前缀 `config.base`
 * 还在：不带上它，⌘/Ctrl+点击会拼出域根下的同名路径。
 */
export type LinkHandler = (to: string, e: LinkClickEvent, options?: NavigateOptions) => boolean;

export function useLinkHandler(): LinkHandler {
  const navigate = useNavigate();
  const location = useLocation();
  const { basePath, hostOrigin } = getWujieRouteInfo();
  const base = useAppConfigSafe()?.base ?? '';
  const inWujie = isInWujie();

  return useCallback(
    (to: string, e: LinkClickEvent, options?: NavigateOptions) => {
      // 只带查询串的 `to`（`?tab=x`）要挂在当前路径后面才算得出完整地址。
      const queryOnly = to.startsWith('?');
      const full = queryOnly ? location.pathname + to : to;
      const absolute = inWujie
        ? `${hostOrigin}${basePath}${full}`
        : `${window.location.origin}${queryOnly ? '' : base}${full}`;
      if (openInNewTabIfModified(e, absolute)) return true;
      e.preventDefault?.();
      navigate(to, options);
      return false;
    },
    [navigate, location.pathname, basePath, hostOrigin, base, inWujie]
  );
}
