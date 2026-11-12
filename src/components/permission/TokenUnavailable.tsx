import { Alert, Typography } from 'antd';

export const TOKEN_UNAVAILABLE_TEXT =
  '当前平台不支持用户 / 用户组级 Token；访问凭据由登录令牌与个人 AK/SK 提供。';

/**
 * 用户/用户组详情里的 Token 区块占位。
 *
 * onexai 没有 Polaris 那种「账号 Token 启停 / 重置」接口，这里明确说明不支持，
 * 而不是放一个点了没反应的假控件。
 */
export function TokenUnavailableNotice() {
  return (
    <Alert
      type="info"
      showIcon
      title="Token"
      description={TOKEN_UNAVAILABLE_TEXT}
      style={{ marginTop: 8 }}
    />
  );
}

/** 列表行「查看 Token」：用统一文案说明不可用。 */
export function openTokenUnavailable(
  modal: { info: (args: Record<string, unknown>) => void },
  subjectLabel: string
) {
  modal.info({
    title: `查看 ${subjectLabel} 的 Token`,
    content: <Typography.Text type="secondary">{TOKEN_UNAVAILABLE_TEXT}</Typography.Text>,
    okText: '知道了',
  });
}
