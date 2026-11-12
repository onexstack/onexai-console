import { Navigate, useLocation } from 'react-router';

/**
 * 旧地址 `/feishu-bindings` 的迁移落点。
 *
 * 飞书绑定现在是账号页的独立板块。保留这个路由是为了让书签、深链和已经打开
 * 的页面继续可用，并把 `?open=<open_id>` 一并带过去——旧链接打开的是某一条
 * 绑定，迁移后应当仍打开同一条。
 */
export default function FeishuBindingsRedirect() {
  const { search } = useLocation();
  const openID = new URLSearchParams(search).get('open');
  const target = `/account?tab=feishu${openID ? `&open=${encodeURIComponent(openID)}` : ''}`;
  return <Navigate to={target} replace />;
}
