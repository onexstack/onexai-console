import type { ReactNode } from 'react';
import { Space, Tag } from 'antd';

import {
  CUSTOM_COMMAND_PREFIX,
  fieldOptionLabel,
  renderFieldValue,
  type FieldSpec,
  type ResourceSpec,
} from '@/api/resources';
import type { WebhookAuthValue } from '@/components/WebhookAuthForm/value';
import { commandGroupKey, commandGroupTagLabel, isCommandGroupValue } from '@/lib/command-groups';
import { readPath } from '@/components/ResourceForm/form-model';
import { RefValueBadges } from '@/components/ResourceForm/refBadges';
import { InfoSection, type InfoItem } from '@/ui';

import styles from './styles.module.scss';

export interface ReviewSection {
  key: string;
  label: string;
  fields: string[];
}

export interface ReviewStepProps {
  spec: ResourceSpec;
  sections: ReviewSection[];
  /** 表单当前值，由页面用 `form.getFieldsValue(true)` 传入。 */
  values: Record<string, unknown>;
  isCreate: boolean;
}

/**
 * 信息确认：按分区只读展示表单当前值。
 *
 * 值取自表单快照，而不是线上记录：用户要核对的是「即将提交的内容」——秒、
 * `k=v` 标签、名称数组这些正是表单里的友好形态。密码类字段永远不回显。
 */
export default function ReviewStep({ spec, sections, values, isCreate }: ReviewStepProps) {
  return (
    <div className={styles.review}>
      {sections.map(section => (
        <InfoSection
          key={section.key}
          title={section.label}
          items={section.fields.flatMap(fieldKey => {
            const field = spec.fields.find(item => item.key === fieldKey);
            return field ? [reviewItemOf(field, readPath(values, fieldKey), isCreate)] : [];
          })}
        />
      ))}
    </div>
  );
}

function reviewItemOf(field: FieldSpec, value: unknown, isCreate: boolean): InfoItem {
  const longKind =
    field.kind === 'textarea' ||
    field.kind === 'markdown' ||
    field.kind === 'json' ||
    field.kind === 'jsonValue';
  const hasValue = value !== undefined && value !== null && value !== '';
  // 长内容与超过 2 项的列表占满整行：半栏里会被挤成一条，核对时反而更难读。
  const wide =
    field.wide || (longKind && hasValue) || (Array.isArray(value) && value.length > 2);

  return {
    label: field.label,
    value: reviewValueOf(field, value, isCreate),
    span: wide ? 2 : 1,
    block: wide,
  };
}

function reviewValueOf(field: FieldSpec, value: unknown, isCreate: boolean): ReactNode {
  // 密钥永远不回显。新建时表单里确实有用户输入的明文，这里也只说「已填写」；
  // 编辑时留空表示保留服务端原值。
  if (field.kind === 'password') {
    const filled = typeof value === 'string' && value !== '';
    if (isCreate) {
      return (
        <span className={styles.reviewMasked}>
          {filled ? '已填写（保存后不可再查看）' : '未填写'}
        </span>
      );
    }
    return (
      <span className={styles.reviewMasked}>{filled ? '已填写（保存后将轮换）' : '保留原值'}</span>
    );
  }

  // 鉴权：绝不回显明文，只说明当前选择。
  if (field.kind === 'webhookAuth') {
    const auth = (value ?? {}) as WebhookAuthValue;
    if (auth.mode === 'token') {
      const filled = typeof auth.token === 'string' && auth.token.trim() !== '';
      return (
        <span className={styles.reviewMasked}>
          {filled ? '已填写（保存后写入凭据，不再回显）' : '未填写'}
        </span>
      );
    }
    if (auth.mode === 'secret') {
      return auth.secretRef ? (
        <span>{`引用 Secret ${auth.secretRef}`}</span>
      ) : (
        <span className={styles.reviewEmpty}>未选择</span>
      );
    }
    return <span className={styles.reviewEmpty}>不鉴权</span>;
  }

  // 开关的「关」本身就是有效状态：空值也要画成关闭，而不是让确认页显示 `-`。
  if (field.kind === 'switch') return renderFieldValue(field, value);

  if (value === undefined || value === null || value === '') {
    return <span className={styles.reviewEmpty}>-</span>;
  }

  // JSON / 多行文本必须保留换行，否则结构化配置会被压成一行。
  if ((field.kind === 'json' || field.kind === 'jsonValue') && typeof value === 'string') {
    return <span className={styles.reviewCode}>{value}</span>;
  }
  if ((field.kind === 'textarea' || field.kind === 'markdown') && typeof value === 'string') {
    return <span className={styles.reviewText}>{value}</span>;
  }

  // 表单里的数字已经换成界面单位（如秒），确认页把单位一起读出来。
  if (field.kind === 'number' && field.unit) {
    return <span>{`${String(value)} ${field.unit}`}</span>;
  }

  // 数组完整展开：列表/详情用的「前 2 项 + N」在确认页不够核对。
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={styles.reviewEmpty}>-</span>;
    return (
      <Space size={[4, 4]} wrap>
        {value.map((item, index) => {
          // 命令控件用前缀区分来源：`custom:` 是自定义命令，`group:` 是整组
          // 授予；确认页展示名称而不是内部值。
          const raw = String(item);
          const text =
            field.kind === 'commands' && raw.startsWith(CUSTOM_COMMAND_PREFIX)
              ? raw.slice(CUSTOM_COMMAND_PREFIX.length)
              : field.kind === 'commands' && isCommandGroupValue(raw)
                ? commandGroupTagLabel(commandGroupKey(raw))
                : // checklist 的线上取值（onStart）换成选项文案（OnStart）。
                  fieldOptionLabel(field, item);
          const ref = field.kind === 'refs' && text.startsWith('@');
          return (
            <Tag key={`${text}-${index}`} color={ref ? 'blue' : undefined}>
              {ref ? `${text}（引用）` : text}
              {/* 引用分不出行为时（Webhook 的 OnStart/OnEnd）补一行角标。 */}
              {field.refBadges ? <RefValueBadges field={field} value={item} /> : null}
            </Tag>
          );
        })}
      </Space>
    );
  }

  return renderFieldValue(field, value);
}
