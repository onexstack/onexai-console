import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react';
import { App as AntApp, ConfigProvider, Result, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter, Navigate, Outlet, Route, Routes } from 'react-router';

import { createThemeConfig } from '@/ui/theme';
import { queryClient, setQueryErrorNotifier } from '@/api/queryClient';
import { useSessionToken } from '@/auth/tokenStore';
import SessionGate from '@/components/SessionGate';
import { UserDirectoryProvider } from '@/components/UserRef';
import { DefaultLayout } from './DefaultLayout';
import { SearchRestorer } from './SearchRestorer';
import { AppConfigProvider } from './hooks';
import { setupStorageSync, setLocale, useLocale } from './store';
import { initThemeSync, useThemeState } from './theme';
import { changeLocale, setupLocaleSync } from './i18n';
import { getWujieRouteInfo, isInWujie } from './wujie';
import type { AppConfig, RouteConfig } from './types';

/**
 * 懒加载组件缓存。
 *
 * `app.config.tsx` 里 `component: () => import(...)` 是模块级稳定引用，
 * 以此缓存 lazy 组件，避免渲染期重复创建新的 lazy 类型导致 React 卸载重建
 * 页面、丢失组件状态。
 */
const lazyComponentCache = new Map<
  NonNullable<RouteConfig['component']>,
  LazyExoticComponent<ComponentType>
>();

function getLazyComponent(
  component: NonNullable<RouteConfig['component']>
): LazyExoticComponent<ComponentType> {
  let cached = lazyComponentCache.get(component);
  if (!cached) {
    cached = lazy(component);
    lazyComponentCache.set(component, cached);
  }
  return cached;
}

function PageLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spin size="large" />
    </div>
  );
}

function NotFound() {
  return <Result status="404" title="404" subTitle="这个页面不存在。" />;
}

/**
 * 把应用内路径拼成带 basename 的完整地址。
 *
 * `<Router basename>` 是先 `stripBasename` 再匹配的，`initialEntries` 若不带
 * 前缀就匹配不上，直接渲染 `null`（白屏 + 一条 warning）。
 */
function withBasename(basePath: string, subPath: string): string {
  if (!basePath) return subPath;
  return `${basePath}${subPath.startsWith('/') ? subPath : `/${subPath}`}`;
}

/** 渲染单条路由。 */
function renderRoute(route: RouteConfig): ReactNode {
  if (route.redirect) {
    return route.index ? (
      <Route key="index" index element={<Navigate to={route.redirect} replace />} />
    ) : (
      <Route
        key={route.path}
        path={route.path}
        element={<Navigate to={route.redirect} replace />}
      />
    );
  }

  if (!route.component) return null;

  const LazyComponent = getLazyComponent(route.component);
  const element = (
    <Suspense fallback={<PageLoading />}>
      <LazyComponent />
    </Suspense>
  );

  return route.children?.length ? (
    <Route key={route.path} path={route.path} element={element}>
      {route.children.map(renderRoute)}
    </Route>
  ) : (
    <Route key={route.path} path={route.path} element={element} />
  );
}

/**
 * 把 Query 的全局错误接到 antd 的 message 上。
 *
 * 必须在 `<AntApp>` 子树里：主题与持久的提示容器都在那一层。
 */
function QueryErrorBridge() {
  const { message } = AntApp.useApp();
  useEffect(() => {
    setQueryErrorNotifier(text => {
      void message.error(text);
    });
    return () => setQueryErrorNotifier(null);
  }, [message]);
  return null;
}

/**
 * 应用壳：Provider + 会话闸 + 路由。
 *
 * 不包含宿主身份（OneX 的 iam 令牌在这里没有意义）：本应用的会话由
 * `SessionGate` 守着，令牌是 onexai 签发的，见 `src/auth`。闸放在路由外层而不是
 * 每个页面里——新增页面不该依赖作者记得包一层。
 */
export function AppShell({ config }: { config: AppConfig }) {
  const inWujie = isInWujie();
  const { basePath, subPath } = getWujieRouteInfo();
  const locale = useLocale();
  const theme = useThemeState();

  // 主题：Wujie 内听宿主广播，独立运行时自己读本地偏好并与系统/其它标签页同步。
  useEffect(() => initThemeSync(), []);

  // 语言：本应用的 store 是唯一来源，切换时同步 i18next 与 <html lang>。
  useEffect(() => {
    void changeLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  // Wujie 内跟随宿主的语言切换。
  useEffect(() => {
    if (!inWujie) return;
    setupLocaleSync(setLocale);
  }, [inWujie]);

  // 其它标签页改了语言 / 折叠状态，这里跟着更新。
  useEffect(() => setupStorageSync(), []);

  // 令牌清空（登出或 401）时丢掉缓存：下一个账号不该看到上一个账号的数据。
  const token = useSessionToken();
  useEffect(() => {
    if (!token) queryClient.clear();
  }, [token]);

  const antdTheme = useMemo(
    () =>
      createThemeConfig({
        mode: theme.resolved,
        primaryColor: config.theme?.primaryColor,
        borderRadius: config.theme?.borderRadius,
        buttonBorderRadius: config.theme?.buttonBorderRadius,
      }),
    [
      theme.resolved,
      config.theme?.primaryColor,
      config.theme?.borderRadius,
      config.theme?.buttonBorderRadius,
    ]
  );

  const antdLocale = locale === 'en-US' ? enUS : zhCN;

  const routerProps = inWujie
    ? { basename: basePath || undefined, initialEntries: [withBasename(basePath, subPath)] }
    : { basename: config.base || undefined };

  const Router = inWujie ? MemoryRouter : BrowserRouter;

  return (
    <ConfigProvider locale={antdLocale} theme={antdTheme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <QueryErrorBridge />
          <AppConfigProvider value={config}>
            <SessionGate>
              <UserDirectoryProvider>
                <Router {...routerProps}>
                  <SearchRestorer>
                    <Routes>
                      <Route
                        path="/"
                        element={
                          <DefaultLayout>
                            <Outlet />
                          </DefaultLayout>
                        }
                      >
                        {config.routes.map(renderRoute)}
                        <Route path="*" element={<NotFound />} />
                      </Route>
                    </Routes>
                  </SearchRestorer>
                </Router>
              </UserDirectoryProvider>
            </SessionGate>
          </AppConfigProvider>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}

export default AppShell;
