import { Navigate, useParams } from 'react-router';

/**
 * 旧书签 `/authz-rules/:id` → `/policies/:id`。
 *
 * 策略页从「单表 + 弹窗」改成「左列表 + 右详情」后，具体策略的地址是
 * `/policies/:name`；旧链接如果只回到列表，书签就丢了用户原本要看的对象。
 */
export default function LegacyPolicyRedirect() {
  const { id = '' } = useParams<{ id: string }>();
  return <Navigate to={id ? `/policies/${encodeURIComponent(id)}` : '/policies'} replace />;
}
