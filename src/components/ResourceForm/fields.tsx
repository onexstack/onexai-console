import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  AutoComplete,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Switch,
  Tag,
} from 'antd';

import {
  CUSTOM_COMMAND_PREFIX,
  switchMappingOf,
  type FieldOption,
  type FieldSpec,
} from '@/api/resources';
import { testMcp } from '@/api/resourceDefs';
import {
  COMMAND_GROUP_LABEL_KEY,
  COMMAND_GROUP_PREFIX,
  commandGroupLabel,
  commandGroupTagLabel,
  compareCommandGroups,
} from '@/lib/command-groups';
import { matchesToolPattern } from '@/lib/tool-pattern';
import DeleteIcon from '@/components/DeleteIcon';
import { OptionLabel } from '@/components/OptionLabel';
import ProviderIcon from '@/components/ProviderIcon';
import UserPicker from '@/components/UserPicker';
import { timeZoneOptions } from '@/lib/timezone';
import { isSwitchOn } from '@/ui';
import MarkdownEditor from '@/ui/components/MarkdownEditor';
import ClientConfigForm from '@/components/ClientConfigForm';
import WebhookAuthForm, { type WebhookAuthValue } from '@/components/WebhookAuthForm';

import ReferenceGrantGenerator from './ReferenceGrantGenerator';
import { badgeMapOf, refLabelRender, refOptionProps } from './refOptions';
import {
  authzBackendsPlaceholder,
  reconcileAuthzBackends,
  useAuthzBackendOptions,
  useLabelOptions,
  useNamespaceOptions,
  useResourceOptions,
  useResourceRows,
  type SelectOption,
} from './options';
import styles from './styles.module.scss';

/**
 * 一个字段对应什么控件。
 *
 * 拆成「按种类分包」的小组件，而不是一个 `controlOf()` 返回 JSX 的函数：
 * 引用类字段要发请求取候选，hooks 必须无条件调用；一个小判断函数里塞
 * 四路 `useQuery` 会让每个字段都发一次无关请求。
 *
 * # 必须透传 value / onChange
 *
 * 这些控件是 `Form.Item` 的直接子元素，antd 会把 `value`、`onChange`、`id`
 * 以 props 的形式注入进来。包装层不往下传，字段就会变成「显示初始值但改不动」。
 */
export interface ResourceFieldControlProps {
  field: FieldSpec;
  isCreate: boolean;
  /**
   * 当前资源所属命名空间：引用候选只保留同空间的资源。
   *
   * 后端会拒绝跨命名空间引用（被显式引用时控制器上报 missing），所以候选
   * 必须与记录同空间。空字符串表示不过滤（集群级资源 / 页头为「全部空间」）；
   * Agent 表单是例外：空 scope 时失败关闭，不猜目标空间。
   */
  scopeNamespace?: string;
  /**
   * 覆盖描述符里的静态候选（如连通性测试发现的 MCP 工具）。
   *
   * 只有「按 `field.options` 渲染下拉」的控件会用到它；引用类字段的候选仍来自
   * `refResource`。
   */
  optionsOverride?: FieldOption[];
  /** 由页面强制禁用（如 MCP 测试通过前不能选工具）。 */
  forceDisabled?: boolean;
  /** 当前记录的主键，供 `excludeSelf` 的引用字段过滤自身。 */
  currentId?: string;
  /**
   * 当前资源类型（`spec.key`）：标签候选按该资源的历史 labels 汇总。
   * 必填，避免新增调用方漏传后静默得到空候选。
   */
  resourceKey: string;
  /** 以下三项由 antd `Form.Item` 注入。 */
  id?: string;
  value?: unknown;
  onChange?: (...args: unknown[]) => void;
}

export default function ResourceFieldControl({
  field,
  isCreate,
  scopeNamespace,
  optionsOverride,
  forceDisabled,
  currentId,
  resourceKey,
  id,
  value,
  onChange,
}: ResourceFieldControlProps) {
  // 名字是资源的主键，也是它在上游的路径参数；新建之后不给改。
  const disabled = forceDisabled === true || (field.key === 'name' && !isCreate);
  const shared = {
    field,
    disabled,
    scopeNamespace,
    resourceKey,
    optionsOverride,
    currentId,
    id,
    value,
    onChange,
  };

  if (field.optionsSource === 'namespaces') {
    return field.kind === 'tags' ? (
      <NamespaceTagsControl {...shared} />
    ) : (
      <NamespaceControl {...shared} />
    );
  }
  if (field.optionsSource === 'authzBackends') {
    return <AuthzBackendControl {...shared} />;
  }
  if (field.optionsSource === 'labels' || field.kind === 'labels') {
    return <LabelsControl {...shared} />;
  }
  if (field.kind === 'timezone') {
    return <TimeZoneControl {...shared} />;
  }
  if (field.kind === 'user') {
    return <UserControl {...shared} />;
  }
  if (field.kind === 'approvalTools') {
    return <ApprovalToolsControl {...shared} />;
  }
  if (field.kind === 'ref') {
    return <ReferenceControl {...shared} />;
  }
  if (field.kind === 'webhookAuth') {
    return (
      <WebhookAuthForm
        id={id}
        disabled={disabled}
        value={value as WebhookAuthValue}
        onChange={onChange as (next: WebhookAuthValue) => void}
      />
    );
  }
  if (field.kind === 'commands') {
    return <CommandsControl {...shared} />;
  }
  if (field.kind === 'refs' && field.refResource) {
    return <ReferencesControl {...shared} />;
  }

  return <StaticControl {...shared} />;
}

interface ControlProps {
  field: FieldSpec;
  disabled: boolean;
  scopeNamespace?: string;
  /** 当前资源类型，标签候选取自它的历史 labels。 */
  resourceKey: string;
  optionsOverride?: FieldOption[];
  /** 当前记录的主键，供 `excludeSelf` 的引用字段过滤自身。 */
  currentId?: string;
  id?: string;
  value?: unknown;
  onChange?: (...args: unknown[]) => void;
}

/** 候选是否带说明文字（MCP 工具）：带说明时下拉画成两列并允许按说明搜索。 */
function hasDescriptions(options?: FieldOption[]): boolean {
  return Boolean(options?.some(option => option.description));
}

/** 「名称 + 说明」两行渲染（与智能体选择器一致）；没有说明的候选保持单行。 */
function renderDescribedOption(option: {
  data?: unknown;
  label?: ReactNode;
  value?: unknown;
}): ReactNode {
  const data = option.data as FieldOption | undefined;
  if (!data?.description) return data?.label ?? option.label;
  return <OptionLabel title={data.label} description={data.description} />;
}

/**
 * 已选标签只显示名称。
 *
 * `tags` 模式下列表项的 `label` 可能是「名称 + 说明」的整串，直接交给 antd 会把
 * 描述也塞进标签；这里优先取 `value`（工具名），回退到 label。
 */
function renderNameTag({
  label,
  value,
  closable,
  onClose,
}: {
  label?: ReactNode;
  value?: string | number;
  closable?: boolean;
  onClose?: (event?: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <Tag
      closable={closable}
      onClose={onClose}
      style={{ marginInlineEnd: 4, marginTop: 2, marginBottom: 2 }}
    >
      {String(value ?? label ?? '')}
    </Tag>
  );
}

/**
 * 下拉项渲染：有品牌图标时画成「图标 + 文案」，否则原样返回 label。
 *
 * `label` 始终保持字符串，所以 AutoComplete 的 `filterOption`（按 label/value
 * 匹配）不受图标影响。
 */
function renderOption(option: { label?: ReactNode; data?: unknown }): ReactNode {
  const icon = (option.data as { icon?: string } | undefined)?.icon;
  if (!icon) return option.label;
  return (
    <span className={styles.optionWithIcon}>
      <ProviderIcon provider={icon} />
      <span>{option.label}</span>
    </span>
  );
}

/**
 * 时区：IANA 名称的可搜索下拉。
 *
 * 候选来自运行环境而不写死在描述符里；老记录里的别名（候选表里没有）会补到
 * 最前面，避免编辑时把原值静默清掉。
 */
function TimeZoneControl({ field, disabled, id, value, onChange }: ControlProps) {
  const current = typeof value === 'string' ? value : undefined;
  const options = useMemo(() => {
    const list = timeZoneOptions().map(option => ({ ...option }));
    if (current && !list.some(option => option.value === current)) {
      list.unshift({ value: current, label: `${current}（未识别）` });
    }
    return list;
  }, [current]);
  return (
    <Select
      id={id}
      disabled={disabled}
      showSearch
      optionFilterProp="label"
      options={options}
      value={current}
      onChange={onChange}
      placeholder={field.placeholder ?? '选择时区'}
    />
  );
}

/**
 * 平台用户：从用户目录里搜索选择，写入账号 ID。
 *
 * 归属（owner）必须对应真实账号：后端按 `claims.UserID` 校验归属，写入
 * 用户名/显示名只能碰巧命中。目录不可用（非管理员）时 `UserPicker` 自己
 * 退化为文本输入，与改造前一致。
 */
function UserControl({ field, disabled, id, value, onChange }: ControlProps) {
  return (
    <UserPicker
      id={id}
      disabled={disabled}
      valueKey="id"
      allowCustom={false}
      value={typeof value === 'string' ? value : undefined}
      onChange={next => onChange?.(next)}
      placeholder={field.placeholder ?? '搜索并选择平台用户'}
    />
  );
}

/** 普通控件：静态枚举、数字、开关、文本、JSON、密码、自由标签。 */
function StaticControl({ field, disabled, optionsOverride, id, value, onChange }: ControlProps) {
  // 必须排在 select/valueEnum 之前：`kind` 同时带了 valueEnum（列表 Tag 用），
  // 落到下面的分支会渲染成下拉而不是分段选择。
  if (field.kind === 'segmented') {
    const options =
      field.options ??
      Object.entries(field.valueEnum ?? {}).map(([itemValue, item]) => ({
        value: itemValue,
        label: item.text,
      }));
    return (
      <Segmented
        block
        id={id}
        disabled={disabled}
        options={options}
        value={value as string | number | undefined}
        onChange={onChange}
      />
    );
  }

  if (field.kind === 'select' || field.valueEnum) {
    const options =
      optionsOverride ??
      field.options ??
      Object.entries(field.valueEnum ?? {}).map(([itemValue, item]) => ({
        value: itemValue,
        label: item.text,
      }));
    // 提供方这类字段：常见值给候选，但也允许输入注册表之外的自定义值，
    // 所以用 AutoComplete 而不是只能从候选里挑的 Select。
    if (field.allowCustom) {
      return (
        <AutoComplete
          id={id}
          disabled={disabled}
          options={options}
          optionRender={renderOption}
          value={value as string | undefined}
          onChange={onChange}
          placeholder={field.placeholder}
          allowClear
          filterOption={(input, option) =>
            String(option?.value ?? '')
              .toLowerCase()
              .includes(input.toLowerCase()) ||
            String(option?.label ?? '')
              .toLowerCase()
              .includes(input.toLowerCase())
          }
        />
      );
    }
    return (
      <Select
        id={id}
        disabled={disabled}
        options={options}
        optionRender={renderOption}
        value={value as string | number | undefined}
        onChange={onChange}
        placeholder={field.placeholder}
      />
    );
  }

  switch (field.kind) {
    case 'number':
      return (
        <InputNumber
          id={id}
          // 数字框不铺满整行：参考图里的步进控件都是窄框，右侧留给说明文字。
          style={{ width: 240, maxWidth: '100%' }}
          disabled={disabled}
          value={value as number | undefined}
          onChange={onChange}
          placeholder={field.placeholder}
          addonAfter={field.unit}
          min={field.min}
          max={field.max}
          step={field.step}
        />
      );
    case 'switch': {
      // Form.Item 注入的是 `value`（默认 valuePropName）；Switch 要的是
      // `checked`，这里做一次映射，开关才会跟着表单值走。
      //
      // 状态字段的线上值是 `enabled` / `disabled`（不是布尔），所以开 / 关要
      // 分别换回线上取值再交给表单；纯布尔字段原样传布尔。
      const mapping = switchMappingOf(field);
      const mapped = field.switchOn !== undefined || field.switchOff !== undefined;
      const checked = isSwitchOn(mapping, value);
      const label = checked ? field.switchOnLabel : field.switchOffLabel;
      return (
        <span className={styles.switchControl}>
          <Switch
            id={id}
            disabled={disabled}
            checked={checked}
            onChange={next => onChange?.(mapped ? (next ? field.switchOn : field.switchOff) : next)}
          />
          {label ? <span className={styles.switchLabel}>{label}</span> : null}
        </span>
      );
    }
    case 'checklist': {
      // antd v6 的 Group 会把每项的 className 挂到该勾选行、把 ReactNode 的
      // label 原样作为内容渲染，所以选项说明直接拼进 label 即可画成第二行。
      const options = (optionsOverride ?? field.options ?? []).map(option => ({
        value: option.value,
        className: styles.checklistItem,
        label: option.description ? (
          <span className={styles.checklistText}>
            <span>{option.label}</span>
            <span className={styles.checklistDesc}>{option.description}</span>
          </span>
        ) : (
          option.label
        ),
      }));
      return (
        <Checkbox.Group
          className={styles.checklist}
          disabled={disabled}
          options={options}
          value={Array.isArray(value) ? value.map(String) : []}
          onChange={next => onChange?.(next.map(String))}
        />
      );
    }
    case 'textarea':
      return (
        <Input.TextArea
          id={id}
          rows={field.rows ?? 6}
          disabled={disabled}
          value={value as string | undefined}
          onChange={onChange}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          showCount={field.showCount}
          style={
            field.monospace
              ? { fontFamily: 'var(--font-family-code, monospace)', fontSize: 12 }
              : undefined
          }
        />
      );
    case 'markdown':
      return (
        <MarkdownEditor
          id={id}
          disabled={disabled}
          value={value as string | undefined}
          onChange={onChange as (next: string) => void}
          placeholder={field.placeholder}
        />
      );
    case 'clientConfig':
      return (
        <ClientConfigForm
          id={id}
          disabled={disabled}
          value={value as never}
          onChange={onChange as never}
          {...field.clientConfigOptions}
        />
      );
    case 'json':
    case 'jsonValue': {
      const textarea = (
        <Input.TextArea
          id={id}
          rows={field.rows ?? 5}
          disabled={disabled}
          value={value as string | undefined}
          onChange={onChange}
          placeholder={field.placeholder ?? 'JSON；保存前会校验语法'}
          className={field.action ? styles.jsonText : undefined}
          style={{ fontFamily: 'var(--font-family-code, monospace)', fontSize: 12 }}
        />
      );
      // 描述符只在需要可视化生成器的字段上声明 action；其余 JSON 字段保持原样。
      if (field.kind === 'jsonValue' && field.action === 'reference-grant-generator') {
        return (
          <div className={styles.controlWithAction}>
            {textarea}
            <ReferenceGrantGenerator
              side={field.key === 'to' ? 'to' : 'from'}
              disabled={disabled}
            />
          </div>
        );
      }
      return textarea;
    }
    case 'password':
      return (
        <Input.Password
          id={id}
          disabled={disabled}
          value={value as string | undefined}
          onChange={onChange}
          placeholder={field.placeholder}
          autoComplete="new-password"
        />
      );
    case 'tags':
    case 'refs': {
      const options = optionsOverride ?? field.options;
      // MCP 工具候选带描述：下拉画两列、支持按描述搜索，标签只留工具名。
      const described = hasDescriptions(options);
      return (
        <Select
          id={id}
          mode="tags"
          disabled={disabled}
          options={options}
          {...(described
            ? {
                filterOption: (
                  input: string,
                  option?: { label?: ReactNode; description?: string }
                ) =>
                  `${String(option?.label ?? '')} ${option?.description ?? ''}`
                    .toLowerCase()
                    .includes(input.toLowerCase()),
                optionRender: renderDescribedOption,
                tagRender: renderNameTag,
              }
            : { optionFilterProp: 'label' })}
          value={value as string[] | undefined}
          onChange={onChange}
          placeholder={
            field.placeholder ?? (field.kind === 'refs' ? '回车添加；@peer 这类是引用' : '回车添加')
          }
        />
      );
    }
    default:
      return (
        <Input
          id={id}
          disabled={disabled}
          value={value as string | undefined}
          onChange={onChange}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          showCount={field.showCount}
        />
      );
  }
}

/** 单选引用（模型、智能体、凭据…）。 */
function ReferenceControl({
  field,
  disabled,
  scopeNamespace,
  currentId,
  resourceKey,
  id,
  value,
  onChange,
}: ControlProps) {
  const { options, loading } = useResourceOptions({
    resourceKey: field.refResource,
    refFilter: field.refFilter,
    scopeNamespace,
    excludeName: field.excludeSelf ? currentId : undefined,
    referrerKey: resourceKey,
    badgeOf: field.refBadges,
  });
  const badges = useMemo(() => badgeMapOf(options), [options]);
  return (
    <Select
      id={id}
      disabled={disabled}
      allowClear
      showSearch
      {...refOptionProps(field)}
      {...(field.refBadges ? { labelRender: refLabelRender(badges) } : {})}
      loading={loading}
      options={options}
      value={value as string | undefined}
      onChange={onChange}
      placeholder={field.placeholder ?? '从已有资源中选择'}
    />
  );
}

/**
 * 多选里的「全部」候选值。
 *
 * `*` 不是任何资源/DNS 名称的合法值，所以不会与真实项冲突。命名空间字段
 * 直接把它写给后端（后端只接受单独一项 `*`）；集群绑定的智能体字段则在提交
 * 时由 codec 转成空 `agentSelector`（见 `resourceDefs.ts`）。
 */
const WILDCARD = '*';

/**
 * `*` 与具体项互斥。
 *
 * 刚选中 `*` 时清空其余项；已经有 `*` 时再选具体项则移除 `*`。控件与提交体
 * 因此永远不会出现 `["*", "team-a"]` 这种被后端拒绝的写法。
 */
function wildcardAwareChange(wildcard: boolean, picked: string[], next: string[]): string[] {
  if (!wildcard) return next;
  const hadWildcard = picked.includes(WILDCARD);
  const hasWildcard = next.includes(WILDCARD);
  if (hasWildcard && !hadWildcard) return [WILDCARD];
  return next.filter(item => item !== WILDCARD);
}

/** 多选引用（Skill、MCP、知识库、提示词、智能体…）。 */
function ReferencesControl({
  field,
  disabled,
  scopeNamespace,
  currentId,
  resourceKey,
  optionsOverride,
  id,
  value,
  onChange,
}: ControlProps) {
  const { options, loading } = useResourceOptions({
    resourceKey: field.refResource,
    refFilter: field.refFilter,
    scopeNamespace,
    excludeName: field.excludeSelf ? currentId : undefined,
    referrerKey: resourceKey,
    badgeOf: field.refBadges,
  });
  // 已选标签的角标：选项里有这条才有行数据，取不到的（停用、手输）不带。
  const badges = useMemo(() => badgeMapOf(options), [options]);
  const candidates = useMemo(() => {
    const base = optionsOverride ?? options;
    if (!field.wildcard) return base;
    return [{ value: WILDCARD, label: field.wildcard.label }, ...base];
  }, [field.wildcard, options, optionsOverride]);
  const handleChange = (next: string[]) => {
    const picked = (value as string[] | undefined) ?? [];
    onChange?.(wildcardAwareChange(Boolean(field.wildcard), picked, next));
  };
  return (
    <Select
      id={id}
      mode={field.allowCustom ? 'tags' : 'multiple'}
      disabled={disabled}
      showSearch
      {...refOptionProps(field)}
      {...(field.refBadges ? { labelRender: refLabelRender(badges) } : {})}
      loading={loading}
      options={candidates}
      value={value as string[] | undefined}
      onChange={handleChange}
      maxCount={field.maxCount}
      placeholder={field.placeholder ?? '从已有资源中选择，或回车输入'}
    />
  );
}

/** 一个 MCP 暴露的工具；描述可缺省（服务端没给或为空串）。 */
interface McpTool {
  name: string;
  description?: string;
}

/** MCP 行上的工具列表：后端把 `status.tools` 投影成 `tools`。 */
function toolsFromRow(row: Record<string, unknown>): McpTool[] {
  if (!Array.isArray(row.tools)) return [];
  const seen = new Set<string>();
  const tools: McpTool[] = [];
  for (const item of row.tools) {
    const record = (item ?? {}) as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    tools.push(description ? { name, description } : { name });
  }
  return tools;
}

/** 表单里的模式值（精确名 / 通配）→ 去空后的字符串数组。 */
function patternsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

/** 已选 MCP 的分组：行、可用工具、服务端已强制审批的工具。 */
interface ApprovalToolGroup {
  value: string;
  label: string;
  row?: Record<string, unknown>;
  /** MCP 资源自身处于停用状态（工具仍展示，便于保留已有配置）。 */
  rowDisabled: boolean;
  tools: McpTool[];
  /** MCP 自己的 `spec.requireApprovals` 命中的工具名，仅作提示。 */
  serverGated: Set<string>;
}

/**
 * 「需审批的工具」：从「能力设置」已选的 MCP 里取工具，按 MCP 分组列出
 * 「工具名 + 工具描述」。
 *
 * - 候选只包含 MCP 的 `allowedTools` 允许的工具（为空=全部）：给一个永远不会
 *   被提供的工具配置审批没有意义。
 * - 值仍是 `string[]`，历史里的 `delete_*` / `*` 等手写模式原样保留在下方
 *   「手动添加模式」里，不会被列表覆盖。
 * - 行上的 `tools` 来自控制面 `status.tools`（上一次成功探测），因此打开页面
 *   不会重新拨号；某个 MCP 还没探测过时，可用组内「重新探测」按钮现场拨号。
 */
function ApprovalToolsControl({ field, disabled, id, value, onChange }: ControlProps) {
  const form = Form.useFormInstance();
  const sourceField = field.toolsField ?? 'spec.mcps';
  const watched = Form.useWatch(sourceField.split('.'), form) as unknown;
  const selected = useMemo(() => patternsOf(watched), [watched]);

  // 与 MCP 选择器共用 `['res','mcps','all']` 缓存：上一分区打开过下拉时不会重复请求。
  const { data: rows = [] } = useResourceRows('mcps');

  /** 本次页面会话里现场探测到的工具；只用于展示，不写回记录。 */
  const [probed, setProbed] = useState<Record<string, McpTool[]>>({});
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [probeErrors, setProbeErrors] = useState<Record<string, string>>({});

  // 选择值可能是裸名或「空间/名称」，两种都映射到同一行。
  const byValue = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const name = String(row.name ?? '');
      if (!name) continue;
      map.set(name, row);
      const namespace = typeof row.namespace === 'string' ? row.namespace : '';
      if (namespace) map.set(`${namespace}/${name}`, row);
    }
    return map;
  }, [rows]);

  const groups = useMemo<ApprovalToolGroup[]>(
    () =>
      selected.map(item => {
        const row = byValue.get(item);
        if (!row) {
          return {
            value: item,
            label: item,
            rowDisabled: false,
            tools: [],
            serverGated: new Set<string>(),
          };
        }
        const allowed = patternsOf(row.allowedTools);
        const serverPatterns = patternsOf(row.requireApprovals);
        const tools = (probed[item] ?? toolsFromRow(row)).filter(
          tool =>
            allowed.length === 0 || allowed.some(pattern => matchesToolPattern(tool.name, pattern))
        );
        const serverGated = new Set(
          tools
            .filter(tool => serverPatterns.some(pattern => matchesToolPattern(tool.name, pattern)))
            .map(tool => tool.name)
        );
        const displayName =
          typeof row.displayName === 'string' && row.displayName ? row.displayName : item;
        return {
          value: item,
          label: displayName === item ? item : `${displayName}（${item}）`,
          row,
          rowDisabled: row.status === 'disabled',
          tools,
          serverGated,
        };
      }),
    [selected, byValue, probed]
  );

  const universe = useMemo(
    () => new Set(groups.flatMap(group => group.tools.map(tool => tool.name))),
    [groups]
  );
  const current = useMemo(() => patternsOf(value), [value]);
  const checkedNames = useMemo(
    () => new Set(current.filter(name => universe.has(name))),
    [current, universe]
  );
  const manual = useMemo(() => current.filter(name => !universe.has(name)), [current, universe]);

  /**
   * 已选 MCP 变化后，把「曾属于某个 MCP、现在不再属于任何已选 MCP」的值清掉，
   * 避免它们伪装成手写模式；从未出现在发现结果里的 `delete_*` / `*` 永远保留。
   *
   * 只在**选择本身**变化时裁剪：
   * - 行还没读到、或有已选 MCP 解析不出行时不下结论，否则一次读取失败就会把
   *   用户已选的工具全删掉；
   * - 选择没变（只是后台刷新了 `status.tools`）时不裁剪，团队改了 MCP 的工具
   *   列表不应该悄悄删掉这里已经配好的审批规则。
   */
  const knownTools = useRef<Set<string>>(new Set());
  const lastSelection = useRef<string | null>(null);
  const selectionSignature = useMemo(() => [...selected].sort().join('\u0000'), [selected]);
  useEffect(() => {
    if (rows.length === 0) return;
    if (selected.length > 0 && groups.some(group => !group.row)) return;

    // 第一次观察到这批 MCP（包含编辑页回填）：只记录全集，不裁剪。
    if (lastSelection.current === null) {
      lastSelection.current = selectionSignature;
      knownTools.current = new Set(universe);
      return;
    }
    if (lastSelection.current === selectionSignature) {
      for (const name of universe) knownTools.current.add(name);
      return;
    }

    const previous = knownTools.current;
    lastSelection.current = selectionSignature;
    knownTools.current = new Set(universe);
    // 已选 MCP 全部移除时 universe 为空，只留下从未被发现过的手写模式。
    const next = current.filter(name => !previous.has(name) || universe.has(name));
    if (next.length !== current.length) onChange?.(next);
  }, [selectionSignature, rows.length, groups, universe, current, onChange]);

  const toggle = (name: string, next: boolean) => {
    if (next) {
      if (!current.includes(name)) onChange?.([...current, name]);
      return;
    }
    onChange?.(current.filter(item => item !== name));
  };

  /** 手写模式只替换「不在发现结果里」的那部分，勾选值保持不动。 */
  const updateManual = (next: string[]) => {
    const merged: string[] = [];
    for (const item of [...current.filter(name => universe.has(name)), ...next]) {
      const text = item.trim();
      if (text && !merged.includes(text)) merged.push(text);
    }
    onChange?.(merged);
  };

  const probe = async (group: ApprovalToolGroup) => {
    const row = group.row;
    if (!row) return;
    const key = group.value;
    setProbing(state => ({ ...state, [key]: true }));
    setProbeErrors(state => {
      const next = { ...state };
      delete next[key];
      return next;
    });
    try {
      const result = await testMcp({
        mcp: {
          name: String(row.name ?? ''),
          protocol: row.protocol,
          url: row.url,
          headers: row.headers,
        },
      });
      if (result.ok === true) {
        setProbed(state => ({
          ...state,
          [key]: (result.tools ?? []).map(tool => ({
            name: tool.name,
            description: tool.description?.trim() || undefined,
          })),
        }));
      } else {
        setProbeErrors(state => ({
          ...state,
          [key]: result.message?.trim() || '连接失败',
        }));
      }
    } catch (err) {
      setProbeErrors(state => ({
        ...state,
        [key]: err instanceof Error && err.message.trim() ? err.message.trim() : '请求失败',
      }));
    } finally {
      setProbing(state => {
        const next = { ...state };
        delete next[key];
        return next;
      });
    }
  };

  return (
    <div className={styles.approvalTools}>
      {selected.length === 0 ? (
        <Alert
          type="info"
          showIcon
          title="先在「能力设置」中选择 MCP，这里会列出它们暴露的工具。"
        />
      ) : (
        <div className={styles.approvalGroups}>
          {groups.map(group => (
            <div key={group.value} className={styles.approvalGroup}>
              <div className={styles.approvalGroupHead}>
                <span className={styles.approvalGroupName}>
                  {group.label}
                  {group.rowDisabled ? <Tag className={styles.approvalTag}>停用</Tag> : null}
                </span>
                <Button
                  size="small"
                  type="link"
                  icon={<ReloadOutlined />}
                  loading={Boolean(probing[group.value])}
                  disabled={disabled || !group.row}
                  onClick={() => void probe(group)}
                >
                  重新探测
                </Button>
              </div>
              {!group.row ? (
                <div className={styles.approvalEmpty}>
                  找不到这个 MCP（可能已被删除），请重新选择。
                </div>
              ) : group.tools.length === 0 ? (
                <div className={styles.approvalEmpty}>
                  尚未发现工具。可在 MCP 页面测试连接，或点「重新探测」。
                </div>
              ) : (
                group.tools.map(tool => (
                  <Checkbox
                    key={tool.name}
                    className={styles.approvalToolRow}
                    disabled={disabled}
                    checked={checkedNames.has(tool.name)}
                    onChange={event => toggle(tool.name, event.target.checked)}
                  >
                    <span className={styles.approvalToolText}>
                      <span className={styles.approvalToolName}>{tool.name}</span>
                      {group.serverGated.has(tool.name) ? (
                        <Tag color="orange" className={styles.approvalTag}>
                          MCP 已要求
                        </Tag>
                      ) : null}
                      {tool.description ? (
                        <span className={styles.approvalToolDesc}>{tool.description}</span>
                      ) : null}
                    </span>
                  </Checkbox>
                ))
              )}
              {probeErrors[group.value] ? (
                <div className={styles.approvalError}>探测失败：{probeErrors[group.value]}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/*
        手动模式与 MCP 选择无关：清空 MCP 后这些值仍然生效，必须让人看得见、
        改得动，而不是跟着工具列表一起消失。
      */}
      <div className={styles.approvalManual}>
        <span className={styles.approvalManualLabel}>手动添加模式</span>
        <Select
          id={id}
          className={styles.approvalManualSelect}
          mode="tags"
          disabled={disabled}
          value={manual}
          onChange={next => updateManual((next as string[]).map(String))}
          placeholder="输入 delete_* 或 * 后回车"
        />
      </div>
    </div>
  );
}

/**
 * 命令候选：`label` 用于搜索，`primary` 是下拉第一列与已选标签的短名。
 *
 * `label` 里拼上描述后，`optionFilterProp="label"` 就能同时命中命令名与描述；
 * 视觉上由 `optionRender` 分两栏渲染，已选标签由 `tagRender` 用值到短名的
 * Map 还原，避免把整段描述塞进标签。
 */
interface CommandOption extends SelectOption {
  primary: string;
  /** 分组候选的 group key（`group:` 前缀的值才有）。 */
  group?: string;
}

function toCommandOption(option: SelectOption, value = option.value): CommandOption {
  const description = option.description;
  return {
    value,
    primary: option.label,
    ...(description ? { description } : {}),
    label: description ? `${option.label} ${description}` : option.label,
  };
}

/**
 * 「命令」：自定义命令引用 + 内置命令目录 + 手输，合成一个多选。
 *
 * 自定义命令的候选值加 `custom:` 前缀，与内置命令（bind、skill:<名字>…）区分；
 * 提交时由 `form-model.normalizeSubmit` 按前缀拆回 `spec.customCommands` 与
 * `spec.commands`。内置命令目录来自 `/v1/chat/commands`，停用的不出现。
 */
/**
 * 把命令目录聚合成「按命令分组」候选。
 *
 * 分组来自每个 Command 的 `group`（等价于 `agent.onexstack.io/group` 标签），
 * 计数只算启用的命令：勾选「值班 (11)」前就知道会授予多少条。空分组不出现，
 * 因为它按下去什么也授不了。
 */
function commandGroupOptionsOf(rows: Record<string, unknown>[]): CommandOption[] {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.enabled === false) continue;
    const name = String(row.name ?? '');
    if (!name) continue;
    const labels = row.labels as Record<string, string> | undefined;
    const group = String(row.group ?? labels?.[COMMAND_GROUP_LABEL_KEY] ?? '');
    if (!group) continue;
    const members = groups.get(group) ?? new Set<string>();
    members.add(name);
    groups.set(group, members);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => compareCommandGroups(a, b))
    .map(([group, members]) => ({
      value: `${COMMAND_GROUP_PREFIX}${group}`,
      primary: `${commandGroupLabel(group)} (${members.size})`,
      label: `${commandGroupLabel(group)} (${members.size})`,
      group,
    }));
}

function CommandsControl({
  field,
  disabled,
  scopeNamespace,
  resourceKey,
  id,
  value,
  onChange,
}: ControlProps) {
  const custom = useResourceOptions({
    resourceKey: field.refResource,
    refFilter: field.refFilter,
    scopeNamespace,
    referrerKey: resourceKey,
  });
  const builtin = useResourceOptions({
    resourceKey: 'chat-commands',
    refFilter: row => row.enabled !== false,
  });
  // 同一个 query key，不会额外请求；分组需要行上的 `group`，而下拉候选只保留
  // 了名称与描述。
  const commandRows = useResourceRows('chat-commands');

  const { options, tagLabels } = useMemo(() => {
    const groupOptions = field.commandSelectorField
      ? commandGroupOptionsOf(commandRows.data ?? [])
      : [];
    const customOptions = custom.options.map(option =>
      toCommandOption(option, `${CUSTOM_COMMAND_PREFIX}${option.value}`)
    );
    const builtinOptions = builtin.options.map(option => toCommandOption(option));

    // `tagRender` 拿不到原始 option：用值到短名的映射还原标签文案。
    const tagLabels = new Map<string, string>();
    for (const option of [...customOptions, ...builtinOptions]) {
      tagLabels.set(option.value, option.primary);
    }
    for (const option of groupOptions) {
      tagLabels.set(option.value, commandGroupTagLabel(option.group ?? ''));
    }

    return {
      options: [
        // 分组排在最前：一次勾选覆盖整组，是这类绑定最常见的操作。
        ...(groupOptions.length > 0 ? [{ label: '按命令分组', options: groupOptions }] : []),
        { label: '自定义命令', options: customOptions },
        { label: '内置命令', options: builtinOptions },
      ],
      tagLabels,
    };
  }, [custom.options, builtin.options, commandRows.data, field.commandSelectorField]);

  return (
    <Select
      id={id}
      mode="tags"
      disabled={disabled}
      showSearch
      optionFilterProp="label"
      loading={custom.loading || builtin.loading || commandRows.isLoading}
      options={options}
      value={value as string[] | undefined}
      onChange={onChange}
      placeholder={field.placeholder ?? '选择命令分组/自定义命令/内置命令，或回车输入命令名'}
      // 只改视觉：第一列命令名，第二列描述（次要色、单行省略）。
      optionRender={option => {
        // rc-select 把原始候选放在 `.data`；tags 模式动态生成的「新建」项
        // 没有这些字段，回退到 value。
        const data = option.data as Partial<CommandOption>;
        const primary = data.primary ?? String(option.value ?? '');
        const description = data.description;
        if (!description) {
          return primary;
        }
        return (
          <span className={styles.commandOption}>
            <span className={styles.commandOptionName}>{primary}</span>{' '}
            <span className={styles.commandOptionDesc} title={description}>
              {description}
            </span>
          </span>
        );
      }}
      // 候选值带 `custom:` 前缀用于区分来源；标签上只显示短名，不显示描述。
      tagRender={({ label, value: itemValue, closable, onClose }) => {
        const raw = String(itemValue ?? label ?? '');
        const text =
          tagLabels.get(raw) ??
          (raw.startsWith(CUSTOM_COMMAND_PREFIX) ? raw.slice(CUSTOM_COMMAND_PREFIX.length) : raw);
        return (
          <Tag
            closable={closable}
            onClose={onClose}
            style={{ marginInlineEnd: 4, marginTop: 2, marginBottom: 2 }}
          >
            {text}
          </Tag>
        );
      }}
    />
  );
}

/** 命名空间：候选 + 手输（新命名空间不必等后端收录）。 */
function NamespaceControl({ field, disabled, id, value, onChange }: ControlProps) {
  const { options, loading } = useNamespaceOptions({
    includeSystem: field.includeSystemNamespaces,
  });
  return (
    <AutoComplete
      id={id}
      disabled={disabled}
      allowClear
      options={options}
      value={value as string | undefined}
      onChange={onChange}
      placeholder={field.placeholder ?? '从已有命名空间中选择，或直接输入'}
      notFoundContent={loading ? '加载中…' : '没有候选，可直接输入'}
      filterOption={(input, option) =>
        String(option?.value ?? '')
          .toLowerCase()
          .includes(input.toLowerCase())
      }
    />
  );
}

/**
 * 命名空间多选：候选来自命名空间列表，同时保留回车自由输入。
 *
 * 用于「目标命名空间」这类受众字段：它们引用的是别的空间，候选必须与普通
 * 资源归属字段区分开（后者只让选业务空间）。
 */
function NamespaceTagsControl({
  field,
  disabled,
  id,
  value,
  onChange,
  optionsOverride,
}: ControlProps) {
  const { options, loading } = useNamespaceOptions({
    includeSystem: field.includeSystemNamespaces,
  });
  const candidates = useMemo(() => {
    const base = optionsOverride ?? options;
    if (!field.wildcard) return base;
    return [{ value: WILDCARD, label: field.wildcard.label }, ...base];
  }, [field.wildcard, options, optionsOverride]);

  const handleChange = (next: string[]) => {
    const picked = (value as string[] | undefined) ?? [];
    onChange?.(wildcardAwareChange(Boolean(field.wildcard), picked, next));
  };

  return (
    <Select
      id={id}
      mode="tags"
      disabled={disabled}
      loading={loading}
      options={candidates}
      value={value as string[] | undefined}
      onChange={handleChange}
      placeholder={field.placeholder ?? '从已有命名空间中选择，或回车输入'}
      notFoundContent={loading ? '加载中…' : '没有候选，可直接输入'}
      optionFilterProp="label"
    />
  );
}

/** 授权后端：线上是 JSON 数组字符串，多选后由表单序列化。 */
function AuthzBackendControl({ disabled, id, value, onChange }: ControlProps) {
  const { options, loading } = useAuthzBackendOptions();
  const selected = Array.isArray(value) ? value.map(String) : [];
  return (
    <Select
      id={id}
      mode="multiple"
      disabled={disabled}
      showSearch
      optionFilterProp="label"
      loading={loading}
      options={options}
      value={selected}
      onChange={next => onChange?.(reconcileAuthzBackends(selected, next))}
      placeholder={authzBackendsPlaceholder(options, loading)}
      // 候选就是部署里注册的后端全集：手输不存在的名字只会被后端跳过并回退到
      // 部署默认，等于把「收窄」做成了「不生效」，所以这里不允许自定义值。
      notFoundContent={loading ? '加载中…' : '部署未启用可选的授权后端'}
    />
  );
}

/** 标签数量上限：与火山引擎标签设置一致，最多 20 个。 */
const MAX_LABELS = 20;

let labelRowSeq = 0;
function newLabelRowId(): string {
  labelRowSeq += 1;
  return `label-row-${labelRowSeq}`;
}

/** 一行标签：键、值各占一个下拉框。 */
interface LabelRow {
  id: string;
  key: string;
  value: string;
}

/** 表单里的 `k=v` 数组 → 可编辑的行；键为空的不算标签。 */
function rowsFromTags(tags: unknown): LabelRow[] {
  if (!Array.isArray(tags)) return [];
  const rows: LabelRow[] = [];
  for (const item of tags) {
    const text = String(item);
    const at = text.indexOf('=');
    const key = at > 0 ? text.slice(0, at) : at === -1 ? text : '';
    if (!key) continue;
    rows.push({ id: newLabelRowId(), key, value: at > 0 ? text.slice(at + 1) : '' });
  }
  return rows;
}

/** 行 → 表单里的 `k=v` 数组；还没填键的空行丢弃。 */
function tagsFromRows(rows: LabelRow[]): string[] {
  return rows.filter(row => row.key.trim() !== '').map(row => `${row.key.trim()}=${row.value}`);
}

/**
 * 下拉候选：历史值里筛出包含输入文字的项；输入的文字本身也作为候选，
 * 选中即「创建一个新的键 / 值」—— 火山引擎的标签下拉就是这个行为。
 */
function labelOptions(
  candidates: string[],
  draft: string,
  isDisabled?: (value: string) => boolean
): SelectOption[] {
  const text = draft.trim();
  const search = text.toLowerCase();
  const matched = search
    ? candidates.filter(candidate => candidate.toLowerCase().includes(search))
    : candidates;
  const options = matched.map(value => ({
    value,
    label: value,
    disabled: isDisabled?.(value),
  }));
  if (text && !candidates.includes(text)) {
    options.unshift({ value: text, label: text, disabled: isDisabled?.(text) });
  }
  return options;
}

/**
 * 标签：一行一个键值对，键与值都可从历史值里选，也可直接输入。
 *
 * 表单值仍是 `k=v` 数组（见 `form-model`），这里只负责在「键 / 值两列
 * 可编辑行」与它之间转换。版式对齐火山引擎：每行左侧键、中间值、右侧删除，
 * 下方是「添加标签」与剩余可添加数量。
 */
function LabelsControl({ resourceKey, disabled, id, value, onChange }: ControlProps) {
  const { options: history, loading } = useLabelOptions(resourceKey);
  const incoming = useMemo(() => (Array.isArray(value) ? value.map(String) : []), [value]);
  const [rows, setRows] = useState<LabelRow[]>(() => rowsFromTags(incoming));
  /** 下拉里正在输入、还没被选中的文字（按行保存）。 */
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [valueDraft, setValueDraft] = useState<Record<string, string>>({});

  // 表单值被外部改写（读取记录、重置表单）时以表单为准。比较的是两边
  // 序列化后的标签：自己编辑产生的回写与本地行等价，不会把还没填完的空行冲掉。
  useEffect(() => {
    if (
      JSON.stringify(tagsFromRows(rowsFromTags(incoming))) !== JSON.stringify(tagsFromRows(rows))
    ) {
      setRows(rowsFromTags(incoming));
    }
  }, [incoming, rows]);

  // 历史标签是 `k=v`：键给「标签键」当候选，同一个键的历史值给「标签值」当候选。
  const historyKeys: string[] = [];
  const historyValues = new Map<string, string[]>();
  for (const option of history) {
    const at = option.value.indexOf('=');
    if (at <= 0) continue;
    const key = option.value.slice(0, at);
    const labelValue = option.value.slice(at + 1);
    if (!historyKeys.includes(key)) historyKeys.push(key);
    const values = historyValues.get(key) ?? [];
    if (!values.includes(labelValue)) values.push(labelValue);
    historyValues.set(key, values);
  }

  const commit = (next: LabelRow[]) => {
    setRows(next);
    onChange?.(tagsFromRows(next));
  };

  const updateRow = (rowId: string, patch: Partial<Pick<LabelRow, 'key' | 'value'>>) => {
    commit(rows.map(row => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const removeRow = (rowId: string) => {
    commit(rows.filter(row => row.id !== rowId));
  };

  const addRow = () => {
    if (rows.length >= MAX_LABELS) return;
    setRows([...rows, { id: newLabelRowId(), key: '', value: '' }]);
  };

  const usedKeys = new Set(rows.map(row => row.key).filter(Boolean));
  const atLimit = rows.length >= MAX_LABELS;
  const remaining = Math.max(MAX_LABELS - rows.length, 0);

  return (
    <div className={styles.labels}>
      {rows.map((row, index) => (
        <div className={styles.labelRow} key={row.id}>
          <Select
            // Form.Item 的 label 用 id 关联控件，只给第一行的键下拉。
            id={index === 0 ? id : undefined}
            className={styles.labelSelect}
            disabled={disabled}
            allowClear
            showSearch
            filterOption={false}
            loading={loading}
            options={labelOptions(
              historyKeys,
              keyDraft[row.id] ?? '',
              key => key !== row.key && usedKeys.has(key)
            )}
            aria-label="标签键"
            value={row.key || undefined}
            onSearch={text => setKeyDraft(draft => ({ ...draft, [row.id]: text }))}
            onBlur={() => {
              // 延后一拍清空：点击下拉项时 blur 可能先到，立刻清空会把
              // 刚输入的文字对应的候选一起撤掉，点选就落空了。
              window.setTimeout(() => setKeyDraft(draft => ({ ...draft, [row.id]: '' })), 0);
            }}
            onChange={next => updateRow(row.id, { key: String(next ?? '') })}
            notFoundContent={loading ? '加载中…' : '输入后按回车创建'}
          />
          <Select
            className={styles.labelSelect}
            disabled={disabled}
            allowClear
            showSearch
            filterOption={false}
            options={labelOptions(historyValues.get(row.key) ?? [], valueDraft[row.id] ?? '')}
            aria-label="标签值"
            value={row.value || undefined}
            onSearch={text => setValueDraft(draft => ({ ...draft, [row.id]: text }))}
            onBlur={() => {
              window.setTimeout(() => setValueDraft(draft => ({ ...draft, [row.id]: '' })), 0);
            }}
            onChange={next => updateRow(row.id, { value: String(next ?? '') })}
            notFoundContent="输入后按回车创建"
          />
          <button
            type="button"
            className={styles.labelDelete}
            disabled={disabled}
            title="删除标签"
            aria-label="删除标签"
            onClick={() => removeRow(row.id)}
          >
            <DeleteIcon />
          </button>
        </div>
      ))}
      <div className={styles.labelFooter}>
        <button
          type="button"
          className={styles.addLabel}
          disabled={disabled || atLimit}
          onClick={addRow}
        >
          <span className={styles.addLabelIcon} aria-hidden>
            <PlusOutlined />
          </span>
          添加标签
        </button>
        <span className={styles.labelDivider} aria-hidden />
        <span className={styles.labelRemaining}>
          {atLimit ? (
            <>已达到上限 {MAX_LABELS} 个</>
          ) : (
            <>
              还可以添加 <strong>{remaining}</strong> 个
            </>
          )}
        </span>
      </div>
    </div>
  );
}
