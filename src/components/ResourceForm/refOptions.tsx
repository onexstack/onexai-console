import type { ReactNode } from 'react';
import type { SelectProps } from 'antd';

import type { FieldSpec } from '@/api/resources';
import { OptionLabel } from '@/components/OptionLabel';
import { matchOptionText } from '@/components/OptionLabel/helpers';

import { RefBadgeTags } from './refBadges';
import type { SelectOption } from './options';

/**
 * 已选标签的角标映射：值是选择值（可能是 `空间/名称`），不是行名。
 *
 * 只认候选里的项：停用的引用、手输的 `none` 取不到行，也就不带标签。
 */
export function badgeMapOf(options: SelectOption[]): Map<string, SelectOption['badges']> {
  const map = new Map<string, SelectOption['badges']>();
  for (const option of options) {
    if (option.badges?.length) map.set(option.value, option.badges);
  }
  return map;
}

/**
 * 已选标签（单选的值、多选的 chip）的渲染：名字后面补类型角标。
 *
 * `labelRender` 只拿得到值和显示名，角标要按选择值反查。
 */
export function refLabelRender(badges: Map<string, SelectOption['badges']>) {
  return (props: { label?: ReactNode; value?: string | number }) => (
    <>
      {props.label}
      <RefBadgeTags badges={badges.get(String(props.value))} />
    </>
  );
}

/**
 * 引用下拉的候选渲染。
 *
 * - 智能体引用显示「显示名 + 描述」两行（与设置抽屉、筛选栏一致）；
 * - 带 `refBadges` 的字段（如 Webhook）在名字后面补类型标签，并让搜索能命中
 *   标签文案（输入 OnStart 只留下准入钩子）；
 * - 其余资源仍只显示名字，避免给所有表单塞满描述。
 */
export function refOptionProps(field: FieldSpec): Partial<SelectProps> {
  const withDescription = field.refResource === 'agents';
  const withBadges = Boolean(field.refBadges);
  if (!withDescription && !withBadges) return { optionFilterProp: 'label' };
  return {
    optionRender: option => {
      const data = option.data as SelectOption | undefined;
      return (
        <OptionLabel
          title={option.label}
          description={withDescription ? data?.description : undefined}
          suffix={withBadges ? <RefBadgeTags badges={data?.badges} /> : undefined}
        />
      );
    },
    filterOption: (input, option) => {
      // rc-select 把原始候选（我们的 `SelectOption`）直接交给这里，标签文案在
      // `label` 上；类型签名只声明了 ReactNode，取不到串时退回空串。
      const data = option as SelectOption | undefined;
      return matchOptionText(
        input,
        data?.label,
        data?.description,
        ...(data?.badges?.map(badge => badge.label) ?? [])
      );
    },
  };
}
