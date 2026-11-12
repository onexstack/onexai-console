import { useMemo } from 'react';
import { Input, Select } from 'antd';

import type { FieldSpec } from '@/api/resources';
import {
  authzBackendsPlaceholder,
  reconcileAuthzBackends,
  useAuthzBackendOptions,
  useLabelOptions,
  useResourceOptions,
} from '@/components/ResourceForm/options';
import { badgeMapOf, refLabelRender, refOptionProps } from '@/components/ResourceForm/refOptions';

import { isValidJson, parseArray } from './value';

/**
 * 详情页的单字段内联编辑控件。
 *
 * 控件按字段种类选择，候选项与新建/编辑表单共用同一组 hooks —— 否则同一个
 * 字段在两处会给出不同的下拉候选。值的序列化见 `./value`。
 */
export function InlineFieldEditControl({
  field,
  value,
  onChange,
  scopeNamespace,
  resourceKey,
}: {
  field: FieldSpec;
  value: string;
  onChange: (next: string) => void;
  /** 记录所属命名空间：候选只保留同空间资源，与新建/编辑页一致。 */
  scopeNamespace?: string;
  /** 当前资源类型（`spec.key`）：标签候选按该资源的历史 labels 汇总。 */
  resourceKey: string;
}) {
  switch (field.kind) {
    case 'labels':
      return <LabelsControl value={value} onChange={onChange} resourceKey={resourceKey} />;
    case 'tags':
      return <TagsControl field={field} value={value} onChange={onChange} />;
    case 'jsonList':
      return <AuthzBackendsControl value={value} onChange={onChange} />;
    case 'refs':
      return field.refResource ? (
        <ReferencesControl
          field={field}
          value={value}
          onChange={onChange}
          scopeNamespace={scopeNamespace}
          referrerKey={resourceKey}
        />
      ) : (
        <TextControl field={field} value={value} onChange={onChange} />
      );
    case 'ref':
      return field.refResource ? (
        <ReferenceControl
          field={field}
          value={value}
          onChange={onChange}
          scopeNamespace={scopeNamespace}
          referrerKey={resourceKey}
        />
      ) : (
        <TextControl field={field} value={value} onChange={onChange} />
      );
    case 'textarea':
      return <TextAreaControl field={field} value={value} onChange={onChange} />;
    case 'json':
    case 'jsonValue':
      return <JsonControl field={field} value={value} onChange={onChange} />;
    default:
      return <TextControl field={field} value={value} onChange={onChange} />;
  }
}

interface ControlProps {
  field: FieldSpec;
  value: string;
  onChange: (next: string) => void;
  scopeNamespace?: string;
  /** 当前资源类型：决定跨空间候选是否被 ReferenceGrant 放行。 */
  referrerKey?: string;
}

function TextControl({ field, value, onChange }: ControlProps) {
  // 接入地址是 URL，240px 放不下一个完整的 https://... 前缀；其余短字段保持窄。
  const width = field.key === 'baseUrl' ? 360 : 240;
  return (
    <Input
      size="small"
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      showCount={field.showCount}
      autoFocus
      style={{ width, maxWidth: '100%' }}
    />
  );
}

/** 字符串数组标签（能力、命令等）：候选来自字段描述，同时允许回车输入自定义值。 */
function TagsControl({ field, value, onChange }: ControlProps) {
  return (
    <Select
      size="small"
      mode="tags"
      showSearch
      optionFilterProp="label"
      options={field.options}
      value={parseArray(value)}
      onChange={next => onChange(JSON.stringify(next))}
      placeholder={field.placeholder ?? '选择或输入'}
      style={{ minWidth: 240, maxWidth: '100%' }}
      autoFocus
    />
  );
}

function TextAreaControl({ field, value, onChange }: ControlProps) {
  return (
    <Input.TextArea
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      showCount={field.showCount}
      rows={4}
      autoFocus
      // 多行文本按内容需要给一个合适宽度，而不是铺满整个值列。
      style={{ width: 480, maxWidth: '100%' }}
    />
  );
}

/**
 * 结构化配置（请求头、资源映射）：等宽多行，边改边提示语法错误。
 *
 * 保存前的最终校验在详情页的 `EditConfig.validate` 里；这里只做即时反馈，
 * 免得用户点了保存才发现少了一个括号。
 */
function JsonControl({ field, value, onChange }: ControlProps) {
  const invalid = value.trim() !== '' && !isValidJson(value);
  return (
    <div style={{ width: 480, maxWidth: '100%' }}>
      <Input.TextArea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={field.placeholder ?? 'JSON'}
        rows={6}
        autoFocus
        status={invalid ? 'error' : undefined}
        style={{ fontFamily: 'var(--font-family-code, monospace)', fontSize: 12 }}
      />
      {invalid && (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-error, #ff4d4f)' }}>
          JSON 格式不正确
        </div>
      )}
    </div>
  );
}

/** 单选引用（如模型）：留空表示使用部署默认。 */
function ReferenceControl({ field, value, onChange, scopeNamespace, referrerKey }: ControlProps) {
  const { options, loading } = useResourceOptions({
    resourceKey: field.refResource,
    refFilter: field.refFilter,
    scopeNamespace,
    referrerKey,
    badgeOf: field.refBadges,
  });
  const badges = useMemo(() => badgeMapOf(options), [options]);
  return (
    <Select
      size="small"
      allowClear
      showSearch
      {...refOptionProps(field)}
      {...(field.refBadges ? { labelRender: refLabelRender(badges) } : {})}
      loading={loading}
      options={options}
      value={value === '' ? undefined : value}
      onChange={next => onChange(next ?? '')}
      placeholder={field.placeholder ?? '从已有资源中选择'}
      style={{ minWidth: 200, maxWidth: '100%' }}
    />
  );
}

/** 多选引用（Skill / MCP / 知识库 / 提示词 / 自定义命令）。 */
function ReferencesControl({ field, value, onChange, scopeNamespace, referrerKey }: ControlProps) {
  const { options, loading } = useResourceOptions({
    resourceKey: field.refResource,
    refFilter: field.refFilter,
    scopeNamespace,
    referrerKey,
    badgeOf: field.refBadges,
  });
  const badges = useMemo(() => badgeMapOf(options), [options]);
  return (
    <Select
      size="small"
      mode={field.allowCustom ? 'tags' : 'multiple'}
      showSearch
      {...refOptionProps(field)}
      {...(field.refBadges ? { labelRender: refLabelRender(badges) } : {})}
      loading={loading}
      options={options}
      value={parseArray(value)}
      onChange={next => onChange(JSON.stringify(next))}
      placeholder={field.placeholder ?? '从已有资源中选择'}
      // 宽度随选中项自适应：只有一个引用时不撑满整行。
      style={{ minWidth: 240, maxWidth: '100%' }}
    />
  );
}

/** 标签：`k=v` 的候选来自当前资源类型的历史标签，回车可新增。 */
function LabelsControl({
  value,
  onChange,
  resourceKey,
}: Pick<ControlProps, 'value' | 'onChange'> & { resourceKey: string }) {
  const { options, loading } = useLabelOptions(resourceKey);
  return (
    <Select
      size="small"
      mode="tags"
      loading={loading}
      options={options}
      value={parseArray(value)}
      onChange={next => onChange(JSON.stringify(next))}
      tokenSeparators={[',', '，', '\n']}
      placeholder="k=v，回车添加"
      style={{ minWidth: 240, maxWidth: '100%' }}
    />
  );
}

/** 授权后端：线上是 JSON 数组字符串，编辑时按多选处理；`none` 表示关闭。 */
function AuthzBackendsControl({ value, onChange }: Pick<ControlProps, 'value' | 'onChange'>) {
  const { options, loading } = useAuthzBackendOptions();
  const selected = parseArray(value);
  return (
    <Select
      size="small"
      mode="multiple"
      loading={loading}
      options={options}
      value={selected}
      onChange={next => onChange(JSON.stringify(reconcileAuthzBackends(selected, next)))}
      placeholder={authzBackendsPlaceholder(options, loading)}
      style={{ minWidth: 240, maxWidth: '100%' }}
    />
  );
}
