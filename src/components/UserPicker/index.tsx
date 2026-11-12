import { useMemo } from 'react';
import { Input, Select, Space, Tag } from 'antd';

import { useUserDirectory, type DirectoryUser } from '@/components/UserRef';

/**
 * 选中值写什么：
 * - `value`：目录算好的写入值（唯一 email，缺失时 username），排班等按字符串
 *   全等匹配的场景用；
 * - `id`：平台账号 ID，与后端 `claims.UserID` 同一口径，资源归属（owner）用。
 */
export type UserPickerValueKey = 'value' | 'id';

interface Props {
  /** false：表单值是 string；true：表单值是 string[]。 */
  multiple?: boolean;
  /** `value`（默认）：email/username；`id`：平台账号 ID。 */
  valueKey?: UserPickerValueKey;
  /**
   * 允许直接输入目录外的值（默认 true）。
   *
   * 关闭后单选退回普通 `Select`：只能从平台用户列表里选，不会把随手输入的文字
   * 当成一个「用户」。资源归属字段应当关闭——归属必须能对应到真实账号。
   */
  allowCustom?: boolean;
  value?: string | string[];
  onChange?: (value: string | string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 由 antd `Form.Item` 注入，用于把 label 关联到控件。 */
  id?: string;
  /** 除当前值外，也要出现在选项里的历史/外部值。 */
  extraValues?: string[];
  /**
   * 已有的写法。选中同一个用户时优先复用它，避免参与者写 email、
   * 不可用记录写 username 导致后端按字符串全等匹配时失效。
   */
  preferValues?: string[];
  style?: React.CSSProperties;
}

interface PickerOption {
  value: string;
  label: string;
  searchText: string;
  user?: DirectoryUser;
}

const DEFAULT_PLACEHOLDER = '搜索平台用户，或直接输入邮箱/用户名';
const STRICT_PLACEHOLDER = '搜索并选择平台用户';

function toList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

/**
 * 平台用户选择器。
 *
 * 选项来自平台用户目录：绑定了飞书的显示飞书名，未绑定显示平台显示名；
 * 搜索同时匹配飞书名、显示名、username 与 email。
 *
 * 目录不可用（非管理员、接口失败）时退化为自由输入，不阻塞保存：非管理员
 * 本来就拿不到 `/v1/users`，资源归属由后端按调用者补齐。
 */
export default function UserPicker({
  multiple = false,
  valueKey = 'value',
  allowCustom = true,
  value,
  onChange,
  placeholder,
  disabled,
  id,
  extraValues = [],
  preferValues = [],
  style,
}: Props) {
  const directory = useUserDirectory();
  const values = toList(value);
  const resolvedPlaceholder =
    placeholder ?? (allowCustom ? DEFAULT_PLACEHOLDER : STRICT_PLACEHOLDER);

  const options = useMemo<PickerOption[]>(() => {
    const out: PickerOption[] = [];
    const seen = new Set<string>();
    const push = (option: PickerOption) => {
      const key = option.value.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(option);
    };

    for (const user of directory.users) {
      push({
        value: valueKey === 'id' ? user.id : user.value,
        label: user.label,
        searchText: user.searchText,
        user,
      });
    }

    // 目录里没有的当前值/历史值：保留原样，编辑时不丢数据。
    for (const raw of [...values, ...extraValues]) {
      const trimmed = raw.trim();
      if (!trimmed || directory.byKey.has(trimmed.toLowerCase())) continue;
      push({ value: trimmed, label: trimmed, searchText: trimmed.toLowerCase() });
    }
    return out;
  }, [directory.users, directory.byKey, values, extraValues, valueKey]);

  const resolveName = directory.resolveName;

  // 同一个用户在排班里已有一种写法时，沿用它。只在允许自由输入的 tags 模式
  // 有意义：`valueKey='id'` 的值必须保持账号 ID。
  const prefer = (selected: string): string => {
    if (valueKey === 'id' || !allowCustom) return selected;
    const user = directory.byKey.get(selected.trim().toLowerCase());
    if (!user) return selected;
    for (const raw of preferValues) {
      const hit = directory.byKey.get(raw.trim().toLowerCase());
      if (hit?.id === user.id) return raw;
    }
    return selected;
  };

  if (!directory.ready) {
    if (multiple) {
      return (
        <Select
          id={id}
          mode="tags"
          value={values}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          style={style}
          tokenSeparators={[',', ';']}
          onChange={next =>
            onChange?.((next as string[]).map(v => String(v).trim()).filter(Boolean))
          }
        />
      );
    }
    return (
      <Input
        id={id}
        value={values[0] ?? ''}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        style={style}
        onChange={event => onChange?.(event.target.value)}
      />
    );
  }

  // 单选 + 不允许自由输入时用普通下拉：值只能是目录里的一个账号。
  // 单选时 tags 模式就是「可自由输入的单值下拉」；关闭自定义后才是普通下拉。
  const mode = multiple ? (allowCustom ? 'tags' : 'multiple') : allowCustom ? 'tags' : undefined;

  const handleChange = (next: unknown) => {
    if (mode === undefined) {
      onChange?.(typeof next === 'string' ? next.trim() : '');
      return;
    }
    const list = Array.isArray(next) ? next : [];
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of list) {
      const selected = prefer(String(raw).trim());
      const key = selected.toLowerCase();
      if (!selected || seen.has(key)) continue;
      seen.add(key);
      cleaned.push(selected);
    }
    // tags 模式允许继续追加，单值字段取最后一项：选中新用户即替换。
    onChange?.(multiple ? cleaned : (cleaned[cleaned.length - 1] ?? ''));
  };

  return (
    <Select
      id={id}
      mode={mode}
      value={mode === undefined ? values[0] : values}
      options={options}
      placeholder={resolvedPlaceholder}
      disabled={disabled}
      style={{ minWidth: 280, ...style }}
      allowClear
      // tags 模式默认就能搜索，显式传 false 反而会关掉它。
      showSearch={mode === undefined || mode === 'multiple' ? true : undefined}
      tokenSeparators={mode === 'tags' ? [',', ';'] : undefined}
      notFoundContent={allowCustom ? undefined : '没有匹配的用户'}
      labelRender={({ value: selected }) => {
        const raw = String(selected);
        const name = resolveName(raw) || raw;
        return <span title={name === raw ? undefined : raw}>{name}</span>;
      }}
      filterOption={(input, option) => {
        const text = (option as unknown as PickerOption | undefined)?.searchText ?? '';
        return text.includes(input.trim().toLowerCase());
      }}
      optionRender={option => {
        const user = (option.data as unknown as PickerOption | undefined)?.user;
        if (!user) return <span>{String(option.label ?? '')}</span>;
        return (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span>{user.label}</span>
            <Space size={4} style={{ fontSize: 12, opacity: 0.7, flexShrink: 0 }}>
              <span>{[user.username, user.email].filter(Boolean).join(' · ')}</span>
              {user.larkReady ? (
                <Tag variant="filled" color="blue" style={{ marginInlineEnd: 0 }}>
                  飞书
                </Tag>
              ) : user.feishuBound ? (
                <Tag variant="filled" color="gold" style={{ marginInlineEnd: 0 }}>
                  飞书 · 缺少 user_id
                </Tag>
              ) : (
                <Tag variant="filled" color="orange" style={{ marginInlineEnd: 0 }}>
                  未绑定飞书
                </Tag>
              )}
              {user.status === 'disabled' ? (
                <Tag variant="filled" style={{ marginInlineEnd: 0 }}>
                  已停用
                </Tag>
              ) : null}
            </Space>
          </div>
        );
      }}
      onChange={handleChange}
    />
  );
}
