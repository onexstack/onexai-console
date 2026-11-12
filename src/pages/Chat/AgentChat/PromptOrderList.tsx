import { Button, Select, Tooltip } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';

import styles from './debug.module.scss';

export interface PromptOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * 有序提示词列表。
 *
 * 顺序就是系统提示词的拼接顺序，所以它必须可见、可调，而不是像其他能力一样
 * 只是一个多选框。选择器只列出尚未被选中的提示词，避免重复项让顺序失去意义。
 */
export function PromptOrderList({
  options,
  value,
  onChange,
  disabled,
}: {
  options: PromptOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(value);
  const available = options.filter(option => !selected.has(option.value));

  const move = (index: number, delta: number) => {
    const next = [...value];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    // Both indices were bounds-checked above; the casts keep the swap type-safe
    // under noUncheckedIndexedAccess.
    const current = next[index] as string;
    const other = next[target] as string;
    next[index] = other;
    next[target] = current;
    onChange(next);
  };

  return (
    <div className={styles.promptList}>
      {value.map((name, index) => {
        const option = options.find(item => item.value === name);
        return (
          <div key={name} className={styles.promptRow}>
            <span className={styles.promptIndex}>{index + 1}</span>
            <div className={styles.promptName} title={name}>
              <span>{option?.label ?? name}</span>
              {option?.description ? (
                <span className={styles.promptDesc}>{option.description}</span>
              ) : null}
            </div>
            <Tooltip title="上移">
              <Button
                type="text"
                size="small"
                aria-label={`上移提示词 ${name}`}
                disabled={disabled || index === 0}
                icon={<ArrowUpOutlined />}
                onClick={() => move(index, -1)}
              />
            </Tooltip>
            <Tooltip title="下移">
              <Button
                type="text"
                size="small"
                aria-label={`下移提示词 ${name}`}
                disabled={disabled || index === value.length - 1}
                icon={<ArrowDownOutlined />}
                onClick={() => move(index, 1)}
              />
            </Tooltip>
            <Tooltip title="移除">
              <Button
                type="text"
                size="small"
                danger
                aria-label={`移除提示词 ${name}`}
                disabled={disabled}
                icon={<DeleteOutlined />}
                onClick={() => onChange(value.filter(item => item !== name))}
              />
            </Tooltip>
          </div>
        );
      })}

      <Select
        className={styles.addPrompt}
        // 必须是受控空值：rc-select 把 `undefined` 当作非受控，会把上一次选中
        // 的值一直留在输入框里；重置组合后看起来像提示词没清空。
        value={null}
        placeholder="添加提示词…"
        aria-label="添加提示词"
        showSearch
        optionFilterProp="label"
        disabled={disabled || available.length === 0}
        suffixIcon={<PlusOutlined />}
        options={available}
        optionRender={option => {
          const data = option.data as PromptOption;
          return (
            <div>
              <div>{option.label}</div>
              {data.description ? (
                <div className={styles.optionDesc}>{data.description}</div>
              ) : null}
            </div>
          );
        }}
        onChange={next => {
          if (typeof next === 'string' && next) onChange([...value, next]);
        }}
      />
    </div>
  );
}
