import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';

/**
 * 查询串持久化（从 onex-console 的 sub-app-runtime 抽取，行为一致）。
 *
 * 1. 用户离开某页时，把 URL 的 `?search` 存进 sessionStorage；
 * 2. 返回该页且 URL 无参数时，在浏览器 paint 前恢复（`useLayoutEffect`，无闪烁）；
 * 3. 首次直达带参数的 URL 不恢复（保留分享链接语义）；
 * 4. `REPLACE` 导航不恢复（防止用户主动清空搜索后又被写回）。
 */
const PREFIX = 'persisted-search:';

function storageKey(pathname: string): string {
  return `${PREFIX}${pathname}`;
}

function saveSearch(pathname: string, search: string): void {
  try {
    sessionStorage.setItem(storageKey(pathname), search);
  } catch {
    // sessionStorage 不可用或已满：跳过。
  }
}

function clearSearch(pathname: string): void {
  try {
    sessionStorage.removeItem(storageKey(pathname));
  } catch {
    // 同上。
  }
}

function getSearch(pathname: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(pathname));
  } catch {
    return null;
  }
}

export function SearchRestorer({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();

  const isFirstLoadRef = useRef(true);
  const prevPathnameRef = useRef(location.pathname);
  const prevSearchRef = useRef(location.search);

  useEffect(() => {
    if (!isFirstLoadRef.current) return;
    isFirstLoadRef.current = false;
    if (location.search) saveSearch(location.pathname, location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isFirstLoadRef.current) return;

    if (prevPathnameRef.current !== location.pathname) {
      if (prevSearchRef.current) {
        saveSearch(prevPathnameRef.current, prevSearchRef.current);
      }
      prevPathnameRef.current = location.pathname;
      prevSearchRef.current = location.search;
    } else if (location.search !== prevSearchRef.current) {
      prevSearchRef.current = location.search;
      if (location.search) {
        saveSearch(location.pathname, location.search);
      } else {
        clearSearch(location.pathname);
      }
    }
  }, [location.pathname, location.search]);

  useLayoutEffect(() => {
    if (isFirstLoadRef.current) return;
    if (navigationType === 'REPLACE') return;
    if (location.search) return;

    const saved = getSearch(location.pathname);
    if (saved) {
      navigate({ pathname: location.pathname, search: saved }, { replace: true });
    }
  }, [location.pathname, location.search, navigationType, navigate]);

  return <>{children}</>;
}
