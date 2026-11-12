/**
 * Webhook 鉴权的表单值形状与拆分函数。
 *
 * 表单值是一个三选一的对象（不鉴权 / 填写令牌 / 引用 Secret），线上值却是两个
 * 平级字段：`secretRef` 与 write-only 的 `authToken`。转换只写在这里，表单模型
 * 与控件共用同一份规则。
 */

export type WebhookAuthMode = 'none' | 'token' | 'secret';

export interface WebhookAuthValue {
  mode?: WebhookAuthMode;
  /** 「引用 Secret」模式下选中的凭据 ID。 */
  secretRef?: string;
  /** 「填写令牌」模式下粘贴的明文；只在提交时离开浏览器。 */
  token?: string;
}

/** 编辑时由记录里的 `secretRef` 派生控件值。 */
export function authValueFromSecretRef(ref: unknown): WebhookAuthValue {
  const id = typeof ref === 'string' ? ref.trim() : '';
  return id ? { mode: 'secret', secretRef: id } : { mode: 'none' };
}

/**
 * 控件值 → 线上字段。
 *
 * 非当前模式显式不返回对应键，调用方再把它写成 undefined 的自有属性，编辑路径
 * 的 deepMerge 才能清掉记录里的旧值。令牌保留原样（不 trim），只把“全是空白”
 * 视为没填。
 */
export function splitWebhookAuth(value: unknown): { secretRef?: string; authToken?: string } {
  const draft = (value ?? {}) as WebhookAuthValue;
  if (draft.mode === 'token') {
    const token = typeof draft.token === 'string' ? draft.token : '';
    return token.trim() === '' ? {} : { authToken: token };
  }
  if (draft.mode === 'secret') {
    const ref = typeof draft.secretRef === 'string' ? draft.secretRef.trim() : '';
    return ref ? { secretRef: ref } : {};
  }
  return {};
}
