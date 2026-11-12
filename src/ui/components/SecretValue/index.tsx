import { useState } from 'react';
import { App, Button, message as staticMessage, Tooltip } from 'antd';
import { EyeInvisibleOutlined, EyeOutlined, LoadingOutlined } from '@ant-design/icons';

import { CopyButton } from '../CopyButton';
import styles from './styles.module.scss';

/**
 * 掩码宽度是固定的：取回明文之前前端并不知道它多长，按长度铺点等于把长度
 * 泄露出去——而那也是一个它还没有的值。
 */
const MASK = '•'.repeat(24);

/**
 * 服务端存储模型密钥时的密文前缀（AES-GCM，见后端 `SealAPIKey`）。
 *
 * 它只能由服务端解开，对前端来说不是一个可用的明文。旧版服务端会把存储值
 * 当成一次性密钥回显，这里统一兜底，避免把 `enc:v1:...` 画成密钥。
 */
const SEALED_PREFIX = 'enc:v1:';

/** 取回值 → 可展示明文。空串与密文都表示「拿不到明文」。 */
function plaintextOf(value: string): string {
  return value.startsWith(SEALED_PREFIX) ? '' : value;
}

export interface SecretValueProps {
  /** 用于无障碍名：「查看 API Key」「复制 SecretKey」。 */
  label: string;
  /**
   * 取回明文。只在第一次点「查看」时调用；结果只留在这个组件的内存里，
   * 不写 localStorage，也不进 react-query 缓存。
   *
   * 已经通过 `initialPlaintext` 拿到值时可以不传。
   */
  load?: () => Promise<string>;
  /** 这条记录是否真的有一个值（如模型的 `hasAPIKey`）。false 时显示「未配置」。 */
  present?: boolean;
  /** 当前用户是否可查看（归属人 / 管理员）；false 时显示「不可查看」。 */
  permitted?: boolean;
  /** 刚创建出来的明文：直接展示，不再请求。 */
  initialPlaintext?: string;
  /**
   * 初始是否展开明文。默认 true，与 `initialPlaintext` 一起表示「刚创建，直接
   * 展示」；一次性密钥弹窗传 false，让用户点眼睛再显示。
   */
  initialVisible?: boolean;
  /** 服务端返回空串时的解释。 */
  unavailableHint?: string;
  /** 无权限查看时的解释。 */
  restrictedHint?: string;
}

/**
 * 密钥类字段的展示：默认掩码，点眼睛才向服务端取一次明文，取回后可复制。
 *
 * 这是全站唯一实现——`/account?tab=credentials` 的 SecretKey、资源详情页的
 * 模型 API Key / 服务凭据，以及创建成功后的「请立即保存这个密钥」弹窗共用它，
 * 「掩码 + 眼睛 + 复制」不会在多个页面里各长一遍。
 *
 * # 五种「没有明文」要分开
 *
 * 1. `present === false`：这条记录根本没有密钥 → 「未配置」；
 * 2. `permitted === false`：当前用户无权查看 → 「不可查看」（带原因）；
 * 3. 请求中 → 「读取中…」，不是空白；
 * 4. 服务端返回空串 → 「不可查看」：明文还原不出来是服务端的真实答案，不是还没取到；
 * 5. 拿到 `enc:v1:` 存储密文 → 按空串处理：它不是可用的明文（见 `SEALED_PREFIX`）。
 *
 * 请求失败（网络 / 403 / 404）不写进 `secret`：保持可重试，不能伪装成「不可查看」。
 */
export function SecretValue({
  label,
  load,
  present = true,
  permitted = true,
  initialPlaintext,
  initialVisible = true,
  unavailableHint,
  restrictedHint,
}: SecretValueProps) {
  const { message } = App.useApp();
  const notify = typeof message?.error === 'function' ? message : staticMessage;

  /** 已取回的明文；`null` 表示还没取，`''` 是服务端的「无法还原」。 */
  const [secret, setSecret] = useState<string | null>(
    initialPlaintext === undefined ? null : plaintextOf(initialPlaintext)
  );
  const [visible, setVisible] = useState(
    Boolean(initialPlaintext && plaintextOf(initialPlaintext)) && initialVisible
  );
  const [loading, setLoading] = useState(false);

  if (!present) {
    return <span className={styles.hint}>未配置</span>;
  }

  if (!permitted) {
    return (
      <Tooltip title={restrictedHint ?? '只有资源归属人或管理员可以查看这个密钥。'}>
        <span className={styles.hint} tabIndex={0}>
          不可查看
        </span>
      </Tooltip>
    );
  }

  if (loading) {
    return (
      <span className={styles.row} role="status">
        <LoadingOutlined />
        <span className={styles.hint}>读取中…</span>
      </span>
    );
  }

  if (secret === '') {
    return (
      <Tooltip title={unavailableHint ?? '服务端没有返回这个密钥的明文。它仍然有效。'}>
        <span className={styles.hint} tabIndex={0}>
          不可查看
        </span>
      </Tooltip>
    );
  }

  const shown = secret !== null && visible;

  const toggle = async () => {
    if (shown) {
      setVisible(false);
      return;
    }
    // 取回过的明文留在内存里，再点不重复请求。
    if (secret !== null) {
      setVisible(true);
      return;
    }
    // 调用方给了 initialPlaintext（一次性密钥）就不会走到这里；没有加载器时
    // 保持掩码，而不是发起一个不存在的请求。
    if (!load) return;
    setLoading(true);
    try {
      const next = plaintextOf(await load());
      setSecret(next);
      // 空串是服务端的答案，画成「不可查看」，不做成一次失败的请求。
      if (next !== '') setVisible(true);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : '读取密钥失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className={styles.row}>
      <span className={styles.mask}>{shown ? (secret ?? '') : MASK}</span>
      {shown && <CopyButton value={secret} ariaLabel={`复制 ${label}`} />}
      <Tooltip title={shown ? '隐藏' : '查看'}>
        <Button
          type="text"
          size="small"
          aria-label={shown ? `隐藏 ${label}` : `查看 ${label}`}
          icon={shown ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={() => void toggle()}
        />
      </Tooltip>
    </span>
  );
}
