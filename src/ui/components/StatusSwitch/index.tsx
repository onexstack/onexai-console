import { useState } from 'react';
import type { ReactNode } from 'react';
import { Popconfirm, Switch } from 'antd';
import type { ButtonProps } from 'antd';

import styles from './styles.module.scss';

/**
 * 状态开关的取值映射。
 *
 * 平台里有两类「开关」字段：
 * - 真正的布尔字段（`paused`、`enabled`）：开 = `true`，关 = `false`；
 * - 枚举状态字段（`status`）：开 = `enabled`，关 = `disabled`，空值按业务默认。
 *
 * 映射放在这里，列表、详情、表单三处才对同一份值给出同一个答案。
 */
export interface SwitchMapping {
  onValue?: string | boolean;
  offValue?: string | boolean;
  /** 空值（后端未设置）时是否视为「开」；状态字段默认开。 */
  defaultOn?: boolean;
}

/** 当前值是否处于「开」。没有映射时按布尔值判断。 */
export function isSwitchOn(mapping: SwitchMapping | undefined, value: unknown): boolean {
  if (!mapping || (mapping.onValue === undefined && mapping.offValue === undefined)) {
    return Boolean(value);
  }
  if (value === undefined || value === null || value === '') {
    return Boolean(mapping.defaultOn);
  }
  return value === mapping.onValue;
}

/** 切换前的二次确认文案。 */
export interface StatusSwitchConfirm {
  title: ReactNode;
  description?: ReactNode;
  okText?: ReactNode;
  cancelText?: ReactNode;
  /** 「停用」这类敏感动作可以传 `{ danger: true }`。 */
  okButtonProps?: ButtonProps;
}

export interface StatusSwitchProps {
  checked: boolean;
  /** 开 / 关两侧的文案；都给空时只画开关。 */
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
  size?: 'small' | 'default';
  /**
   * 切换回调。
   *
   * 返回 Promise 时组件进入 loading，直到调用方完成服务端写入与刷新；
   * 错误提示由调用方负责（它才知道失败原因）。
   */
  onChange?: (checked: boolean) => void | Promise<void>;
  /**
   * 切换前先弹确认。
   *
   * 确认框包在**组件内部的 span** 上，而不是由调用方包住 `<StatusSwitch>`：
   * antd 的 Popconfirm 需要能拿到子元素 ref 来定位浮层，而函数组件没有
   * forwardRef；包在内部既避免 ref 告警，也让列表表格和移动端卡片共用同一套交互。
   */
  confirm?: StatusSwitchConfirm;
}

/** 状态开关：带可选二次确认的 antd Switch，读态与写态共用同一副长相。 */
export default function StatusSwitch({
  checked,
  onLabel,
  offLabel,
  disabled,
  size = 'small',
  onChange,
  confirm,
}: StatusSwitchProps) {
  const [pending, setPending] = useState(false);

  const handleChange = (next: boolean) => {
    if (!onChange) return;
    const result = onChange(next);
    if (result && typeof (result as Promise<void>).then === 'function') {
      setPending(true);
      // 失败由调用方提示；这里只负责收掉 loading，并吞掉 rejection 避免
      // `void` 调用变成一次无人处理的 unhandled rejection。
      void Promise.resolve(result)
        .catch(() => undefined)
        .finally(() => setPending(false));
    }
  };

  const label = checked ? onLabel : offLabel;

  const body = (
    <span className={styles.wrapper}>
      <Switch
        size={size}
        checked={checked}
        disabled={disabled}
        loading={pending}
        // 需要确认时，点击只负责打开确认框；真正的切换在 onConfirm 里发生。
        onChange={confirm ? undefined : handleChange}
      />
      {label ? <span className={styles.label}>{label}</span> : null}
    </span>
  );

  if (!confirm || !onChange || disabled) return body;

  return (
    <Popconfirm
      title={confirm.title}
      description={confirm.description}
      okText={confirm.okText}
      cancelText={confirm.cancelText}
      okButtonProps={confirm.okButtonProps}
      // 写入期间不让文案区域再次打开确认框，避免重复提交。
      disabled={pending}
      onConfirm={() => handleChange(!checked)}
    >
      {body}
    </Popconfirm>
  );
}
