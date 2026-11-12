import { useMemo } from 'react';
import { Tag } from 'antd';

import type { FieldSpec } from '@/api/resources';

import { useResourceRows, type SelectOption } from './options';
import styles from './styles.module.scss';

/** 引用项上的类型标签（如 Webhook 的 OnStart / OnEnd）。 */
export function RefBadgeTags({ badges }: { badges?: SelectOption['badges'] }) {
  if (!badges?.length) return null;
  return (
    <span className={styles.refBadges}>
      {badges.map(badge => (
        <Tag key={badge.label} variant="filled" color={badge.color} className={styles.refBadge}>
          {badge.label}
        </Tag>
      ))}
    </span>
  );
}

/**
 * 只读场景（详情页、确认页）的引用角标。
 *
 * 那里只有引用值（名称或 `空间/名称`），没有候选行；按行名反查一遍。行缓存与
 * 表单候选共用同一个 query key，同一页里多次渲染不会重复请求。字段没有
 * `refBadges` 时不发请求。
 *
 * 只读行本身已经是一个 Tag，再嵌一层彩色 Tag 会显得很重，所以画成弱化文字。
 */
export function RefValueBadges({ field, value }: { field: FieldSpec; value: unknown }) {
  const { data } = useResourceRows(field.refBadges ? field.refResource : undefined);
  const badges = useMemo(() => {
    if (!field.refBadges) return undefined;
    const raw =
      value && typeof value === 'object' && !Array.isArray(value)
        ? String((value as Record<string, unknown>).name ?? '')
        : String(value);
    // 跨空间引用是 `空间/名称`；行只按名称索引。
    const name = raw.split('/').pop() ?? raw;
    const row = (data ?? []).find(item => String(item.name ?? item.secretId ?? '') === name);
    return row ? field.refBadges(row) : undefined;
  }, [data, field, value]);
  if (!badges?.length) return null;
  return (
    <span className={styles.refBadgeText}>{badges.map(badge => badge.label).join(' · ')}</span>
  );
}
