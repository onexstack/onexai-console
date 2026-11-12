import { Input, Segmented, Select } from 'antd';

import { useResourceOptions } from '@/components/ResourceForm/options';

import styles from './styles.module.scss';
import type { WebhookAuthMode, WebhookAuthValue } from './value';

export type { WebhookAuthMode, WebhookAuthValue } from './value';

/**
 * Webhook 的鉴权配置控件。
 *
 * 三种模式：
 * - 不鉴权：回调不带 `X-Onexai-Token`；
 * - 填写令牌：直接粘贴字符串，服务端写入凭据存储后只保留 `secretRef`，明文
 *   不回显；
 * - 引用 Secret：从已有凭据中选择（管理员专属接口，所以只在选中该模式时挂载
 *   选择器，避免普通用户在另外两种模式下也吃一个 403）。
 */

export interface WebhookAuthFormProps {
  id?: string;
  value?: WebhookAuthValue;
  onChange?: (value: WebhookAuthValue) => void;
  disabled?: boolean;
}

const MODE_OPTIONS: Array<{ label: string; value: WebhookAuthMode }> = [
  { label: '不鉴权', value: 'none' },
  { label: '填写令牌', value: 'token' },
  { label: '引用 Secret', value: 'secret' },
];

export default function WebhookAuthForm({
  id,
  value,
  onChange,
  disabled,
}: WebhookAuthFormProps) {
  const draft: WebhookAuthValue = value ?? { mode: 'none' };

  const setMode = (mode: WebhookAuthMode) => {
    onChange?.({
      ...draft,
      mode,
      // 离开「填写令牌」就丢掉明文，避免它长期留在 Form store 里。
      token: mode === 'token' ? draft.token : undefined,
    });
  };

  return (
    <div className={styles.wrap} id={id}>
      <Segmented<WebhookAuthMode>
        disabled={disabled}
        value={draft.mode ?? 'none'}
        onChange={setMode}
        options={MODE_OPTIONS}
      />

      {draft.mode === 'token' && (
        <div className={styles.field}>
          <Input.Password
            disabled={disabled}
            autoComplete="new-password"
            maxLength={8192}
            value={draft.token ?? ''}
            placeholder="粘贴令牌字符串"
            onChange={event => onChange?.({ ...draft, mode: 'token', token: event.target.value })}
          />
          <div className={styles.hint}>保存后写入凭据存储，Webhook 只保留引用，不再回显明文。</div>
        </div>
      )}

      {draft.mode === 'secret' && <SecretPicker draft={draft} disabled={disabled} onChange={onChange} />}

      {draft.mode === 'none' && (
        <div className={styles.hint}>回调请求不带 X-Onexai-Token 鉴权头。</div>
      )}
    </div>
  );
}

/**
 * Secret 选择器单独成组件：`useResourceOptions` 会请求管理员专属的凭据列表，
 * 只在用户真的切到「引用 Secret」时才应该发这个请求。
 */
function SecretPicker({
  draft,
  disabled,
  onChange,
}: {
  draft: WebhookAuthValue;
  disabled?: boolean;
  onChange?: (value: WebhookAuthValue) => void;
}) {
  const { options, loading } = useResourceOptions({ resourceKey: 'secrets' });
  return (
    <div className={styles.field}>
      <Select
        disabled={disabled}
        allowClear
        showSearch
        loading={loading}
        options={options}
        value={draft.secretRef}
        placeholder="从已有凭据中选择"
        onChange={(next: string | undefined) =>
          onChange?.({ ...draft, mode: 'secret', secretRef: next || undefined })
        }
      />
      <div className={styles.hint}>平台托管的 Webhook 令牌不会出现在这个列表里。</div>
    </div>
  );
}
