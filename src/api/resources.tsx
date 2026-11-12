import type { ReactNode } from 'react';
import { Tag } from 'antd';
import type { SessionClaims } from '@/auth/claims';
import type { ClientConfigFormOptions } from '@/components/ClientConfigForm/value';
import ClientConfigSummary from '@/components/ClientConfigForm/summary';
import { RefValueBadges } from '@/components/ResourceForm/refBadges';
import { UserRef } from '@/components/UserRef';
import { findForeignAgentRef } from '@/lib/agent-refs';
import { formatDate } from '@/lib/date';
import { validateGrantPayload } from '@/lib/reference-grant';
import { localTimeZone, timeZoneLabel } from '@/lib/timezone';
import { ValueWithActions } from '@/ui/components/DetailPage';
import StatusSwitch, { isSwitchOn } from '@/ui/components/StatusSwitch';
import type { ProTableColumn, ResourceApiShape, ResourceDescriptor, SwitchMapping } from '@/ui';

import {
  oncallGroupBinding,
  platformResourceBindings,
  ticketBinding,
  type ResourceBinding,
} from './onexai';
import { revealModelAPIKey, revealSecretKey } from './resourceDefs';
import { normalizeAgentSubmit } from './agentA2A';
import { validateCustomCommand } from './customCommandValidation';

/**
 * 资源的目录：每个键一份「列表怎么显示、详情怎么分组、能不能写」的描述。
 *
 * 19 类资源的列表页与详情页结构完全相同，差别只在字段。手写 19 套页面会得到
 * 18 份几乎一样的 JSX，而它们的差异（哪些字段、哪些分组、能不能编辑）本来就是
 * 数据。页面因此只有两个（ResourceList / ResourceDetail），差异全在这里。
 *
 * 非字段的交互（生效能力、执行记录、审计、调用、预览、测试连接）不进这里：
 * 它们在 `catalog/extras.tsx` 的页签注册表里，因为那些要发请求。
 */

/**
 * 字段类型：决定详情页怎么渲染、表单用什么控件。
 *
 * `tags` 与 `refs` 都是字符串列表，控件也相同；分开是因为**渲染要区别对待**：
 * `refs` 里以 `@` 开头的项是运行时求值的引用，不是名字。
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  /** Markdown 正文：表单为 bytemd 编辑器（编辑 + 预览），线上仍是字符串。 */
  | 'markdown'
  | 'number'
  | 'switch'
  | 'select'
  /** 分段选择（少量互斥选项，如智能体类型）。 */
  | 'segmented'
  | 'tags'
  /**
   * 勾选列表：线上是 `string[]`，候选来自 `options`（固定枚举，不允许手输）。
   *
   * 与 `tags` 的区别是取值必须从列表里勾：表单画成横排 `Checkbox`（选项可带
   * `description`，窄屏自动换行），列表/详情/确认页显示选项文案（见
   * `fieldOptionLabel`），而 `tags` 是自由输入、原样展示。
   */
  | 'checklist'
  | 'labels'
  /** 单个引用（字符串）：模型、智能体、凭据等，下拉候选来自 `refResource`。 */
  | 'ref'
  /**
   * Webhook 鉴权：不鉴权 / 填写令牌 / 引用 Secret 三选一。
   *
   * 表单值是 `{ mode, token, secretRef }`，提交时拆回顶层 `secretRef` 与
   * write-only 的 `authToken`（见 `authTokenField`）；详情页读到的仍是记录里的
   * `secretRef` 字符串。
   */
  | 'webhookAuth'
  /** 多个引用（字符串数组）：候选来自 `refResource`。 */
  | 'refs'
  /**
   * 需审批的工具：值仍是 `string[]`，但候选不是资源，而是 `toolsField`
   * （如 `spec.mcps`）里已选 MCP 暴露的工具。控件按 MCP 分组列出「工具名 +
   * 描述」，并保留手写通配模式（`delete_*`、`*`）的入口。
   */
  | 'approvalTools'
  /**
   * 「命令」：把一个引用字段（如 `spec.customCommands`）、一个字符串数组字段
   * （如 `spec.commands`）和可选的命令标签选择器（`spec.commandSelector`）合并成
   * 一个多选控件。值里 `custom:` 开头的是自定义命令引用，`group:` 开头的是整组
   * 命令（写回 selector），其余是内置命令名；提交时由 `form-model` 拆回三个线上
   * 字段。
   */
  | 'commands'
  /** 线上是 JSON 数组字符串（如 `authzBackends`）：多选，提交时序列化。 */
  | 'jsonList'
  /** 线上是「一个 JSON 字符串」的字段（如 params、headers、spec）：校验语法后原样发送。 */
  | 'json'
  /** 线上是结构化 JSON 值的字段（如绑定引用数组、命令定义）：校验后解析再发送。 */
  | 'jsonValue'
  /**
   * 第三方端点配置（`ClientConfig`，形状即 Kubernetes `WebhookClientConfig`）。
   *
   * 线上是对象，表单是结构化控件：URL / Service 二选一，CA、超时、请求头、
   * 凭据与「跳过 TLS 校验」各自成项。与 `jsonValue` 的差别只在控件，提交路径一致。
   */
  | 'clientConfig'
  /**
   * 平台用户 ID：展示时解析为用户名，解析不到原样显示 ID；表单从平台用户目录
   * 搜索选择并写入账号 ID，目录不可用（非管理员）时退化为文本输入。
   */
  | 'user'
  | 'datetime'
  | 'password'
  /** IANA 时区：表单为可搜索下拉，候选来自运行环境（见 `@/lib/timezone`）。 */
  | 'timezone';

/**
 * 表单里把「自定义命令引用」和「普通命令」放在同一个控件时，前者用这个前缀标记。
 *
 * 命令名是 DNS 名（不允许 `:`），所以普通命令不可能以 `custom:` 开头，拆分是
 * 无歧义的；保存时 `form-model` 负责把前缀去掉并写回两个线上字段。
 */
export const CUSTOM_COMMAND_PREFIX = 'custom:';

/** 一条字段条件：`field` 的当前值必须命中 `equals`。 */
export interface FieldCondition {
  field: string;
  equals: string | string[];
}

/** 任意一个子条件满足即可（OR）；子条件内部仍按 AND/OR 规则求值。 */
export interface AnyCondition {
  any: Condition[];
}

/**
 * 字段/页签的显示条件。
 *
 * 单条件直接写；多个条件写成数组，数组内是 **AND**，`equals` 数组内是 **OR**；
 * 需要跨字段 OR 时用 `{ any: [...] }`（例如“native 或 source=runtime”）。
 * 条件只描述“是否显示”，同一份条件在表单、详情和提交裁剪三处共用，避免三套
 * 判断互相漂移。
 */
export type Condition = FieldCondition | FieldCondition[] | AnyCondition;

/** 表单下拉的一个候选项。 */
export interface FieldOption {
  label: string;
  value: string;
  /**
   * 候选的说明文字（如 MCP 工具的简介）。
   *
   * 下拉里画成「名称 + 说明」两行并参与搜索，但已选标签只显示名称：
   * 描述是选之前用来判断的，选完之后是噪音。
   */
  description?: string;
  /**
   * 品牌图标键（如 `openai`、`ark`）。由 `ProviderIcon` 解析成 SVG；
   * 保持字符串而不是 ReactNode，描述符仍然是纯数据。
   */
  icon?: string;
}

/**
 * 引用项上的附加标签。
 *
 * 给「同类资源、不同行为」的引用用：Webhook 只看名字分不出这条钩子是在 run
 * 开始前把关（OnStart），还是结束后只做通知（OnEnd），选错就直接影响运行能否
 * 被拒绝。标签来自被引用资源的整行，选值仍是名称。
 */
export interface FieldBadge {
  label: string;
  /** antd Tag 的颜色；不填用默认灰色。 */
  color?: string;
}

/** 一个字段的描述。 */
/**
 * 表单控件右侧的附加动作。
 *
 * 描述符保持纯数据，这里只放动作标识；具体按钮/抽屉由 `StaticControl` 按标识
 * 渲染，避免通用表单层按资源 key 硬编码分支。
 */
export type FieldAction = 'reference-grant-generator';

export interface FieldSpec {
  /**
   * 字段路径。支持 `a.b` 读取嵌套值（如 `spec.enabled`、`status.matchedAgents`），
   * 因为智能体绑定与智能体模版的线上形状是嵌套对象，而表单是扁平的。
   */
  key: string;
  label: string;
  kind?: FieldKind;
  /** 表单控件右侧的动作入口（目前只有引用授权的可视化生成器）。 */
  action?: FieldAction;
  /** 只读：详情页不给编辑入口，表单里也不出现。 */
  readOnly?: boolean;
  /**
   * 仅当条件满足时渲染/提交（详情页同样适用）。
   *
   * 隐藏字段的值不会进入提交体；编辑时 `normalizeSubmit` 会把记录里回灌的同名字段
   * 覆盖成 `undefined`，避免“切了类型但旧值还在”的脏提交。
   */
  when?: Condition;
  /**
   * 仅表单：放进“高级设置”折叠区。
   *
   * 详情页忽略这个标记，照常平铺展示。
   */
  advanced?: boolean;
  /**
   * 详情页支持单字段内联编辑：点行尾铅笔、就地改、保存只写这一个字段。
   *
   * 写入仍走「读整行 → 合并改动 → 整行写回」，所以嵌套字段（`spec.enabled`）
   * 不要开这个开关：浅合并会覆盖父对象里的其余字段。
   */
  inlineEdit?: boolean;
  /** 状态类字段的取值 → 文案（同时给出列表里 Tag 的颜色）。 */
  valueEnum?: Record<string, { text: string; color?: string }>;
  /** 列表里是否作为一列显示。 */
  column?: boolean;
  /** 详情页这一行下面的一句提示。 */
  note?: string;
  /** 表单：是否必填。 */
  required?: boolean;
  /**
   * 表单：仅**新建**时必填，编辑时留空表示保留原值（如轮换用的 `apiKey`）。
   */
  requiredOnCreate?: boolean;
  /**
   * 表单：仅当另一个字段满足条件时必填（如 mode=tool 要求 entrypoint）。
   * 服务端仍然执行同样的校验；这里只做提前提示。
   */
  requiredWhen?: {
    field: string;
    equals: string | string[];
    message?: string;
    /**
     * 只在新建时必填。给写-only 字段用（如 A2A 凭据）：编辑时服务端不回显
     * 明文，留空表示保持原值，不能因此挡住保存。
     */
    createOnly?: boolean;
  };
  /**
   * 编辑时记录里的值为空也套用 `defaultValue`。
   *
   * 只给「空值与默认值语义等价」的枚举字段用（如执行方式空=inproc、鉴权类型
   * 空=none）。普通字段不要开：编辑应以记录为准，空就是没配置。
   */
  defaultWhenEmpty?: boolean;
  /** 多选控件最多能选几项（仅表单）。 */
  maxCount?: number;
  /** 引用候选里排除当前记录自身（仅编辑时有效，如委派不能选自己）。 */
  excludeSelf?: boolean;
  /** 表单 select 的选项（与 valueEnum 二选一）。 */
  options?: FieldOption[];
  /** 表单 refs 的候选来源：另一类资源的键（agents/skills/…）。 */
  refResource?: string;
  /**
   * `kind: 'approvalTools'` 的 MCP 来源字段（如 `spec.mcps`）。
   *
   * 控件读取该字段当前选中的 MCP 行，把行上的 `tools`（工具名 + 描述）列成
   * 勾选列表；未在候选里的历史值按手写模式保留。
   */
  toolsField?: string;
  /**
   * `kind: 'commands'` 的普通命令字段路径（如 `spec.commands`）。
   *
   * 表单把 `key`（引用数组，如 `spec.customCommands`）和这个字段合并成一个
   * 多选控件；提交时按 `custom:` 前缀拆分回两个线上字段。
   */
  commandsField?: string;
  /**
   * `kind: 'commands'` 的命令标签选择器路径（如 `spec.commandSelector`）。
   *
   * 控件在这里额外提供「按命令分组」候选（`group:<key>`），提交时写回
   * Kubernetes LabelSelector。与 `commandsField` 是并集：名字是钉子，分组
   * 跟随目录，两者可以同时存在。见 `@/lib/command-groups`。
   */
  commandSelectorField?: string;
  /**
   * 线上形状。`object` 表示引用是 `[{name}]`（智能体绑定的 spec.prompts 等），
   * 表单里按名称编辑，提交时包回对象；默认为裸名称字符串。
   */
  refShape?: 'name' | 'object';
  /**
   * 引用候选过滤：返回 false 的行不进入下拉候选。
   *
   * 只影响**可选项**，不影响已保存的值 —— 记录里已有的引用仍会作为标签显示，
   * 用户可以移除它，但不能重新选回被过滤掉的候选。
   */
  refFilter?: (row: Record<string, unknown>) => boolean;
  /**
   * 引用项的附加标签，按被引用资源的整行生成（如 Webhook 的 `events`）。
   *
   * 只影响展示：候选下拉、已选标签、详情页和确认页都带上它；提交的仍是名称。
   * 取不到行数据的项（已停用、手输的 `none`）不显示标签。
   */
  refBadges?: (row: Record<string, unknown>) => FieldBadge[];
  /**
   * 没有独立资源列表的字段的候选来源：
   * - `namespaces`：`GET /v1/agent/namespaces`
   * - `authzBackends`：`GET /v1/authz/backends`
   * - `labels`：从已有资源的 labels 汇总 k=v 建议
   */
  optionsSource?: 'namespaces' | 'authzBackends' | 'labels';
  /**
   * 命名空间候选里补上系统空间 `default`。
   *
   * 业务资源的新建空间不该出现 `default`；引用授权是例外：内置 Agent 住在
   * `default`，grant 的引用方/目标都可能指向它。
   */
  includeSystemNamespaces?: boolean;
  /**
   * 多选控件里额外提供 `*`（全部）候选；`label` 是它在表单与已选标签上的文案。
   *
   * 值固定为 `*`，控件负责让它与具体项互斥：选 `*` 时清空其余，已选 `*` 时
   * 再选具体项则移除 `*`。命名空间（`spec.namespaces`）和集群级绑定的智能体
   * 列表都用它表达「包括以后新建的」这种受众。
   */
  wildcard?: { label: string };
  /** 下拉候选之外允许手输（提供方、命名空间、标签）。 */
  allowCustom?: boolean;
  placeholder?: string;
  /** 多行文本/JSON 输入框的行数；不填用控件默认值。 */
  rows?: number;
  /**
   * 表单：控件占满整行可用宽度。
   *
   * 给 URL、模板这类长内容用；详情页忽略。移动端仍是垂直布局，不受影响。
   */
  wide?: boolean;
  /** 多行文本用等宽字体（模板、JSON 片段）。 */
  monospace?: boolean;
  /**
   * `kind: 'webhookAuth'` 提交时明文令牌要写入的字段名（write-only）。
   *
   * 默认 `authToken`；显式声明是为了让描述符读起来就知道线上有两个字段。
   */
  authTokenField?: string;
  /**
   * `kind: 'clientConfig'` 的字段级选项（连接方式、超时、凭据、折叠）。
   *
   * 不填保持 ClientConfigForm 的完整形态；Webhook 用它收起 Service、超时和凭据。
   */
  clientConfigOptions?: ClientConfigFormOptions;
  /** 表单里字段下方的一行说明（火山引擎表单样式：小灰字 + 信息图标）。 */
  help?: string;
  /**
   * 把 `help` 收进字段名右侧的问号（`FieldHint`），而不是铺在输入框下方。
   *
   * 给说明较长、且只在第一次配置时需要读的字段用（如 API Key）。
   */
  helpInTooltip?: boolean;
  /**
   * 列表/详情这一列支持复制。缺省按字段名 `/Id$|_id$|ID$/` 推导；显式 `false`
   * 可以关掉自动推导。
   */
  copyable?: boolean;
  /** 数字字段在界面上的单位（如「秒」）；保存时由表单换算。 */
  unit?: string;
  /** 文本/多行文本的最大长度；同时在输入框内显示字数统计。 */
  maxLength?: number;
  /** 显式开启字数统计（仅在需要 `0/30` 这种样式时使用）。 */
  showCount?: boolean;
  /**
   * `kind: 'switch'` 的线上取值映射。缺省是布尔 `true` / `false`；
   * 状态类字段写 `switchOn: 'enabled'`、`switchOff: 'disabled'`。
   */
  switchOn?: string | boolean;
  switchOff?: string | boolean;
  /** 空值（后端未设置）是否视为「开」；状态字段默认开（后端未显式停用即启用）。 */
  switchDefaultOn?: boolean;
  /** 开关旁的开 / 关文案（如「启用 / 停用」「是 / 否」）。 */
  switchOnLabel?: string;
  switchOffLabel?: string;
  /**
   * 在列表/详情切换这个开关时先弹二次确认。
   *
   * 只影响列表与详情页的即时切换，不影响表单里的正常编辑。
   */
  switchConfirm?: boolean;
  /** 新建时的默认值；编辑时始终使用记录值。 */
  defaultValue?: string | number | boolean;
  /** 数字字段的最小值：同时约束 InputNumber 与表单校验。 */
  min?: number;
  /** 数字字段的最大值：同时约束 InputNumber 与表单校验。 */
  max?: number;
  /**
   * 数字字段的步进（InputNumber 上下箭头与键盘调整）。
   *
   * 0–1 的比例（相似度阈值、最低分）用 0.05：不传时 antd 默认 1，
   * 从 0.2 点一下箭头就会跳到 1.2 再被 max 夹住，等于只能手输。
   */
  step?: number;
  /** 文本字段的正则校验（资源名要符合 K8s DNS 规范时使用）。 */
  pattern?: RegExp;
  /** `pattern` 不匹配时的提示。 */
  patternMessage?: string;
  /**
   * 仅详情页生效：这个字段的明文只能按需取回（密钥类字段）。
   *
   * `Get` / `List` 永远不带明文；给了它，详情页渲染固定掩码 +「查看」眼睛 +
   * 复制按钮，第一次点「查看」时才发一次请求，明文只活在组件内存里。
   * 表单仍按 `kind` 渲染（`password` 输入框），两者互不影响。
   */
  reveal?: {
    /** 按记录取回明文；空串是服务端「无法还原」的真实答案。 */
    load: (record: Record<string, unknown>) => Promise<string>;
    /** 该记录是否真的有一个值（如模型的 `hasAPIKey`）；缺省 true。 */
    present?: (record: Record<string, unknown>) => boolean;
    /** 当前用户是否可查看；缺省 true。服务端仍做最终校验。 */
    allowed?: (record: Record<string, unknown>, claims: SessionClaims | null) => boolean;
    /** 服务端返回空串时的解释。 */
    unavailableHint?: string;
    /** 无权查看时的解释。 */
    restrictedHint?: string;
  };
}

/** 详情页的一个页签。 */
export interface DetailTabSpec {
  key: string;
  label: string;
  /** 这一组展示的字段；缺省表示展示全部（按 fields 顺序）。 */
  fields?: string[];
  /** 该页签顶部的一段说明。 */
  note?: string;
  /** 仅当条件满足时显示（详情页与新建/编辑页共用）。 */
  when?: Condition;
  /**
   * 仅表单：在这个分区挂一个自定义面板。
   *
   * 详情页忽略。`a2a-preview` 挂在字段之后；`webhook-template-help` 挂在字段
   * 之前（先看变量说明，再写模板）。
   */
  formExtra?: 'a2a-preview' | 'webhook-template-help';
}

/** 一份资源的完整描述。 */
export interface ResourceSpec {
  /** 路由段，同时也是绑定的键。 */
  key: string;
  /** 页面标题与菜单文案。 */
  title: string;
  idKey: string;
  /** 主键的中文名（弹窗文案用）。 */
  name: string;
  idLabel: string;
  /**
   * 列表 ID/名称 单元格第二行显示的字段（悬停可改名）。
   *
   * 缺省由 `descriptorOf` 推导：`idKey === 'name'` 且有顶层 `displayName` 时取
   * `displayName`。显式声明可以覆盖推导结果。
   */
  nameField?: string;
  binding: ResourceBinding<Record<string, unknown>>;
  timestamps?: { createdAt: string; updatedAt: string };
  fields: FieldSpec[];
  tabs: DetailTabSpec[];
  /** 表单里可填的字段（创建/编辑弹窗），按 fields 顺序取。 */
  formFields?: string[];
  /**
   * 新建时由当前登录用户自动补齐的字段，表单里不渲染。
   *
   * 例如模型的 `owner`：归属就是创建人，前端不该要求用户手输自己的
   * 平台用户 ID。编辑时不动这些字段（服务端保留原值）。
   */
  creatorFields?: string[];
  /**
   * 由页头当前业务空间自动补齐的字段，表单里不渲染。
   *
   * 新建与编辑都生效；页头为「全部空间」（空字符串）时不写入，
   * 新建保持服务端默认、编辑由 deepMerge 保留记录里的原 namespace。
   */
  namespaceField?: string;
  /**
   * 写操作（新建/编辑/删除）仅对管理员展示。服务端仍做最终校验；这里只决定
   * 入口是否出现，避免普通用户点进去才收到 403。
   */
  adminOnlyWrite?: boolean;
  /**
   * 提交前的领域派生/裁剪。
   *
   * 在 `normalizeSubmit` 之后、create / `deepMerge(record, values)` 之前执行。
   * 编辑路径会从记录回灌未提交的字段，所以这里清字段要写 `undefined` 自有属性，
   * 不能 `delete`；容器（如 `execution.a2a`）也要显式置 `undefined`。
   */
  submitTransform?: (
    values: Record<string, unknown>,
    ctx: { isCreate: boolean; record: Record<string, unknown> | null }
  ) => void;
  /**
   * 提交前的跨字段校验。返回问题则阻断保存；`field` 用于切到出错分区。
   *
   * 服务端仍是权威；这里只提前拦截确定性的结构/模板错误。
   */
  submitValidate?: (
    values: Record<string, unknown>,
    ctx: { isCreate: boolean; record: Record<string, unknown> | null }
  ) => { field?: string; message: string } | null;
}

// ─── 取值渲染 ────────────────────────────────────────────────────────────────

/** 按 `a.b.c` 读嵌套值；段为空时返回 undefined。 */
export function valueAt(record: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return record[path];
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, record);
}

/** 把单条件/AND 条件数组统一成数组；OR 组由 `conditionMatches` 单独处理。 */
function conditionList(when: Condition | undefined): FieldCondition[] {
  if (!when || (!Array.isArray(when) && 'any' in when)) return [];
  return Array.isArray(when) ? when : [when];
}

/**
 * 条件是否满足。
 *
 * `read` 而不是记录本身，是为了让表单页用“表单值 + 记录兜底”的自定义读取，
 * 详情页直接用 `valueAt(record, path)`；两处共享同一套匹配规则。
 */
export function conditionMatches(
  when: Condition | undefined,
  read: (path: string) => unknown
): boolean {
  if (!when) return true;
  if (!Array.isArray(when) && 'any' in when) {
    return when.any.some(condition => conditionMatches(condition, read));
  }
  return conditionList(when).every(condition => {
    const actual = read(condition.field);
    const accepted = Array.isArray(condition.equals) ? condition.equals : [condition.equals];
    return accepted.includes(String(actual ?? ''));
  });
}

/** 一份资源里所有条件依赖的字段路径（去重），供表单页只订阅这些值。 */
export function conditionFieldsOf(spec: ResourceSpec): string[] {
  const paths = new Set<string>();
  const add = (when: Condition | undefined) => {
    if (!when) return;
    if (!Array.isArray(when) && 'any' in when) {
      for (const condition of when.any) add(condition);
      return;
    }
    for (const condition of conditionList(when)) paths.add(condition.field);
  };
  for (const tab of spec.tabs) add(tab.when);
  for (const field of spec.fields) add(field.when);
  return [...paths];
}

/**
 * 引用在线上是 `{name, namespace?}`。展示时带上空间前缀（同空间只显示名字），
 * 否则对象会被渲染成 `[object Object]`，跨空间引用也看不出区别。
 */
function referenceName(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const name = record.name;
    const namespace = record.namespace;
    const kind = record.kind;
    // ReferenceGrant 的 from/to 带 kind：from 是 kind/namespace，to 是
    // kind/name（name 为空表示全部）。没有这段会退化成 [object Object]。
    if (kind !== undefined) {
      const kindText = String(kind);
      if (namespace !== undefined && namespace !== '') return `${kindText}/${String(namespace)}`;
      if (name !== undefined) return `${kindText}/${String(name || '*')}`;
      return `${kindText}/*`;
    }
    if (name !== undefined) {
      return namespace ? `${String(namespace)}/${String(name)}` : String(name);
    }
  }
  return String(value);
}

/**
 * 数组字段单项的展示文案。
 *
 * `checklist` 的线上值是固定枚举（如 `onStart`），展示时换成选项文案（如
 * `OnStart`）——用户认的是事件含义，接收方认的才是 wire 取值；其余 kind
 * 沿用 `referenceName`，对象引用取名称。
 */
export function fieldOptionLabel(spec: FieldSpec, item: unknown): string {
  // 「全部」通配项在列表/详情里显示控件上的完整文案，而不是孤零零的 `*`。
  if (spec.wildcard && item === '*') return spec.wildcard.label;
  if (spec.kind === 'checklist') {
    const value = typeof item === 'string' ? item : String(item);
    return spec.options?.find(option => option.value === value)?.label ?? value;
  }
  return referenceName(item);
}

/**
 * 把一个字段值渲染出来。
 *
 * 列表的一格与详情的一行共用它：两处对「空值显示什么」「数组怎么显示」「状态
 * 用什么颜色」必须给出同一个答案，各写一份就会在某个字段上分叉。
 */
export function renderFieldValue(spec: FieldSpec, value: unknown): ReactNode {
  // 开关字段即使空值也要画出来：它表达的是「开 / 关」两个状态，不是「没有值」。
  if (spec.kind === 'switch') {
    return (
      <StatusSwitch
        checked={isSwitchOn(switchMappingOf(spec), value)}
        onLabel={spec.switchOnLabel ?? '是'}
        offLabel={spec.switchOffLabel ?? '否'}
        disabled
      />
    );
  }
  // 鉴权的线上值只有一个引用字符串；空值本身是「不鉴权」，与普通字段的「-」
  // 语义不同，所以放在空值判断之前。
  if (spec.kind === 'webhookAuth') {
    return value ? <Tag color="blue">{String(value)}</Tag> : <Tag>不鉴权</Tag>;
  }
  if (value === undefined || value === null || value === '') return <span>-</span>;
  if (spec.kind === 'clientConfig') {
    return <ClientConfigSummary value={value as never} />;
  }
  // 用户 ID 走目录解析；目录缺失（非管理员、接口失败）时 UserRef 自己回落到 ID。
  if (spec.kind === 'user') return <UserRef id={String(value)} />;
  // 时间字段：声明式资源给 unix 毫秒，chat 的工单给 RFC3339 字符串。两种都交给
  // `formatDate`（dayjs）—— 但数字字符串要先转成数字，否则会被当成日期字面量。
  if (spec.kind === 'datetime') {
    const numeric = typeof value === 'number' ? value : Number(value);
    const isNumeric =
      typeof value === 'number' ||
      (typeof value === 'string' && value.trim() !== '' && Number.isFinite(numeric));
    // 0 是「没有时间」（暂停的任务、还没触发过），不是 1970-01-01。
    if (isNumeric && numeric <= 0) return <span>-</span>;
    return <span>{formatDate(isNumeric ? numeric : String(value))}</span>;
  }
  if (spec.kind === 'timezone') {
    return <span>{timeZoneLabel(String(value))}</span>;
  }
  if (spec.valueEnum) {
    const mapped = spec.valueEnum[String(value)];
    const text = mapped?.text ?? String(value);
    return <Tag color={mapped?.color}>{text}</Tag>;
  }
  if (Array.isArray(value)) {
    const list = value as unknown[];
    if (list.length === 0) return <span>-</span>;
    const isRef = spec.kind === 'refs';
    return (
      <span>
        {list.slice(0, 2).map((item, index) => {
          const text = fieldOptionLabel(spec, item);
          const ref = isRef && text.startsWith('@');
          return (
            <Tag key={`${text}-${index}`} color={ref ? 'blue' : undefined}>
              {ref ? `${text}（引用）` : text}
              {/* 引用分不出行为时（Webhook 的 OnStart/OnEnd）补一行角标。 */}
              {spec.refBadges ? <RefValueBadges field={spec} value={item} /> : null}
            </Tag>
          );
        })}
        {list.length > 2 && <span>{`+${list.length - 2}`}</span>}
      </span>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span>-</span>;
    // 单个引用在线上是 `{name}`；直接展示名称，而不是 `name=xxx`。
    if (entries.length === 1 && entries[0]?.[0] === 'name') {
      return <Tag>{referenceName(value)}</Tag>;
    }
    return (
      <span>
        {entries.map(([k, v]) => (
          <Tag key={k}>{`${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`}</Tag>
        ))}
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

/** 状态枚举：agent 资源统一用 enabled/disabled。 */
export const STATUS_ENUM = {
  enabled: { text: '启用', color: 'green' },
  disabled: { text: '停用', color: 'default' },
};

/**
 * 智能体执行方式：列表、详情页与监控抽屉共用同一套文案与颜色。
 *
 * 表单下拉仍用 `execution.mode` 字段自己的 `options`（带 inproc/a2a 原文的详细
 * 文案）——`ResourceForm` 的取值顺序是 `options` 优先，`valueEnum` 只负责展示。
 */
export const EXECUTION_MODE_ENUM = {
  inproc: { text: '内置', color: 'default' },
  a2a: { text: 'A2A', color: 'cyan' },
};

/** 把字段上的开关取值映射收成渲染组件/列表列共用的形状。 */
export function switchMappingOf(spec: FieldSpec): SwitchMapping {
  return {
    onValue: spec.switchOn,
    offValue: spec.switchOff,
    defaultOn: spec.switchDefaultOn,
  };
}

/**
 * 平台里所有 `status` 字段的统一描述：开关、开 = enabled、关 = disabled。
 *
 * 空值按「启用」处理：后端只在显式停用时输出 `disabled`，大量内建资源的
 * `status` 是空串——空不等于停用。
 */
export function statusField(overrides: Partial<FieldSpec> = {}): FieldSpec {
  return {
    key: 'status',
    label: '状态',
    column: true,
    kind: 'switch',
    switchOn: 'enabled',
    switchOff: 'disabled',
    switchDefaultOn: true,
    switchOnLabel: '启用',
    switchOffLabel: '停用',
    ...overrides,
  };
}

/** 工单状态。 */
const TICKET_STATUS_ENUM = {
  open: { text: '待处理', color: 'red' },
  processing: { text: '处理中', color: 'blue' },
  saved: { text: '已挂起', color: 'orange' },
  resolved: { text: '已解决', color: 'green' },
  closed: { text: '已关闭', color: 'default' },
};

/** 实体化状态（定时执行的 state）。 */
const EXECUTION_STATE_ENUM = {
  pending: { text: '等待中', color: 'gold' },
  running: { text: '运行中', color: 'blue' },
  completed: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'red' },
  canceled: { text: '已取消', color: 'default' },
};

/**
 * 这一列要复制的原始值。
 *
 * 规则与详情页一致：显式声明 `copyable`，或字段名是 `datasetId` / `secretID`
 * 这类标识。只接受非空字符串——数字、数组、空值都没有「复制」的语义。
 */
export function copyableValueOf(field: FieldSpec, raw: unknown): string | undefined {
  if (field.copyable === false) return undefined;
  if (typeof raw !== 'string' || raw === '') return undefined;
  if (field.copyable === true || /Id$|_id$|ID$/.test(field.key)) return raw;
  return undefined;
}

/** 把一个字段描述变成列表列。 */
function columnOf(spec: FieldSpec): ProTableColumn<Record<string, unknown>> {
  // 可写的开关字段在列表里可以直接点；嵌套 key（如 spec.enabled）同样支持，
  // 写通路按点路径只改这一个字段，不会覆盖父对象里的其余字段。
  const interactive = spec.kind === 'switch' && !spec.readOnly;
  return {
    title: spec.label,
    dataIndex: spec.key,
    key: spec.key,
    render: (_: unknown, record: Record<string, unknown>) => {
      const raw = valueAt(record, spec.key);
      const value = renderFieldValue(spec, raw);
      const copyable = copyableValueOf(spec, raw);
      if (!copyable) return value;
      return (
        <ValueWithActions
          value={value}
          rawValue={copyable}
          copyable
          revealActionsOnHover
          copyAriaLabel={`复制${spec.label}`}
        />
      );
    },
    ...(interactive
      ? {
          switchField: {
            key: spec.key,
            onValue: spec.switchOn,
            offValue: spec.switchOff,
            defaultOn: spec.switchDefaultOn,
            onLabel: spec.switchOnLabel ?? '是',
            offLabel: spec.switchOffLabel ?? '否',
            confirm: spec.switchConfirm,
          },
        }
      : {}),
  };
}

/**
 * 列表 ID/名称单元格第二行显示哪个字段。
 *
 * 只对**顶层** `displayName` 生效：嵌套字段（如 `spec.displayName`）的改名走
 * 整行浅合并会覆盖父对象，不能开这条路。
 */
function nameFieldOf(spec: ResourceSpec): string | undefined {
  if (spec.nameField) return spec.nameField;
  if (spec.idKey !== 'name') return undefined;
  return spec.fields.some(field => field.key === 'displayName') ? 'displayName' : undefined;
}

/**
 * 由字段描述装配一个 `ResourceDescriptor`。
 *
 * `creatable: false` 对所有资源成立：框架自带的「新建」无参无表单，入口由列表页
 * 自备。删除则由绑定是否提供 `remove` 决定。
 */
function descriptorOf(
  spec: ResourceSpec
): ResourceDescriptor<Record<string, unknown>, ResourceApiShape<Record<string, unknown>>> {
  const nameField = nameFieldOf(spec);
  return {
    idKey: spec.idKey,
    title: spec.title,
    name: spec.name,
    idLabel: spec.idLabel,
    ...(nameField && spec.binding.api.update ? { nameField } : {}),
    api: spec.binding.api,
    ...(spec.timestamps && { timestamps: spec.timestamps }),
    creatable: false,
    viewToggle: false,
    // 显示名已经合并进 ID/名称单元格第二行，不再单独成列。这里统一剔除而不是
    // 逐个 spec 去删 `column: true`，新增资源也不会漏。
    extraColumns: spec.fields
      .filter(field => field.column && field.key !== nameField)
      .map(columnOf),
    // 列表适配器会先取全量再本地分页，所以搜索必须走 api.list 的 `search`：
    // 让 ResourcePage 在**当前页**里再筛一遍会得到「只有这一页有结果」的假象。
    serverSearch: true,
    searchFields: [
      { key: 'name', label: '名称' },
      { key: 'displayName', label: '显示名' },
      { key: 'description', label: '描述' },
    ],
    defaultSearchField: 'name',
  };
}

function bind(key: string): ResourceBinding<Record<string, unknown>> {
  const binding = platformResourceBindings[key];
  if (!binding) throw new Error(`缺少资源绑定：${key}`);
  return binding;
}

/**
 * 控制器为每个智能体派生的 `aggregated-<agent>` Prompt 是派生资源，
 * 被显式引用时会被判为 missing，因此不作为任何引用字段的候选。
 */
function isSelectablePrompt(row: Record<string, unknown>): boolean {
  return !String(row.name ?? '').startsWith('aggregated-');
}

/** 资源名/命名空间名：Kubernetes DNS-1123 子域名。 */
const DNS_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** 调度表达式：正好 5 个空白分隔字段（分 时 日 月 周）。完整语法由后端校验。 */
const CRON_FIVE_FIELDS = /^\s*\S+(\s+\S+){4}\s*$/;

// ─── 智能体 ──────────────────────────────────────────────────────────────────

/**
 * Webhook 选择的前置校验。
 *
 * 后端把「只有一项且为 none」当作整体退出默认钩子（webhook.applyDefault）；
 * `none` 与其他钩子混选时它只是一条不存在的钩子名——看起来配了却毫无作用，
 * 所以在提交前拦住。
 */
function validateAgentWebhooks(values: Record<string, unknown>): {
  field?: string;
  message: string;
} | null {
  const names = Array.isArray(values.webhooks) ? values.webhooks.map(String) : [];
  if (names.includes('none') && names.length > 1) {
    return {
      field: 'webhooks',
      message: '「none」表示退出部署默认钩子，不能与其他 Webhook 同时选择',
    };
  }
  return null;
}

/**
 * Agent 提交前的确定性校验。
 *
 * 管理面只接受本地引用；这里先把跨空间引用翻译成可定位的字段错误，顺序在
 * webhook 规则之前（引用错误影响面更大）。
 */
function validateAgentSubmit(values: Record<string, unknown>): {
  field?: string;
  message: string;
} | null {
  return findForeignAgentRef(values) ?? validateAgentWebhooks(values);
}

const AGENTS: ResourceSpec = {
  key: 'agents',
  title: '智能体',
  idKey: 'name',
  name: '智能体',
  idLabel: '名称',
  binding: bind('agents'),
  fields: [
    {
      key: 'name',
      label: '名称',
      readOnly: true,
      maxLength: 253,
      pattern: DNS_NAME_PATTERN,
      patternMessage: '名称需由小写字母、数字、- 和 . 组成，且以字母或数字开头/结尾',
      help: '创建后不可修改。智能创建生成的名称只使用小写字母、数字和 -。',
    },
    { key: 'displayName', label: '显示名', required: true, inlineEdit: true },
    statusField(),
    {
      key: 'model',
      label: '模型',
      column: true,
      kind: 'ref',
      refResource: 'models',
      refShape: 'object',
      placeholder: '留空使用部署默认',
      help: '只能引用本命名空间的 Model；留空使用部署默认。',
      inlineEdit: true,
      // 外部智能体的行为由 AgentCard 定义，模型不在本平台选。
      when: { field: 'kind', equals: ['native', ''] },
    },
    {
      key: 'memoryRef',
      label: '记忆库',
      kind: 'ref',
      refResource: 'memories',
      refShape: 'object',
      advanced: true,
      help: '引用同命名空间的 Memory；留空表示不启用长期记忆。带「跨空间」标记的资源需在「能力编排 → 能力绑定」中引用。',
    },
    { key: 'owner', label: '归属', column: true, kind: 'user' },
    {
      key: 'namespace',
      label: '命名空间',
      column: true,
      optionsSource: 'namespaces',
      allowCustom: true,
      placeholder: '留空使用部署默认',
    },
    { key: 'description', label: '描述', kind: 'textarea', inlineEdit: true },
    {
      key: 'kind',
      // 顶部「创建方式」是手动配置/智能创建；这里选择的是资源类型，两者不能同名。
      label: '智能体类型',
      readOnly: true,
      kind: 'segmented',
      required: true,
      defaultValue: 'native',
      // 历史记录可能没有 kind；详情页按「空=平台」展示，与列表的 agentKind 一致。
      defaultWhenEmpty: true,
      options: [
        { label: '平台智能体', value: 'native' },
        { label: '外部 A2A 智能体', value: 'external' },
      ],
      valueEnum: {
        native: { text: '平台', color: 'blue' },
        external: { text: 'A2A', color: 'purple' },
      },
      help: '平台智能体的行为在本平台定义；外部 A2A 智能体的行为由远端 AgentCard 定义。创建后类型不可修改。',
    },
    {
      key: 'execution.mode',
      label: '执行方式',
      kind: 'select',
      options: [
        { label: '内置运行时（inproc）', value: 'inproc' },
        { label: 'A2A 远端执行（a2a）', value: 'a2a' },
      ],
      // 展示用中文短标签（`options` 优先，表单下拉仍是上面的详细文案）。
      valueEnum: EXECUTION_MODE_ENUM,
      defaultValue: 'inproc',
      defaultWhenEmpty: true,
      when: { field: 'kind', equals: ['native', ''] },
      help: '平台智能体可以交给远端 A2A Runtime 执行；外部 A2A 智能体固定使用 A2A。',
    },
    {
      key: 'execution.a2a.source',
      label: 'A2A 来源',
      kind: 'select',
      required: true,
      defaultValue: 'card-url',
      defaultWhenEmpty: true,
      options: [
        { label: 'AgentCard 地址', value: 'card-url' },
        { label: '导入 JSON', value: 'json' },
        { label: '平台运行时', value: 'runtime' },
        { label: '手动填写', value: 'manual' },
      ],
    },
    {
      key: 'execution.a2a.cardUrl',
      label: 'AgentCard 地址',
      when: { field: 'execution.a2a.source', equals: 'card-url' },
      help: '留空时从服务地址或源站根发现 /.well-known/agent-card.json。',
    },
    {
      key: 'execution.a2a.card',
      label: 'AgentCard JSON',
      kind: 'json',
      when: { field: 'execution.a2a.source', equals: ['json', 'manual'] },
      requiredWhen: {
        field: 'execution.a2a.source',
        equals: 'json',
        message: '请粘贴 AgentCard JSON',
      },
      help: '保存后由控制器同步到远端；手动填写时留空会按名称/服务地址生成一张最小卡片。',
    },
    {
      key: 'execution.a2a.endpoint',
      label: 'A2A 服务地址',
      // native 远端执行用 endpoint 作为 runtime 的替代；外部只在 card-url/manual
      // 来源下需要服务地址；json/runtime 不需要。
      when: {
        any: [
          { field: 'kind', equals: ['native', ''] },
          { field: 'execution.a2a.source', equals: ['card-url', 'manual'] },
        ],
      },
      help: '外部智能体用于发现 AgentCard；native A2A 远端执行时与 Runtime Profile 至少填一个。',
    },
    {
      key: 'execution.a2a.clientConfig',
      label: 'ClientConfig',
      kind: 'clientConfig',
      wide: true,
      help: 'Kubernetes WebhookClientConfig 形状：URL 或 Service 二选一，再叠加 CA / 超时 / 请求头 / 凭据。设置后优先于 A2A 服务地址。',
    },
    {
      key: 'execution.a2a.runtimeRef',
      label: 'Runtime Profile',
      kind: 'ref',
      refResource: 'runtime-profiles',
      when: {
        any: [
          { field: 'kind', equals: ['native', ''] },
          { field: 'execution.a2a.source', equals: 'runtime' },
        ],
      },
      requiredWhen: {
        field: 'execution.a2a.source',
        equals: 'runtime',
        message: '来源为平台运行时时请选择 Runtime Profile',
      },
      help: '远端 A2A Runtime；外部智能体 source=runtime 时必填，native 远端执行时与服务地址至少填一个。',
    },
    {
      key: 'execution.a2a.auth.type',
      label: '鉴权类型',
      kind: 'select',
      options: [
        { label: '无鉴权', value: 'none' },
        { label: 'API Key', value: 'apiKey' },
        { label: 'Bearer Token', value: 'bearer' },
        { label: '自定义请求头', value: 'headers' },
        { label: 'OAuth2 Client Credentials', value: 'oauth2' },
        { label: '使用运行时凭据', value: 'runtime' },
      ],
      defaultValue: 'none',
      defaultWhenEmpty: true,
    },
    {
      key: 'execution.a2a.auth.apiKeyHeader',
      label: 'API Key Header',
      when: { field: 'execution.a2a.auth.type', equals: 'apiKey' },
      placeholder: 'X-API-KEY',
    },
    {
      key: 'execution.a2a.auth.credential',
      label: '凭据（写-only）',
      kind: 'password',
      when: { field: 'execution.a2a.auth.type', equals: ['apiKey', 'bearer', 'headers'] },
      requiredWhen: {
        field: 'execution.a2a.auth.type',
        equals: ['apiKey', 'bearer', 'headers'],
        message: '请填写凭据',
        // 编辑时服务端只回显 hasCredentials，不回显明文；留空表示保持原值。
        createOnly: true,
      },
      help: '留空表示保持原值；切换鉴权类型会整体替换凭据。自定义请求头请填 JSON。',
    },
    {
      key: 'execution.a2a.auth.tokenUrl',
      label: 'OAuth2 Token URL',
      when: { field: 'execution.a2a.auth.type', equals: 'oauth2' },
    },
    {
      key: 'execution.a2a.auth.clientId',
      label: 'OAuth2 Client ID',
      when: { field: 'execution.a2a.auth.type', equals: 'oauth2' },
    },
    {
      key: 'execution.a2a.auth.clientSecret',
      label: 'OAuth2 Client Secret',
      kind: 'password',
      when: { field: 'execution.a2a.auth.type', equals: 'oauth2' },
    },
    {
      key: 'execution.a2a.timeoutSeconds',
      label: '调用超时（秒）',
      kind: 'number',
      min: 1,
      max: 3600,
    },
    {
      key: 'execution.a2a.maxConcurrentInvocations',
      label: '最大并发调用',
      kind: 'number',
      min: 1,
      help: '留空使用部署默认。',
    },
    {
      key: 'contract.allowedSkills',
      label: '允许技能',
      kind: 'tags',
      help: '留空表示允许卡片声明的全部技能。',
    },
    { key: 'contract.inputModes', label: '输入模式', kind: 'tags' },
    { key: 'contract.outputModes', label: '输出模式', kind: 'tags' },
    {
      key: 'sharing.allowedNamespaces',
      label: '允许空间',
      kind: 'tags',
      optionsSource: 'namespaces',
      includeSystemNamespaces: true,
    },
    {
      key: 'delegates',
      label: '子智能体',
      kind: 'refs',
      refResource: 'agents',
      refShape: 'object',
      refFilter: row => row.status !== 'disabled',
      maxCount: 16,
      excludeSelf: true,
      advanced: true,
      inlineEdit: true,
      help: '本智能体可通过 agent_invoke_agent 把任务交给这些智能体：被委派方以独立 run 执行，使用自己的提示词、模型、技能与会话，调用方身份不变。最多 16 个，必须同命名空间；委派深度默认 3 层。',
    },
    {
      key: 'webhooks',
      label: 'Agent Webhook',
      kind: 'refs',
      refResource: 'webhooks',
      // 停用的钩子不会被调用，藏掉避免选中后 “配了却没生效”。
      refFilter: row => row.status !== 'disabled',
      // 名字分不出准入还是通知，选中/候选都带上订阅事件。
      refBadges: webhookEventBadges,
      // 帮助里承诺了「填 none 显式退出默认」（后端 applyDefault 只认单独的
      // none），所以这里必须允许手输；候选之外的钩子名后端会忽略。
      allowCustom: true,
      advanced: true,
      inlineEdit: true,
      help: '运行前后调用的 Webhook：onStart 在 run 开始前同步准入、可拒绝；onEnd 在结束后异步上报用量。留空使用部署默认钩子，填 none 表示显式退出默认。',
    },
    {
      key: 'phase',
      label: 'A2A 状态',
      readOnly: true,
      valueEnum: {
        Pending: { text: '同步中', color: 'blue' },
        Ready: { text: '正常', color: 'green' },
        Degraded: { text: '降级', color: 'orange' },
        Error: { text: '异常', color: 'red' },
        Disabled: { text: '已停用', color: 'default' },
      },
    },
    { key: 'protocolVersion', label: '协议版本', readOnly: true },
    { key: 'transport', label: '传输', readOnly: true },
    { key: 'a2a.cardVersion', label: '卡片版本', readOnly: true },
    { key: 'a2a.lastSyncError', label: '最近同步错误', readOnly: true },
    {
      key: 'templateRefs',
      label: '模版',
      kind: 'refs',
      refResource: 'agent-templates',
      refShape: 'object',
      // 停用的模版不贡献行为；把它藏掉，避免选中后控制器上报 TemplatesApplied=False。
      refFilter: row => row.status !== 'disabled',
      help: '引用的模版会并入本智能体；本智能体显式声明的值与数组靠前的模版优先。模版必须与智能体同命名空间。',
      inlineEdit: true,
    },
    {
      key: 'prompts',
      label: '提示词',
      kind: 'refs',
      refResource: 'prompts',
      refShape: 'object',
      // 控制器为每个智能体生成的 aggregated-<agent> 提示词是派生资源，
      // 不能被显式引用（控制器会把它判为 missing），所以不出现在候选里。
      refFilter: isSelectablePrompt,
      help: '引用 Prompt 资源；内容在「提示词」页维护，运行时会聚合成本智能体的系统提示词。带「跨空间」标记的资源需在「能力编排 → 能力绑定」中引用。',
      inlineEdit: true,
    },
    {
      key: 'skills',
      label: 'Skill',
      kind: 'refs',
      refResource: 'skills',
      refShape: 'object',
      help: '本空间资源可直接引用；带「跨空间」标记的资源需在「能力编排 → 能力绑定」中引用。',
      inlineEdit: true,
    },
    {
      key: 'mcps',
      label: 'MCP',
      kind: 'refs',
      refResource: 'mcps',
      refShape: 'object',
      help: '本空间资源可直接引用；带「跨空间」标记的资源需在「能力编排 → 能力绑定」中引用。',
      inlineEdit: true,
    },
    {
      key: 'knowledgeBases',
      label: '知识库',
      kind: 'refs',
      refResource: 'knowledge-bases',
      refShape: 'object',
      help: '本空间资源可直接引用；带「跨空间」标记的资源需在「能力编排 → 能力绑定」中引用。',
      inlineEdit: true,
    },
    {
      key: 'customCommands',
      label: '自定义命令',
      kind: 'refs',
      refResource: 'custom-commands',
      refShape: 'object',
      advanced: true,
      help: '只能引用本空间资源；跨空间能力请通过能力绑定注入。命令会以命令名作为 MCP tool 暴露，但还需在「MCP」中为该 Agent 绑定提供命令目录的服务（如 oai-chat-apiserver），运行时的工具列表才会包含这些命令。',
      inlineEdit: true,
    },
    {
      key: 'authnWebhooks',
      label: '认证 Webhook',
      kind: 'refs',
      refResource: 'webhooks',
      refFilter: row => String(row.type ?? 'run') === 'authentication',
      advanced: true,
      help: '非空时，调用该 Agent 的 Bearer 凭据只由这些 TokenReview Webhook 认证，平台 JWT/OIDC 不再参与；AK/SK 仍由平台验签。留空使用平台认证。',
      inlineEdit: true,
    },
    {
      key: 'authzWebhooks',
      label: '鉴权 Webhook',
      kind: 'refs',
      refResource: 'webhooks',
      refFilter: row => String(row.type ?? 'run') === 'authorization',
      advanced: true,
      help: '非空时，该 Agent 的授权只由这些 SubjectAccessReview Webhook 决定，平台授权（含授权后端子集）被忽略。留空使用平台授权。',
      inlineEdit: true,
    },
    {
      key: 'authzBackends',
      label: '平台授权后端',
      kind: 'jsonList',
      optionsSource: 'authzBackends',
      // 「鉴权 Webhook」非空时平台授权被整体替代，本项不再生效。
      when: { field: 'authzWebhooks', equals: '' },
      placeholder: '留空使用部署默认（全部已启用的后端）',
      help: '一般不用选：留空时该 Agent 使用部署启用的全部平台授权后端，鉴权照常进行。只有要把它的鉴权收窄到其中几个后端，或选 none 关闭 Agent 级授权时才需要填。填写「鉴权 Webhook」后本项不生效。',
      advanced: true,
      inlineEdit: true,
    },
    {
      key: 'labels',
      label: '标签',
      kind: 'labels',
      optionsSource: 'labels',
      allowCustom: true,
      inlineEdit: true,
    },
    { key: 'createdAt', label: '创建时间', kind: 'datetime', readOnly: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'kind',
        'name',
        'displayName',
        'status',
        'execution.mode',
        'owner',
        'namespace',
        'description',
        // 运行治理都是低频配置，统一收进本分区的「高级设置」折叠区。
        'webhooks',
        'authnWebhooks',
        'authzWebhooks',
        'authzBackends',
        'labels',
        'createdAt',
        'updatedAt',
      ],
    },
    {
      key: 'capabilities',
      label: '能力编排',
      when: { field: 'kind', equals: ['native', ''] },
      fields: [
        'templateRefs',
        'skills',
        'mcps',
        'knowledgeBases',
        'model',
        'prompts',
        'memoryRef',
        'customCommands',
        'delegates',
      ],
    },
    {
      key: 'remote',
      label: '远端执行',
      when: [
        { field: 'kind', equals: ['native', ''] },
        { field: 'execution.mode', equals: 'a2a' },
      ],
      note: '平台智能体的行为仍在本页配置，运行时交给远端 A2A Runtime；这里不设置 AgentCard 来源、契约或共享。',
      fields: [
        'execution.a2a.runtimeRef',
        'execution.a2a.endpoint',
        'execution.a2a.clientConfig',
        'execution.a2a.auth.type',
        'execution.a2a.auth.apiKeyHeader',
        'execution.a2a.auth.credential',
        'execution.a2a.auth.tokenUrl',
        'execution.a2a.auth.clientId',
        'execution.a2a.auth.clientSecret',
        'execution.a2a.timeoutSeconds',
        'execution.a2a.maxConcurrentInvocations',
      ],
    },
    {
      key: 'a2a',
      label: 'A2A 接入',
      when: { field: 'kind', equals: 'external' },
      formExtra: 'a2a-preview',
      note: '外部智能体的行为由远端 AgentCard 定义；平台负责发现、鉴权、调用与观测。',
      fields: [
        'execution.a2a.source',
        'execution.a2a.cardUrl',
        'execution.a2a.card',
        'execution.a2a.endpoint',
        'execution.a2a.clientConfig',
        'execution.a2a.runtimeRef',
        'execution.a2a.auth.type',
        'execution.a2a.auth.apiKeyHeader',
        'execution.a2a.auth.credential',
        'execution.a2a.auth.tokenUrl',
        'execution.a2a.auth.clientId',
        'execution.a2a.auth.clientSecret',
        'execution.a2a.timeoutSeconds',
        'execution.a2a.maxConcurrentInvocations',
        'contract.allowedSkills',
        'contract.inputModes',
        'contract.outputModes',
        'sharing.allowedNamespaces',
      ],
    },
    {
      key: 'a2a-status',
      label: 'A2A 状态',
      when: { field: 'execution.mode', equals: 'a2a' },
      fields: ['phase', 'protocolVersion', 'transport', 'a2a.cardVersion', 'a2a.lastSyncError'],
    },
  ],
  // 归属与命名空间不在表单里：新建时分别由 `creatorFields`（当前登录用户）和
  // `namespaceField`（页头业务空间）补齐，编辑时保留记录原值。
  formFields: [
    'kind',
    'name',
    'displayName',
    'status',
    'memoryRef',
    'description',
    'templateRefs',
    'model',
    'prompts',
    'skills',
    'mcps',
    'knowledgeBases',
    'customCommands',
    // 治理字段同属「基本信息 → 高级设置」，这里按界面顺序排列。
    'webhooks',
    'authnWebhooks',
    'authzWebhooks',
    'authzBackends',
    'delegates',
    'execution.mode',
    'execution.a2a.source',
    'execution.a2a.cardUrl',
    'execution.a2a.card',
    'execution.a2a.endpoint',
    'execution.a2a.clientConfig',
    'execution.a2a.runtimeRef',
    'execution.a2a.auth.type',
    'execution.a2a.auth.apiKeyHeader',
    'execution.a2a.auth.credential',
    'execution.a2a.auth.tokenUrl',
    'execution.a2a.auth.clientId',
    'execution.a2a.auth.clientSecret',
    'execution.a2a.timeoutSeconds',
    'execution.a2a.maxConcurrentInvocations',
    'contract.allowedSkills',
    'contract.inputModes',
    'contract.outputModes',
    'sharing.allowedNamespaces',
    'labels',
  ],
  creatorFields: ['owner'],
  namespaceField: 'namespace',
  submitTransform: normalizeAgentSubmit,
  submitValidate: validateAgentSubmit,
};

/**
 * 模版提交前的确定性校验。
 *
 * 「输出结构」在线上必须是 JSON Schema 对象：后端会用 portable profile 编译，
 * 数组、字符串、数字都会在入库时被拒绝。这里提前拦住，并把用户带到出错的
 * 字段，而不是等保存后只看到一句服务端错误。
 */
function validateAgentTemplate(values: Record<string, unknown>) {
  const schema = valueAt(values, 'spec.outputSchema');
  if (schema === undefined || schema === null) return null;
  if (typeof schema !== 'object' || Array.isArray(schema)) {
    return { field: 'spec.outputSchema', message: '输出结构必须是 JSON 对象（JSON Schema）' };
  }
  return null;
}

const AGENT_TEMPLATES: ResourceSpec = {
  key: 'agent-templates',
  title: '模版管理',
  idKey: 'name',
  name: '模版',
  idLabel: '名称',
  binding: bind('agent-templates'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    { key: 'displayName', label: '显示名', required: true },
    statusField({
      help: '模版的启停开关；保存时写入 spec.enabled。停用的模版不参与 Agent 解析。',
    }),
    {
      key: 'namespace',
      label: '命名空间',
      column: true,
      optionsSource: 'namespaces',
      allowCustom: true,
    },
    { key: 'description', label: '描述', column: true, kind: 'textarea' },

    // ── 行为 ────────────────────────────────────────────────────────────────
    {
      key: 'spec.promptRef.name',
      label: '提示词（兼容字段）',
      readOnly: true,
      note: '旧版单值写法；保存时原样保留。新配置请使用「提示词」。',
    },
    {
      key: 'spec.prompts',
      label: '提示词',
      kind: 'refs',
      refResource: 'prompts',
      refShape: 'object',
      refFilter: isSelectablePrompt,
      help: '控制器会把它们聚合成模版的系统提示词；与 Agent 自身的提示词取并集。最多 16 个。',
    },
    {
      // 单个引用必须落在 `spec.modelRef` 这一层：拆成 `.name` 时，未选择的
      // 空值会留下 `modelRef: {}`，上游按「有引用但没名字」拒绝。
      key: 'spec.modelRef',
      label: '模型',
      kind: 'ref',
      refResource: 'models',
      refShape: 'object',
      help: '仅当引用它的 Agent 自己没有声明模型时生效。',
    },
    {
      key: 'spec.skills',
      label: 'Skill',
      kind: 'refs',
      refResource: 'skills',
      refShape: 'object',
      help: '与 Agent 自身声明的 Skill 取并集。',
    },
    {
      key: 'spec.mcps',
      label: 'MCP',
      kind: 'refs',
      refResource: 'mcps',
      refShape: 'object',
      help: '与 Agent 自身声明的 MCP 取并集。',
    },
    {
      key: 'spec.knowledgeBases',
      label: '知识库',
      kind: 'refs',
      refResource: 'knowledge-bases',
      refShape: 'object',
      help: '与 Agent 自身声明的知识库取并集。',
    },
    {
      key: 'spec.customCommands',
      label: '自定义命令',
      kind: 'refs',
      refResource: 'custom-commands',
      refShape: 'object',
      help: '与 Agent 自身声明的命令取并集。',
    },
    {
      key: 'spec.delegates',
      label: '委派智能体',
      kind: 'refs',
      refResource: 'agents',
      refShape: 'object',
      refFilter: row => row.status !== 'disabled',
      maxCount: 16,
      help: '引用它的 Agent 可以把这些 Agent 当作工具调用；必须同命名空间。',
    },
    {
      key: 'spec.webhooks',
      label: 'Agent Webhook',
      kind: 'refs',
      refResource: 'webhooks',
      refBadges: webhookEventBadges,
      help: '引用模板的 Agent 会把这些运行钩子并入自己；与 Agent 自身声明的钩子取并集。',
    },

    // ── 运行契约 ────────────────────────────────────────────────────────────
    {
      key: 'spec.requireApproval',
      label: '需审批的工具',
      kind: 'approvalTools',
      toolsField: 'spec.mcps',
      help: '从「能力设置」里已选的 MCP 中勾选需要人工审批的工具。模板级、Agent 级、MCP 级与部署默认的审批规则取并集，只能加不能减；需要整类拦截时可手动添加 delete_* 或 *。',
    },
    {
      key: 'spec.outputSchema',
      label: '输出结构（JSON Schema）',
      kind: 'jsonValue',
      rows: 8,
      placeholder:
        '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}',
      help: '用 JSON Schema 约束 Agent 的最终回答：入库时和每次运行结束时都会校验，不匹配则本次运行失败。留空表示不约束输出格式。',
    },
    {
      key: 'spec.outputSchemaStrict',
      label: '严格输出（strict）',
      kind: 'switch',
      switchOnLabel: '开启',
      switchOffLabel: '关闭',
      help: '仅在填写了「输出结构」时生效：要求支持 strict 模式的上游模型按 schema 严格解码；不支持的上游会忽略该标志，网关仍会校验最终回答。',
    },
    {
      key: 'spec.sessionTools',
      label: '会话能力',
      kind: 'switch',
      help: '授予运行读取、续写、分叉调用方会话的能力。',
    },
    {
      key: 'spec.memoryRef',
      label: '记忆库',
      kind: 'ref',
      refResource: 'memories',
      refShape: 'object',
      help: '引用同命名空间的 Memory；留空表示不启用长期记忆。',
    },

    // ── 高级匹配 ────────────────────────────────────────────────────────────
    {
      key: 'spec.promptSelector',
      label: '提示词选择器',
      kind: 'jsonValue',
      help: 'Kubernetes LabelSelector（JSON），如 {"matchLabels":{"team":"sre"}}；留空表示不启用。',
    },
    {
      key: 'spec.skillSelector',
      label: 'Skill 选择器',
      kind: 'jsonValue',
      help: 'Kubernetes LabelSelector（JSON）；留空表示不启用。',
    },
    {
      key: 'spec.mcpSelector',
      label: 'MCP 选择器',
      kind: 'jsonValue',
      help: 'Kubernetes LabelSelector（JSON）；留空表示不启用。',
    },
    {
      key: 'spec.knowledgeBaseSelector',
      label: '知识库选择器',
      kind: 'jsonValue',
      help: 'Kubernetes LabelSelector（JSON）；留空表示不启用。',
    },
    {
      key: 'spec.customCommandSelector',
      label: '命令选择器',
      kind: 'jsonValue',
      help: 'Kubernetes LabelSelector（JSON）；留空表示不启用。',
    },

    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: ['name', 'displayName', 'status', 'namespace', 'description', 'updatedAt'],
    },
    {
      key: 'behavior',
      label: '能力设置',
      fields: [
        'spec.promptRef.name',
        'spec.prompts',
        'spec.modelRef',
        'spec.memoryRef',
        'spec.skills',
        'spec.mcps',
        'spec.knowledgeBases',
        'spec.customCommands',
        'spec.delegates',
        'spec.webhooks',
      ],
    },
    {
      key: 'contract',
      label: '运行契约',
      fields: [
        'spec.requireApproval',
        'spec.outputSchema',
        'spec.outputSchemaStrict',
        'spec.sessionTools',
      ],
    },
    {
      key: 'advanced',
      label: '高级匹配',
      note: '按标签批量匹配资源。留空表示只使用上面显式选择的引用。',
      fields: [
        'spec.promptSelector',
        'spec.skillSelector',
        'spec.mcpSelector',
        'spec.knowledgeBaseSelector',
        'spec.customCommandSelector',
      ],
    },
  ],
  // 命名空间不在表单里：新建时由 `namespaceField`（页头业务空间）补齐，
  // 编辑时保留记录原值。列表列与详情页仍读 `fields` 里的 namespace。
  formFields: [
    'name',
    'displayName',
    'status',
    'description',
    'spec.prompts',
    'spec.modelRef',
    'spec.memoryRef',
    'spec.skills',
    'spec.mcps',
    'spec.knowledgeBases',
    'spec.customCommands',
    'spec.delegates',
    'spec.webhooks',
    'spec.requireApproval',
    'spec.outputSchema',
    'spec.outputSchemaStrict',
    'spec.sessionTools',
    'spec.promptSelector',
    'spec.skillSelector',
    'spec.mcpSelector',
    'spec.knowledgeBaseSelector',
    'spec.customCommandSelector',
  ],
  namespaceField: 'namespace',
  submitValidate: validateAgentTemplate,
};

const AGENT_BINDINGS: ResourceSpec = {
  key: 'agent-bindings',
  title: '能力编排',
  idKey: 'name',
  name: '能力编排',
  idLabel: '名称',
  binding: bind('agent-bindings'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    {
      key: 'namespace',
      label: '命名空间',
      column: true,
      optionsSource: 'namespaces',
      allowCustom: true,
    },
    { key: 'spec.displayName', label: '显示名', column: true, required: true },
    {
      key: 'spec.enabled',
      label: '启用',
      column: true,
      kind: 'switch',
      // 后端 enabled 是 *bool，nil 默认 true（见 pkg/apis/agent/v1alpha1/defaults.go）。
      switchDefaultOn: true,
      switchOnLabel: '启用',
      switchOffLabel: '停用',
      switchConfirm: true,
    },
    {
      key: 'spec.agents',
      label: '智能体',
      kind: 'refs',
      refResource: 'agents',
      column: true,
      help: '无需选择器就能精确命中的智能体；与选择器是并集关系。',
    },
    { key: 'spec.description', label: '描述', kind: 'textarea' },
    {
      key: 'spec.selector.matchExpressions',
      label: '选择器',
      kind: 'jsonValue',
      placeholder: '[{"key":"app","operator":"In","values":["crm"]}]',
      note: 'Kubernetes LabelSelector 的 matchExpressions。',
      help: '按标签批量匹配智能体。operator 可选 In / NotIn / Exists / DoesNotExist；留空表示不使用选择器，只匹配「智能体」里显式指定的智能体。',
    },
    {
      key: 'spec.prompts',
      label: '提示词',
      kind: 'refs',
      refResource: 'prompts',
      refShape: 'object',
      // 控制器为每个智能体生成的 aggregated-<智能体> 提示词是派生资源，
      // 被显式引用时会被判为 missing，所以不出现在候选里。
      refFilter: isSelectablePrompt,
      help: '引用同命名空间下的 Prompt 资源；控制器生成的 aggregated-* 提示词是派生资源，不能显式引用。',
    },
    { key: 'spec.skills', label: 'Skill', kind: 'refs', refResource: 'skills', refShape: 'object' },
    {
      key: 'spec.knowledgeBases',
      label: '知识库',
      kind: 'refs',
      refResource: 'knowledge-bases',
      refShape: 'object',
    },
    { key: 'spec.mcpservers', label: 'MCP', kind: 'refs', refResource: 'mcps', refShape: 'object' },
    {
      key: 'spec.modelRef',
      label: '模型',
      kind: 'ref',
      refResource: 'models',
      refShape: 'object',
      help: '智能体自身和模板都没有指定模型时使用。多个绑定给出不同模型会通过 ModelConflict 条件报告。',
    },
    {
      key: 'spec.customCommands',
      label: '命令',
      kind: 'commands',
      refResource: 'custom-commands',
      // 线上是三个字段：spec.customCommands（CustomCommand 引用）、
      // spec.commands（内置命令名 / skill:<名字>）与 spec.commandSelector
      // （按目录标签批量授予）。表单里合成一个控件，保存时按前缀自动拆分。
      commandsField: 'spec.commands',
      commandSelectorField: 'spec.commandSelector',
      help: '可选择「自定义命令」资源、直接输入内置命令（如 bind）或 skill:<名字>，也可以按「命令分组」整组授予；三者取并集，以后新增到该组的命令自动生效。自定义命令会以命令名作为 MCP tool 暴露，但被授予的 Agent 还需绑定提供命令目录的 MCP Server（如 oai-chat-apiserver）。',
    },
    {
      key: 'status.matchedAgents',
      label: '匹配智能体数',
      kind: 'number',
      readOnly: true,
      column: true,
    },
    { key: 'status.missing', label: '缺失引用', kind: 'tags', readOnly: true, column: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'name',
        'namespace',
        'spec.displayName',
        'spec.enabled',
        'spec.agents',
        'spec.description',
        'spec.selector.matchExpressions',
        'updatedAt',
      ],
    },
    {
      key: 'contribution',
      label: '能力设置',
      fields: [
        'spec.prompts',
        'spec.skills',
        'spec.knowledgeBases',
        'spec.mcpservers',
        'spec.modelRef',
        'spec.customCommands',
      ],
    },
    { key: 'status', label: '生效状态', fields: ['status.matchedAgents', 'status.missing'] },
  ],
  formFields: [
    'name',
    'spec.displayName',
    'spec.enabled',
    'spec.agents',
    'spec.description',
    'spec.selector.matchExpressions',
    'spec.prompts',
    'spec.skills',
    'spec.knowledgeBases',
    'spec.mcpservers',
    'spec.modelRef',
    'spec.customCommands',
  ],
  // 命名空间由页头「业务空间」决定：表单不渲染，新建/编辑提交时自动补齐。
  // 编辑时后端按记录实际所在命名空间写入，不会因为页头选择而搬家。
  namespaceField: 'namespace',
};

/**
 * 平台级能力编排的受众不能为空。
 *
 * 后端要求 `agentSelector` 与 `agents` 至少有一个；表单里 `spec.agents`
 * 为空数组、选择器也没填时提前拦住，并把用户带回受众页签，而不是等保存后
 * 只看到一句服务端错误。
 */
function validateClusterBindingAudience(
  values: Record<string, unknown>
): { field?: string; message: string } | null {
  const spec = (values.spec ?? {}) as Record<string, unknown>;
  const agents = Array.isArray(spec.agents) ? spec.agents : [];
  if (agents.length > 0) return null;

  const selector = (spec.agentSelector ?? {}) as Record<string, unknown>;
  const hasExpressions =
    Array.isArray(selector.matchExpressions) && selector.matchExpressions.length > 0;
  const hasLabels =
    selector.matchLabels !== null &&
    typeof selector.matchLabels === 'object' &&
    !Array.isArray(selector.matchLabels) &&
    Object.keys(selector.matchLabels as Record<string, unknown>).length > 0;
  if (hasExpressions || hasLabels) return null;

  return {
    field: 'spec.agents',
    message: '请至少选择「全部智能体（*）」或点名一个智能体（也可以填写智能体选择器）',
  };
}

/**
 * 平台级能力编排（集群级）。
 *
 * 与「能力编排」的区别只有受众：这里的对象没有命名空间，受众由显式的
 * `spec.namespaces` 列表划定，跨命名空间的引用以 `空间/名称` 表达。
 */
const CLUSTER_AGENT_BINDINGS: ResourceSpec = {
  key: 'cluster-agent-bindings',
  title: '平台能力编排',
  idKey: 'name',
  name: '平台能力编排',
  idLabel: '名称',
  binding: bind('cluster-agent-bindings'),
  // 平台级绑定跨空间生效：后端 Create/Update/Delete 都要求管理员
  // （`requireClusterBindingAdmin`），普通用户只读。
  adminOnlyWrite: true,
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    { key: 'spec.displayName', label: '显示名', column: true, required: true },
    {
      key: 'spec.enabled',
      label: '启用',
      column: true,
      kind: 'switch',
      // 后端 enabled 是 *bool，nil 默认 true（见 pkg/apis/agent/v1alpha1/defaults.go）。
      switchDefaultOn: true,
      switchOnLabel: '启用',
      switchOffLabel: '停用',
      switchConfirm: true,
    },
    {
      key: 'spec.namespaces',
      label: '目标命名空间',
      kind: 'tags',
      column: true,
      optionsSource: 'namespaces',
      includeSystemNamespaces: true,
      wildcard: { label: '全部命名空间（*）' },
      placeholder: '从已有命名空间中选择，或选「全部命名空间（*）」',
      help: '显式列出这条策略可以作用于哪些命名空间。选 * 表示全部命名空间，包括以后新建的；* 必须单独使用。',
    },
    {
      key: 'spec.agents',
      label: '智能体',
      kind: 'refs',
      refResource: 'agents',
      refShape: 'object',
      wildcard: { label: '全部智能体（*）' },
      help: '选「全部智能体（*）」表示目标命名空间内（含以后新建）的全部智能体；也可以精确点名。只能命中上面列出的目标命名空间。',
    },
    {
      key: 'spec.agentSelector.matchExpressions',
      label: '智能体选择器',
      kind: 'jsonValue',
      placeholder: '[{"key":"platform","operator":"In","values":["true"]}]',
      note: 'Kubernetes LabelSelector 的 matchExpressions。',
      help: '在每个目标命名空间内按标签匹配智能体，与上面点名的智能体取并集。选择「全部智能体（*）」时此项不生效。',
    },
    { key: 'spec.description', label: '描述', kind: 'textarea' },
    {
      key: 'spec.prompts',
      label: '提示词',
      kind: 'refs',
      refResource: 'prompts',
      refShape: 'object',
      refFilter: isSelectablePrompt,
      help: '引用任意空间下的 Prompt；集群级绑定由管理员创建，不需要 ReferenceGrant。',
    },
    { key: 'spec.skills', label: 'Skill', kind: 'refs', refResource: 'skills', refShape: 'object' },
    {
      key: 'spec.knowledgeBases',
      label: '知识库',
      kind: 'refs',
      refResource: 'knowledge-bases',
      refShape: 'object',
    },
    { key: 'spec.mcpservers', label: 'MCP', kind: 'refs', refResource: 'mcps', refShape: 'object' },
    {
      key: 'spec.modelRef',
      label: '模型',
      kind: 'ref',
      refResource: 'models',
      refShape: 'object',
      help: '智能体自身和模板都没有指定模型时使用。多个绑定给出不同模型会通过 ModelConflict 条件报告。',
    },
    {
      key: 'spec.customCommands',
      label: '命令',
      kind: 'commands',
      refResource: 'custom-commands',
      commandsField: 'spec.commands',
      commandSelectorField: 'spec.commandSelector',
      help: '自定义命令必须与目标智能体同空间；内置命令按名字授予；也可以按「命令分组」整组授予，以后新增到该组的命令自动生效。自定义命令会以命令名作为 MCP tool 暴露，但 Agent 还需绑定提供命令目录的 MCP Server（如 oai-chat-apiserver）。',
    },
    {
      // 集群级绑定没有「本空间」可回退，记忆库必须显式带空间：候选值统一是
      // `空间/名称`，由一个引用字段整体表达。拆成 name/namespace 两个字段时，
      // 未选择会留下 `memoryRef: {}`，被上游按「有引用但没名字」拒绝。
      key: 'spec.memoryRef',
      label: '记忆库',
      kind: 'ref',
      refResource: 'memories',
      refShape: 'object',
      advanced: true,
      help: '可选。引用任意空间下的记忆库；智能体自身声明的记忆优先，两个绑定给出不同记忆会被判为冲突。',
    },
    {
      key: 'status.matchedNamespaces',
      label: '命中命名空间数',
      kind: 'number',
      readOnly: true,
      column: true,
    },
    {
      key: 'status.matchedAgents',
      label: '命中智能体数',
      kind: 'number',
      readOnly: true,
      column: true,
    },
    { key: 'status.missing', label: '缺失引用', kind: 'tags', readOnly: true, column: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: ['name', 'spec.displayName', 'spec.enabled', 'spec.description', 'updatedAt'],
    },
    {
      key: 'audience',
      label: '受众',
      fields: ['spec.namespaces', 'spec.agents', 'spec.agentSelector.matchExpressions'],
    },
    {
      key: 'contribution',
      label: '贡献内容',
      fields: [
        'spec.prompts',
        'spec.skills',
        'spec.knowledgeBases',
        'spec.mcpservers',
        'spec.modelRef',
        'spec.customCommands',
        'spec.memoryRef',
      ],
    },
    {
      key: 'status',
      label: '生效状态',
      fields: ['status.matchedNamespaces', 'status.matchedAgents', 'status.missing'],
    },
  ],
  formFields: [
    'name',
    'spec.displayName',
    'spec.enabled',
    'spec.namespaces',
    'spec.agents',
    'spec.agentSelector.matchExpressions',
    'spec.description',
    'spec.prompts',
    'spec.skills',
    'spec.knowledgeBases',
    'spec.mcpservers',
    'spec.modelRef',
    'spec.customCommands',
    'spec.memoryRef',
  ],
  submitValidate: validateClusterBindingAudience,
};

// ─── 能力 ────────────────────────────────────────────────────────────────────

const SKILLS: ResourceSpec = {
  key: 'skills',
  title: 'Skill 管理',
  idKey: 'name',
  name: 'Skill',
  idLabel: '名称',
  binding: bind('skills'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    { key: 'displayName', label: '显示名', required: true },
    statusField(),
    {
      key: 'provider',
      label: '提供方',
      column: true,
      valueEnum: {
        github: { text: 'GitHub', color: 'blue' },
        gitlab: { text: 'GitLab', color: 'orange' },
        lark_doc: { text: '飞书文档', color: 'cyan' },
      },
      kind: 'select',
      options: [
        { label: 'GitHub', value: 'github' },
        { label: 'GitLab', value: 'gitlab' },
        { label: '飞书文档', value: 'lark_doc' },
      ],
      help: '决定技能的拉取方式，也决定「提供方参数」的 JSON 形状；切换提供方后请按新形状重填参数。',
    },
    {
      key: 'mode',
      label: '模式',
      column: true,
      kind: 'select',
      defaultValue: 'hosted',
      placeholder: '默认 hosted',
      options: [
        { label: 'hosted（托管，默认）', value: 'hosted' },
        { label: 'tool（工具，执行入口）', value: 'tool' },
        { label: 'guide（指南，仅下发契约）', value: 'guide' },
      ],
      valueEnum: {
        hosted: { text: '托管', color: 'blue' },
        tool: { text: '工具', color: 'green' },
        guide: { text: '指南', color: 'purple' },
      },
      help: 'hosted（默认，留空等同）：完整技能加载到服务端智能体；tool：运行「入口」并只返回结果；guide：只下发「契约」，技能正文留在服务端。mode=tool 必填入口，mode=guide 必填契约。',
    },
    {
      key: 'cacheTtlSeconds',
      label: '缓存 TTL（秒）',
      kind: 'number',
      column: true,
      min: 0,
      help: '技能内容的缓存秒数；0 或留空使用默认的 10 分钟。',
    },
    {
      key: 'asCmd',
      label: '作为命令',
      column: true,
      // 命令入口只会往本轮指令里加一句「请直接使用该技能」，既不执行入口也不下发
      // 契约；只有 hosted（含空 mode）的技能正文会进 prompt，对其它模式没有意义。
      when: { field: 'mode', equals: ['hosted', ''] },
      kind: 'switch',
      switchOn: 'Yes',
      switchOff: '',
      switchDefaultOn: false,
      switchOnLabel: '是',
      switchOffLabel: '否',
      help: '开启后暴露为聊天命令 /<技能名>；关闭时不注册命令。',
    },
    { key: 'namespace', label: '命名空间', optionsSource: 'namespaces', allowCustom: true },
    {
      key: 'contract',
      label: '契约',
      kind: 'textarea',
      when: { field: 'mode', equals: 'guide' },
      requiredWhen: { field: 'mode', equals: 'guide', message: 'mode 为 guide 时必须填写契约' },
      help: 'guide 模式必填：给本地模型判断「何时把任务委派给这个技能」的精简说明（适用场景、输入、输出、验收标准、自检命令）。guide 模式只下发它，技能正文不出服务端。',
    },
    {
      key: 'entrypoint',
      label: '入口',
      when: { field: 'mode', equals: 'tool' },
      requiredWhen: { field: 'mode', equals: 'tool', message: 'mode 为 tool 时必须填写入口' },
      help: 'tool 模式必填：实际执行的入口程序（脚本或命令）。其他模式忽略。',
    },
    {
      key: 'params',
      label: '提供方参数',
      kind: 'json',
      help: 'JSON 对象字符串，形状随提供方变化：github 需要 repo_url（可选 branch、sub_dir）；gitlab 需要 project_path（可选 base_url、branch、sub_dir、token_secret_id）；飞书文档需要 doc_token。优先用 token_secret_id，避免明文 token。guide/tool 读取时该字段为空，留空保存会保留原值。',
    },
    { key: 'description', label: '描述' },
    { key: 'labels', label: '标签', kind: 'labels', optionsSource: 'labels', allowCustom: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'name',
        'displayName',
        'status',
        'provider',
        'mode',
        'cacheTtlSeconds',
        'asCmd',
        'namespace',
        'description',
        'labels',
        'updatedAt',
      ],
    },
    {
      key: 'params',
      label: '提供方参数',
      fields: ['params'],
      note: '各提供方的参数不同（如 GitHub 的 repo_url、GitLab 的 project_path、飞书文档的 doc_token）。',
    },
    // 契约与入口互斥：各自只在对应模式下出现，页签名也就是该步骤的名字。
    {
      key: 'contract',
      label: '委派契约',
      fields: ['contract'],
      when: { field: 'mode', equals: 'guide' },
    },
    {
      key: 'entrypoint',
      label: '执行入口',
      fields: ['entrypoint'],
      when: { field: 'mode', equals: 'tool' },
    },
  ],
  formFields: [
    'name',
    'displayName',
    'status',
    'provider',
    'mode',
    'cacheTtlSeconds',
    'asCmd',
    'description',
    'contract',
    'entrypoint',
    'params',
    'labels',
  ],
  namespaceField: 'namespace',
};

const MCPS: ResourceSpec = {
  key: 'mcps',
  title: 'MCP 管理',
  idKey: 'name',
  name: 'MCP',
  idLabel: '名称',
  binding: bind('mcps'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    { key: 'displayName', label: '显示名', required: true, inlineEdit: true },
    statusField(),
    {
      key: 'protocol',
      label: '协议',
      column: true,
      valueEnum: { SSE: { text: 'SSE', color: 'blue' }, HTTP: { text: 'HTTP', color: 'geekblue' } },
      kind: 'select',
      options: [
        { label: 'SSE', value: 'SSE' },
        { label: 'HTTP', value: 'HTTP' },
      ],
    },
    { key: 'url', label: '接入地址', column: true },
    {
      key: 'clientConfig',
      label: 'ClientConfig',
      kind: 'clientConfig',
      wide: true,
      help: 'Kubernetes WebhookClientConfig 形状：URL 或 Service 二选一，再叠加 CA / 超时 / 请求头 / 凭据。设置后优先于接入地址；请求头 Secret 里的键值仍会合并。',
    },
    {
      key: 'allowedTools',
      label: '允许的工具',
      kind: 'tags',
      inlineEdit: true,
      placeholder: '从工具列表选择，或回车手动输入工具名',
    },
    {
      key: 'mode',
      label: '模式',
      kind: 'select',
      options: [{ label: '直连（direct）', value: 'direct' }],
      valueEnum: { direct: { text: '直连', color: 'blue' } },
      defaultValue: 'direct',
      help: '目前仅支持 direct（直连运行时）。',
    },
    { key: 'namespace', label: '命名空间', optionsSource: 'namespaces', allowCustom: true },
    {
      key: 'headers',
      label: '请求头',
      kind: 'json',
      inlineEdit: true,
      placeholder: '{\n  "Authorization": "Bearer <token>",\n  "X-API-Key": "<your-api-key>"\n}',
      help: 'JSON 对象；键为请求头名称，会随每次请求发送给 MCP 服务端。',
    },
    {
      key: 'requireApprovals',
      label: '需审批的工具',
      kind: 'tags',
      inlineEdit: true,
      placeholder: '从允许的工具中选择，或输入通配模式',
    },
    {
      key: 'resourceMappings',
      label: '资源映射',
      kind: 'json',
      inlineEdit: true,
      placeholder:
        '[\n  {\n    "tool_name": "get-resource",\n    "resource_kind": "k8s-namespace",\n    "name_path": "namespace",\n    "attribute_paths": { "cluster": "cluster_name" },\n    "verb": "read"\n  }\n]',
      help: 'JSON 数组；声明工具参数如何映射到授权资源，留空表示不做资源级授权。',
    },
    { key: 'description', label: '描述', inlineEdit: true },
    { key: 'labels', label: '标签', kind: 'labels', optionsSource: 'labels', allowCustom: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      note: '保存后控制器会自动维护一条 `<名称>-grant` 的 AuthorizationRule，回答“谁可以调用这个 MCP”，引用它的智能体无需再手工授权；显式 Deny 规则优先。它**不解决跨命名空间引用**：其他空间的 Agent 使用本 MCP 仍需在**本 MCP 所在空间**创建 ReferenceGrant。如需关闭自动授权，给本 MCP 添加注解 `agent.onexai.io/auto-grant=false`。',
      fields: [
        'name',
        'displayName',
        'status',
        'mode',
        'protocol',
        'url',
        'clientConfig',
        'namespace',
        'description',
        'labels',
        'updatedAt',
      ],
    },
    { key: 'mappings', label: '请求头与映射', fields: ['headers', 'resourceMappings'] },
    {
      key: 'tools',
      label: '工具与审批',
      fields: ['allowedTools', 'requireApprovals'],
      note: '请先做连通性测试，获取工具列表；允许的工具为空表示允许全部，支持 `delete_*` 通配。',
    },
  ],
  formFields: [
    'name',
    'displayName',
    'status',
    'mode',
    'protocol',
    'clientConfig',
    'url',
    'description',
    'headers',
    'resourceMappings',
    'allowedTools',
    'requireApprovals',
    'labels',
  ],
  namespaceField: 'namespace',
};

const KNOWLEDGE_BASES: ResourceSpec = {
  key: 'knowledge-bases',
  title: '知识库管理',
  idKey: 'name',
  name: '知识库',
  idLabel: '名称',
  binding: bind('knowledge-bases'),
  fields: [
    {
      key: 'name',
      label: '名称',
      readOnly: true,
      maxLength: 253,
      pattern: DNS_NAME_PATTERN,
      patternMessage: '名称需由小写字母、数字、- 和 . 组成',
      help: '会作为控制面对象名，创建后不可修改。',
    },
    { key: 'displayName', label: '显示名', required: true, inlineEdit: true },
    statusField(),
    {
      key: 'platform',
      label: '平台',
      column: true,
      required: true,
      defaultValue: 'ragflow',
      valueEnum: {
        ragflow: { text: 'RAGFlow', color: 'geekblue' },
        // Dify 不再作为新建选项提供；保留映射，历史记录仍能显示成 Dify。
        dify: { text: 'Dify', color: 'blue' },
      },
      kind: 'select',
      options: [{ label: 'RAGFlow', value: 'ragflow' }],
    },
    { key: 'datasetId', label: '数据集 ID', column: true, required: true },
    {
      key: 'topK',
      label: 'Top K',
      column: true,
      kind: 'number',
      required: true,
      defaultValue: 5,
      min: 1,
      help: '每次检索最多返回的片段数。越大召回越全，但上下文与成本越高；默认 5。',
    },
    { key: 'namespace', label: '命名空间', optionsSource: 'namespaces', allowCustom: true },
    {
      key: 'scoreThreshold',
      label: '相似度阈值',
      kind: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      defaultValue: 0.2,
      placeholder: '0.2',
      help: '低于该分数的片段会被丢弃（0–1）。默认 0.2，与 RAGFlow 官方默认一致；中文短文本召回不足时可下调到 0.1。留空表示跟随部署默认值。',
      note: '低于该分数的片段会被丢弃；留空跟随部署默认值。',
    },
    { key: 'description', label: '描述' },
    { key: 'labels', label: '标签', kind: 'labels', optionsSource: 'labels', allowCustom: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: ['name', 'displayName', 'status', 'namespace', 'description', 'labels', 'updatedAt'],
    },
    // 检索参数独立成步：它们决定「查哪个数据集、怎么查」，与名称/描述这类
    // 管理信息是两件事；新建时分步填写也避免了第一步字段过多。
    {
      key: 'retrieval',
      label: '知识库设置',
      fields: ['platform', 'datasetId', 'scoreThreshold', 'topK'],
    },
  ],
  formFields: [
    'name',
    'displayName',
    'status',
    'platform',
    'datasetId',
    'scoreThreshold',
    'topK',
    'description',
    'labels',
  ],
  namespaceField: 'namespace',
};

const MEMORIES: ResourceSpec = {
  key: 'memories',
  title: '记忆库管理',
  idKey: 'name',
  name: '记忆库',
  idLabel: '名称',
  binding: bind('memories'),
  adminOnlyWrite: true,
  fields: [
    {
      key: 'name',
      label: '名称',
      readOnly: true,
      maxLength: 253,
      pattern: DNS_NAME_PATTERN,
      patternMessage: '名称需由小写字母、数字、- 和 . 组成',
      help: '创建后不可修改。',
    },
    { key: 'displayName', label: '显示名', required: true },
    {
      key: 'description',
      label: '描述',
      kind: 'textarea',
    },
    { key: 'labels', label: '标签', kind: 'labels', optionsSource: 'labels', allowCustom: true },
    {
      key: 'enabled',
      label: '启用',
      column: true,
      kind: 'switch',
      defaultValue: true,
      help: '关闭后引用它的智能体不再读写记忆。',
    },
    {
      key: 'namespace',
      label: '命名空间',
      column: true,
      optionsSource: 'namespaces',
      allowCustom: true,
    },
    { key: 'entryCount', label: '条目数', column: true, kind: 'number', readOnly: true },
    { key: 'subjectCount', label: '用户数', column: true, kind: 'number', readOnly: true },
    {
      key: 'embeddingModel',
      label: 'Embedding 模型',
      column: true,
      kind: 'ref',
      refResource: 'models',
      required: true,
      requiredWhen: {
        field: 'enabled',
        equals: 'true',
        message: '启用记忆后必须选择 Embedding 模型',
      },
    },
    {
      key: 'embeddingDimensions',
      label: '向量维度',
      column: true,
      kind: 'number',
      required: true,
      min: 1,
      help: '必须与 Embedding 模型的输出维度一致。PostgreSQL 启用 pgvector 后，系统按维度自动建立 HNSW 索引。',
    },
    {
      key: 'embeddingVersion',
      label: 'Embedding 版本',
      required: true,
      help: '例如 v1；切换模型时递增。',
    },
    { key: 'extractionEnabled', label: '自动抽取', kind: 'switch', defaultValue: true },
    {
      key: 'extractionModel',
      label: '抽取模型',
      kind: 'ref',
      refResource: 'models',
      help: '留空使用智能体运行时默认的摘要模型。',
    },
    { key: 'maxFactsPerRun', label: '每轮最多事实数', kind: 'number', min: 1, defaultValue: 20 },
    { key: 'ttlDays', label: '保留天数', kind: 'number', min: 0, help: '0 表示不过期。' },
    { key: 'maxEntriesPerSubject', label: '每人条目上限', kind: 'number', min: 0 },
    {
      key: 'retrievalMode',
      label: '检索模式',
      kind: 'select',
      options: [
        { label: '混合', value: 'hybrid' },
        { label: '向量', value: 'vector' },
        { label: '关键字', value: 'keyword' },
      ],
      defaultValue: 'hybrid',
    },
    { key: 'topK', label: 'Top K', kind: 'number', min: 1, defaultValue: 8 },
    {
      key: 'minScore',
      label: '最低分',
      kind: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      defaultValue: 0.25,
      help: '低于该分数的记忆条目不参与召回（0–1）；默认 0.25。',
    },
    { key: 'maxTokens', label: '最大 Token', kind: 'number', min: 1, defaultValue: 1200 },
    { key: 'piiRedactionEnabled', label: 'PII 脱敏', kind: 'switch', defaultValue: true },
    {
      key: 'piiStrategy',
      label: 'PII 策略',
      kind: 'select',
      options: [
        { label: '脱敏', value: 'redact' },
        { label: '哈希', value: 'hash' },
        { label: '拒绝', value: 'drop' },
      ],
      defaultValue: 'redact',
    },
    { key: 'blockInstructionLike', label: '拦截指令型内容', kind: 'switch', defaultValue: true },
    { key: 'allowAdminContentRead', label: '允许管理员读正文', kind: 'switch' },
    {
      key: 'subjectMode',
      label: '作用域',
      kind: 'select',
      options: [
        { label: '按用户', value: 'user' },
        { label: '按会话', value: 'session' },
      ],
      defaultValue: 'user',
    },
    { key: 'owner', label: '归属', kind: 'user', readOnly: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'name',
        'displayName',
        'description',
        'enabled',
        'namespace',
        'subjectMode',
        'entryCount',
        'subjectCount',
        'labels',
        'owner',
        'updatedAt',
      ],
    },
    {
      key: 'embedding',
      label: 'Embedding 与抽取',
      fields: [
        'embeddingModel',
        'embeddingDimensions',
        'embeddingVersion',
        'extractionEnabled',
        'extractionModel',
        'maxFactsPerRun',
        'ttlDays',
        'maxEntriesPerSubject',
      ],
    },
    {
      key: 'retrieval',
      label: '检索',
      fields: ['retrievalMode', 'topK', 'minScore', 'maxTokens'],
    },
    {
      key: 'security',
      label: '安全',
      fields: [
        'piiRedactionEnabled',
        'piiStrategy',
        'blockInstructionLike',
        'allowAdminContentRead',
      ],
    },
  ],
  formFields: [
    'name',
    'displayName',
    'description',
    'labels',
    'enabled',
    'embeddingModel',
    'embeddingDimensions',
    'embeddingVersion',
    'extractionEnabled',
    'extractionModel',
    'maxFactsPerRun',
    'ttlDays',
    'maxEntriesPerSubject',
    'retrievalMode',
    'topK',
    'minScore',
    'maxTokens',
    'piiRedactionEnabled',
    'piiStrategy',
    'blockInstructionLike',
    'allowAdminContentRead',
    'subjectMode',
  ],
  namespaceField: 'namespace',
};

const PROMPTS: ResourceSpec = {
  key: 'prompts',
  title: '提示词管理',
  idKey: 'name',
  name: '提示词',
  idLabel: '名称',
  binding: bind('prompts'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    { key: 'displayName', label: '显示名', required: true },
    statusField(),
    {
      key: 'namespace',
      label: '命名空间',
      column: true,
      optionsSource: 'namespaces',
      allowCustom: true,
      placeholder: '留空使用部署默认',
    },
    { key: 'description', label: '描述', column: true },
    { key: 'content', label: '内容', kind: 'textarea' },
    { key: 'labels', label: '标签', kind: 'labels', optionsSource: 'labels', allowCustom: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: ['name', 'displayName', 'status', 'namespace', 'description', 'labels', 'updatedAt'],
    },
    { key: 'content', label: '内容', fields: ['content'] },
  ],
  formFields: ['name', 'displayName', 'status', 'description', 'content', 'labels'],
  namespaceField: 'namespace',
};

/**
 * 后端 `chatmodel` 提供方注册表里的常见提供方。
 *
 * `value` 必须与后端一致：后端按它推断能力、选择原生适配器，并在接入地址
 * 留空时取默认地址。未知值按 OpenAI 兼容协议处理，所以控件允许手输
 * （自建网关、vLLM 等）。
 */
const MODEL_PROVIDER_OPTIONS: FieldOption[] = [
  { label: 'OpenAI', value: 'openai', icon: 'openai' },
  { label: 'DeepSeek', value: 'deepseek', icon: 'deepseek' },
  { label: 'Anthropic Claude', value: 'claude', icon: 'claude' },
  { label: 'Google Gemini', value: 'gemini', icon: 'gemini' },
  { label: '火山方舟（豆包）', value: 'ark', icon: 'ark' },
  { label: '阿里云通义千问', value: 'qwen', icon: 'qwen' },
  { label: 'Ollama（本地）', value: 'ollama', icon: 'ollama' },
  { label: '百度千帆', value: 'qianfan', icon: 'qianfan' },
];

/**
 * 内置提供方的默认接入地址，与后端 `chatmodel.providerSpecs` 的
 * `defaultBaseURL` 一致。
 *
 * 地址是必填的：上游 Model 对象把 `endpoint` 声明为 required，留空会在写入
 * 控制面时被拒绝（最终表现为 “A database write operation failed.”）。选择
 * 提供方时由表单自动带出；Ollama、千帆没有默认地址，必须手填。
 */
export const MODEL_PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

/** 后端能识别的能力名。未知能力会原样保存，但当前没有行为。 */
const MODEL_CAPABILITY_OPTIONS = [
  { label: 'vision（接收图像）', value: 'vision' },
  { label: 'image-generation（图像生成）', value: 'image-generation' },
  { label: 'text-only（纯文本，不接收图像）', value: 'text-only' },
];

const MODELS: ResourceSpec = {
  key: 'models',
  title: '模型管理',
  idKey: 'name',
  name: '模型',
  idLabel: '名称',
  binding: bind('models'),
  fields: [
    {
      key: 'name',
      label: '名称',
      readOnly: true,
      placeholder: '请输入模型名称',
      maxLength: 128,
      showCount: true,
    },
    {
      key: 'displayName',
      label: '显示名',
      required: true,
      inlineEdit: true,
      placeholder: '请输入显示名',
    },
    statusField(),
    {
      key: 'provider',
      label: '提供方',
      column: true,
      kind: 'select',
      options: MODEL_PROVIDER_OPTIONS,
      allowCustom: true,
      placeholder: '选择或输入提供方，如 openai',
      help: '内置常见提供方；也可直接输入自定义标识（如 vllm、自建网关）。未知提供方按 OpenAI 兼容协议接入。',
    },
    {
      key: 'model',
      label: '模型名',
      column: true,
      required: true,
      placeholder: '如 deepseek-chat',
      help: '上游模型名。后端在能力未声明时用它推断提供方与默认能力。',
    },
    {
      key: 'baseUrl',
      label: '接入地址',
      column: true,
      required: true,
      inlineEdit: true,
      placeholder: '选择提供方后自动带出，或手动填写',
      help: 'OpenAI 兼容地址；Ollama、千帆需手动填写。',
    },
    { key: 'hasAPIKey', label: '已配置密钥', kind: 'switch', readOnly: true },
    {
      key: 'capabilities',
      label: '能力',
      kind: 'tags',
      column: true,
      inlineEdit: true,
      options: MODEL_CAPABILITY_OPTIONS,
      placeholder: '选择或输入能力',
      help: '声明端点除文本外还支持什么。留空表示未声明，后端按提供方与模型名推断。',
      note: '未声明时由后端按提供方与模型名推断；声明后以声明为准。',
    },
    {
      key: 'owner',
      label: '归属',
      kind: 'user',
      note: '创建时自动设为创建人；非空时只有归属用户的运行可以选用。',
    },
    {
      key: 'apiKey',
      label: 'API Key',
      kind: 'password',
      requiredOnCreate: true,
      placeholder: '请输入 API Key',
      note: '归属人或管理员可在详情页点「查看」取回明文；留空保存表示保留原值，填写表示轮换。',
      helpInTooltip: true,
      help: '创建时必填，归属自动设为当前登录用户；编辑时留空保留原值，填写表示轮换。明文不随列表/详情返回，归属人或管理员点「查看」时单独取回。',
      reveal: {
        load: record => revealModelAPIKey(String(record.name)),
        // hasAPIKey=false 时后端 JSON 里根本不出现这个键，所以只能用 === true 判断。
        present: record => record.hasAPIKey === true,
        allowed: (record, claims) => {
          if (!claims) return false;
          if (claims.isAdmin) return true;
          const owner = typeof record.owner === 'string' ? record.owner : '';
          return (
            owner !== '' &&
            (owner === claims.userId || (claims.name != null && owner === claims.name))
          );
        },
        unavailableHint:
          '服务端无法还原这把 API Key 的明文（当前部署未配置加密密钥，或加密密钥已变更）。它仍然有效；如需可查看的明文，请重新填写并保存。',
        restrictedHint: '只有资源归属人或管理员可以查看这个 API Key。',
      },
    },
    {
      key: 'description',
      label: '描述',
      kind: 'textarea',
      placeholder: '请输入模型描述',
      maxLength: 300,
      showCount: true,
    },
    { key: 'labels', label: '标签', kind: 'labels', optionsSource: 'labels', allowCustom: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: ['name', 'displayName', 'status', 'owner', 'description', 'labels', 'updatedAt'],
    },
    {
      key: 'access',
      label: '接入配置',
      fields: ['provider', 'model', 'baseUrl', 'capabilities'],
    },
    {
      key: 'credential',
      label: '凭据',
      fields: ['hasAPIKey', 'apiKey'],
    },
  ],
  // `owner` 不在表单里：新建时由 `creatorFields` 自动填入创建人，编辑时保留原值。
  formFields: [
    'name',
    'displayName',
    'status',
    'provider',
    'model',
    'baseUrl',
    'capabilities',
    'apiKey',
    'description',
    'labels',
  ],
  creatorFields: ['owner'],
};

const SECRETS: ResourceSpec = {
  key: 'secrets',
  title: '服务凭据',
  idKey: 'secretId',
  name: '密钥',
  idLabel: 'Secret ID',
  binding: bind('secrets'),
  fields: [
    { key: 'secretId', label: 'Secret ID', readOnly: true },
    { key: 'description', label: '描述', column: true },
    {
      key: 'secretKey',
      label: 'Secret Key',
      kind: 'password',
      note: '管理员可在详情页点「查看」取回明文；留空保存表示保留原值，填写表示轮换。',
      reveal: {
        load: record => revealSecretKey(String(record.secretId)),
        allowed: (_record, claims) => claims?.isAdmin === true,
        unavailableHint: '服务端没有返回这个凭据的 Secret Key：该凭据没有存密钥。',
        restrictedHint: '只有管理员可以查看这个密钥。',
      },
    },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    { key: 'basic', label: '基本信息', fields: ['secretId', 'description', 'updatedAt'] },
    {
      key: 'credential',
      label: '密钥',
      fields: ['secretKey'],
      note: '创建时下发一次；之后列表与详情读取都返回空，管理员点「查看」时才单独取回一次。',
    },
  ],
  formFields: ['description'],
};

const AUTHZ_RULES: ResourceSpec = {
  key: 'authz-rules',
  title: '访问控制',
  idKey: 'name',
  name: '授权规则',
  idLabel: '名称',
  binding: bind('authz-rules'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    {
      key: 'subjectType',
      label: '主体类型',
      column: true,
      valueEnum: {
        user: { text: 'user', color: 'blue' },
        group: { text: 'group', color: 'purple' },
        serviceaccount: { text: 'serviceaccount', color: 'cyan' },
        namespace: { text: 'namespace', color: 'geekblue' },
        '*': { text: '*', color: 'red' },
      },
      kind: 'select',
      options: [
        { label: 'user', value: 'user' },
        { label: 'group', value: 'group' },
        { label: 'serviceaccount', value: 'serviceaccount' },
        { label: 'namespace', value: 'namespace' },
        { label: '*', value: '*' },
      ],
    },
    {
      key: 'resourceKind',
      label: '资源类型',
      column: true,
      valueEnum: {
        agent: { text: 'agent', color: 'blue' },
        mcp: { text: 'mcp', color: 'cyan' },
        tool: { text: 'tool', color: 'geekblue' },
        skill: { text: 'skill', color: 'purple' },
        knowledgebase: { text: 'knowledgebase', color: 'magenta' },
        namespace: { text: 'namespace', color: 'gold' },
        'k8s-namespace': { text: 'k8s-namespace', color: 'volcano' },
        service: { text: 'service', color: 'lime' },
        cluster: { text: 'cluster', color: 'green' },
        '*': { text: '*', color: 'red' },
      },
      kind: 'select',
      options: [
        { label: 'agent', value: 'agent' },
        { label: 'mcp', value: 'mcp' },
        { label: 'tool', value: 'tool' },
        { label: 'skill', value: 'skill' },
        { label: 'knowledgebase', value: 'knowledgebase' },
        { label: 'namespace', value: 'namespace' },
        { label: 'k8s-namespace', value: 'k8s-namespace' },
        { label: 'service', value: 'service' },
        { label: 'cluster', value: 'cluster' },
        { label: '*', value: '*' },
      ],
    },
    { key: 'verbs', label: '动作', kind: 'tags', column: true },
    {
      key: 'effect',
      label: '效果',
      column: true,
      valueEnum: { allow: { text: '允许', color: 'green' }, deny: { text: '拒绝', color: 'red' } },
      kind: 'select',
      options: [
        { label: '允许', value: 'allow' },
        { label: '拒绝', value: 'deny' },
      ],
    },
    statusField({ column: false }),
    { key: 'subjectIds', label: '主体', kind: 'tags' },
    { key: 'resourceNames', label: '资源名', kind: 'tags' },
    { key: 'agentNames', label: '限定智能体', kind: 'tags' },
    { key: 'resourceAttributes', label: '资源属性', kind: 'json' },
    { key: 'description', label: '描述' },
    { key: 'owner', label: '归属', kind: 'user' },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: ['name', 'status', 'description', 'owner', 'updatedAt'],
    },
    {
      key: 'subject',
      label: '主体与资源',
      fields: [
        'subjectType',
        'subjectIds',
        'resourceKind',
        'resourceNames',
        'agentNames',
        'resourceAttributes',
      ],
    },
    {
      key: 'effect',
      label: '动作与效果',
      fields: ['verbs', 'effect'],
      note: 'write 不蕴含 read；deny 优先于 allow。写入会立刻重新加载规则集并清掉判定缓存。',
    },
  ],
  formFields: [
    'name',
    'subjectType',
    'subjectIds',
    'resourceKind',
    'resourceNames',
    'agentNames',
    'resourceAttributes',
    'verbs',
    'effect',
    'status',
    'description',
    'owner',
  ],
};

const CUSTOM_COMMANDS: ResourceSpec = {
  key: 'custom-commands',
  title: '自定义命令',
  idKey: 'name',
  name: '自定义命令',
  idLabel: '名称',
  binding: bind('custom-commands'),
  // 命名空间不放在表单里：新建跟随页头右上角的业务空间，编辑保留记录原值。
  // 字段本身仍保留，详情页只读展示，列表也靠它决定是否显示空间筛选。
  namespaceField: 'namespace',
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    { key: 'displayName', label: '显示名', required: true },
    {
      key: 'type',
      label: '类型',
      column: true,
      required: true,
      valueEnum: {
        prompt: { text: 'prompt', color: 'blue' },
        http: { text: 'http', color: 'cyan' },
        tool: { text: 'tool', color: 'purple' },
      },
      kind: 'select',
      options: [
        { label: 'prompt', value: 'prompt' },
        { label: 'http', value: 'http' },
        { label: 'tool', value: 'tool' },
      ],
      placeholder: '选择命令类型',
      help: 'prompt 交给智能体生成回复；http 代理一次 REST 调用；tool 调用 MCP Server 上的一个工具。',
      helpInTooltip: true,
    },
    {
      key: 'enabled',
      label: '启用',
      column: true,
      kind: 'switch',
      // 后端把「省略 enabled」当作停用，所以新建时必须显式写入 true。
      defaultValue: true,
      help: '关闭后引用它的智能体无法调用该命令。',
      helpInTooltip: true,
    },
    {
      key: 'aliases',
      label: '别名',
      kind: 'tags',
      column: true,
      placeholder: '回车添加别名，如 sum、brief',
      help: '最多 8 个；与名称同规则（小写字母、数字、连字符），重复别名会被后端拒绝。名称就是 MCP tool 名，别名不会注册成独立 tool。',
      helpInTooltip: true,
    },
    {
      key: 'usage',
      label: '用法',
      column: true,
      placeholder: '<service> [--env=<env>] [--formal]',
      help: '仅用于帮助/示例展示，不参与命令解析；错误提示里的用法由“参数”自动生成（位置参数 <name>、可选 flag [--x=<x>]、布尔 [--x]）。留空不影响调用。',
      helpInTooltip: true,
    },
    {
      key: 'timeoutSeconds',
      label: '超时（秒）',
      kind: 'number',
      defaultValue: 60,
      // 0 是后端认可的「使用部署默认」，允许它才能编辑历史记录。
      min: 0,
      placeholder: '60',
      help: '0 表示使用部署默认（60 秒）；只对 http 类型生效。',
      helpInTooltip: true,
    },
    { key: 'namespace', label: '命名空间', optionsSource: 'namespaces', allowCustom: true },
    { key: 'description', label: '描述' },
    {
      key: 'parameters',
      label: '参数',
      kind: 'jsonValue',
      rows: 16,
      placeholder: JSON.stringify(
        [
          {
            name: 'service',
            in: 'positional',
            type: 'string',
            required: true,
            description: '服务名',
          },
          {
            name: 'env',
            type: 'string',
            enums: ['dev', 'staging', 'prod'],
            defaultValue: '"prod"',
            description: '部署环境',
          },
          { name: 'changes', type: 'array', description: '变更条目' },
          { name: 'formal', type: 'boolean', short: 'f', description: '正式语气' },
        ],
        null,
        2
      ),
      help: '最多 32 个。name 小写字母开头、1–32 位（a-z0-9-）；in 取 flag|positional；type 取 string|integer|number|boolean|duration|array|object|json（默认 string）。defaultValue 是 JSON 编码的字符串（字符串写 "\\"prod\\""，布尔写 true，数组写 []），与 required 互斥；enums 仅用于标量；format 取 k8s-name|url|json|duration（仅 string/duration）；schemaJson 仅用于 object/array/json；short 为单字母且位置参数不能设置。控制面 YAML 对应字段名是 default/enum/schema。保存前会校验。',
      helpInTooltip: true,
    },
    {
      key: 'prompt',
      label: 'prompt 定义',
      kind: 'jsonValue',
      rows: 12,
      when: { field: 'type', equals: 'prompt' },
      required: true,
      placeholder: JSON.stringify(
        {
          template: [
            '发布说明（{{.Command}}）',
            '环境: {{.Params.env}}',
            '服务: {{.Params.service}}',
            '生成时间: {{.Now.Format "2006-01-02 15:04:05"}}',
            '操作人: {{if .User}}{{.User.Username}}{{else}}未知{{end}}',
            '{{if .Params.formal}}语气: 正式{{else}}语气: 简洁{{end}}',
            '',
            '变更:',
            '{{range .Params.changes}}- {{.}}',
            '{{end}}',
          ].join('\n'),
        },
        null,
        2
      ),
      help: 'Go text/template。可用字段：.Params（参数集合，复数）、.Command、.Agent、.Conversation（conversationId/chatType/surface）、.User（Username/UID/Groups/Extra）、.DryRun、.Now。参数必须写成 {{.Params.name}}；.Param 是错误写法，保存时会被拒绝。prompt 类型不能设置输出定义。',
      helpInTooltip: true,
    },
    {
      key: 'http',
      label: 'http 定义',
      kind: 'jsonValue',
      rows: 14,
      when: { field: 'type', equals: 'http' },
      required: true,
      placeholder: JSON.stringify(
        {
          method: 'POST',
          url: 'https://api.github.com/graphql',
          headers: [
            { name: 'Accept', value: 'application/vnd.github+json' },
            { name: 'User-Agent', value: 'onexai-custom-command' },
            { name: 'X-GitHub-Api-Version', value: '2022-11-28' },
          ],
          query: { client: 'onexai' },
          body: '{"query":"query($owner:String!,$repo:String!,$number:Int!,$state:[IssueState!]){repository(owner:$owner,name:$repo){issue(number:$number){number title state url}}}","variables":{"owner":"{{.Params.owner}}","repo":"{{.Params.repo}}","number":{{.Params.number}},"state":["{{.Params.state}}"]}}',
          contentType: 'application/json',
          sideEffects: 'None',
        },
        null,
        2
      ),
      help: 'url 与 service 二选一（service 为 {namespace,name,port,path}），url 的 scheme 与 host 必须写死。可设 method（默认 GET）、headers（[{name,value}]）、query、body、contentType、secretRef、caBundle、insecureSkipTLSVerify、sideEffects（None|NoneOnDryRun|Some|Unknown）；GET/HEAD 不能带 body。headers/query/body 可引用 .Params（复数）。也可以用 clientConfig（Kubernetes WebhookClientConfig 形状：url 或 service{namespace,name,port,path} + caBundle + timeoutSeconds + headers + secretRef/secretKey + headersRef）统一替代 url/service/caBundle/insecureSkipTLSVerify。',
      helpInTooltip: true,
    },
    {
      key: 'tool',
      label: 'tool 定义',
      kind: 'jsonValue',
      rows: 10,
      when: { field: 'type', equals: 'tool' },
      required: true,
      placeholder: JSON.stringify(
        {
          mcpServer: { name: 'onexai', namespace: 'helper-public' },
          tool: 'sysload',
          argumentsTemplate:
            '{\n  "top": {{.Params.top}},\n  "output": "{{.Params.output}}",\n  "wide": {{.Params.wide}}\n}',
        },
        null,
        2
      ),
      help: 'mcpServer 为 {name,namespace?}，该 MCP Server 必须同时绑定到智能体；tool 为 MCP 工具名（≤256 字符）；argumentsTemplate 渲染后必须是 JSON 对象，可引用 .Params（复数）。',
      helpInTooltip: true,
    },
    {
      key: 'output',
      label: '输出定义',
      kind: 'jsonValue',
      rows: 8,
      // prompt 会被原样交给智能体，后端明确禁止 prompt 设置 output。
      when: { field: 'type', equals: ['http', 'tool'] },
      placeholder: JSON.stringify(
        {
          format: 'template',
          template:
            'HTTP {{.Status}}\n{{.JSON.data.repository.issue.title}}\n{{.JSON.data.repository.issue.url}}',
        },
        null,
        2
      ),
      help: 'format 取 text（原样）|json（美化）|template；template 可引用 .Status、.Header、.Body、.JSON、.Params（复数），format=template 时必填。当前 output 模板由 http 类型使用；tool 类型直接展示工具原始结果。schemaJson 为 JSON 编码对象，填写后会校验返回结果。',
      helpInTooltip: true,
    },
    { key: 'labels', label: '标签', kind: 'labels', optionsSource: 'labels', allowCustom: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'name',
        'displayName',
        'enabled',
        'description',
        'labels',
        'updatedAt',
        // 命名空间只在详情页展示：表单里由页头业务空间补齐。
        'namespace',
      ],
    },
    {
      key: 'definition',
      label: '命令定义',
      fields: ['type', 'aliases', 'usage', 'timeoutSeconds', 'prompt', 'http', 'tool', 'output'],
      note: '定义区只显示与「类型」匹配的一项；输出定义仅 http / tool 可用。',
    },
    { key: 'parameters', label: '参数', fields: ['parameters'] },
  ],
  formFields: [
    'name',
    'displayName',
    'enabled',
    'description',
    'labels',
    'type',
    'aliases',
    'usage',
    'timeoutSeconds',
    'parameters',
    'prompt',
    'http',
    'tool',
    'output',
  ],
  // 服务端仍会复核；这里提前拦截参数结构与模板字段的确定性错误。
  submitValidate: values => validateCustomCommand(values),
};

// ─── 命名空间 ────────────────────────────────────────────────────────────────

/**
 * 命名空间 = 控制面的 Kubernetes Namespace + 平台维护的展示信息。
 *
 * `name` 同时是命名空间名，创建后不可改；`displayName` / `owner` /
 * `description` 以注解形式写回 Namespace，控制面直接创建命名空间时也会被反向
 * 同步进这张表，所以两条创建路径看到的是同一个命名空间。
 */
const NAMESPACES: ResourceSpec = {
  key: 'namespaces',
  title: '命名空间',
  idKey: 'name',
  name: '命名空间',
  idLabel: '名称',
  binding: bind('namespaces'),
  fields: [
    {
      key: 'name',
      label: '名称',
      readOnly: true,
      note: '创建后不可修改；同时也是控制面命名空间名，需符合 DNS-1123（小写字母、数字、短横线）。',
    },
    { key: 'displayName', label: '显示名', required: true },
    { key: 'owner', label: '负责人', column: true, kind: 'user' },
    { key: 'description', label: '描述', column: true, kind: 'textarea' },
    { key: 'labels', label: '标签', kind: 'labels', optionsSource: 'labels', allowCustom: true },
    { key: 'createdAt', label: '创建时间', kind: 'datetime', readOnly: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: ['name', 'displayName', 'owner', 'description', 'labels', 'createdAt', 'updatedAt'],
    },
  ],
  formFields: ['name', 'displayName', 'owner', 'description', 'labels'],
};

// ─── 自动化 ──────────────────────────────────────────────────────────────────

const SCHEDULED_RUNS: ResourceSpec = {
  key: 'scheduled-runs',
  title: '定时任务',
  idKey: 'name',
  name: '定时任务',
  idLabel: '名称',
  binding: bind('scheduled-runs'),
  fields: [
    {
      key: 'name',
      label: '名称',
      readOnly: true,
      // CronJob 名会被控制器追加时间戳后缀组成 Job 名，K8s 因此把上限压到 52。
      maxLength: 52,
      pattern: DNS_NAME_PATTERN,
      patternMessage: '名称需由小写字母、数字、- 和 . 组成，且以字母或数字开头/结尾',
      help: '创建后不可修改；仅小写字母、数字、- 和 .，最长 52 字符。',
      note: '创建后不可修改；同时是 CronJob 名，需符合 DNS-1123 且不超过 52 字符。',
    },
    { key: 'displayName', label: '显示名', required: true },
    { key: 'description', label: '描述' },
    {
      key: 'status',
      label: '状态',
      column: true,
      readOnly: true,
      valueEnum: {
        enabled: { text: '运行中', color: 'green' },
        disabled: { text: '已暂停', color: 'default' },
      },
    },
    {
      key: 'agent',
      label: '智能体',
      column: true,
      kind: 'ref',
      refResource: 'agents',
      required: true,
    },
    {
      key: 'schedule',
      label: '调度表达式',
      column: true,
      required: true,
      placeholder: '0 9 * * *',
      pattern: CRON_FIVE_FIELDS,
      patternMessage: '请填写 5 段 cron 表达式，例如 0 9 * * *',
      help: '标准 5 段 cron（分 时 日 月 周），按下面的时区解释。',
    },
    {
      key: 'timeZone',
      label: '时区',
      column: true,
      kind: 'timezone',
      required: true,
      defaultValue: localTimeZone(),
      help: '默认为当前浏览器时区；cron 按此时区解释。',
    },
    { key: 'paused', label: '暂停', kind: 'switch' },
    { key: 'prompt', label: '执行提示词', kind: 'textarea', required: true },
    { key: 'executionTimeoutNanos', label: '超时（秒）', kind: 'number', unit: '秒', min: 0 },
    { key: 'namespace', label: '命名空间', optionsSource: 'namespaces', allowCustom: true },
    { key: 'owner', label: '归属', kind: 'user' },
    { key: 'lastExecutionId', label: '最近执行', readOnly: true },
    { key: 'lastScheduledAt', label: '上次运行', kind: 'datetime', readOnly: true, column: true },
    { key: 'nextScheduledAt', label: '下次运行', kind: 'datetime', readOnly: true, column: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'name',
        'displayName',
        'description',
        'status',
        'agent',
        'schedule',
        'timeZone',
        'paused',
        'lastScheduledAt',
        'nextScheduledAt',
        'prompt',
        'executionTimeoutNanos',
        'namespace',
        'owner',
        'updatedAt',
      ],
    },
    { key: 'last', label: '最近执行', fields: ['lastExecutionId', 'lastScheduledAt'] },
  ],
  // 归属与命名空间不在表单里：新建时由登录人和页头业务空间补齐，编辑时保留记录原值。
  formFields: [
    'name',
    'displayName',
    'description',
    'agent',
    'schedule',
    'timeZone',
    'paused',
    'prompt',
    'executionTimeoutNanos',
  ],
  creatorFields: ['owner'],
  namespaceField: 'namespace',
};

// ─── 运行环境 ────────────────────────────────────────────────────────────────

const RUNTIME_PROFILES: ResourceSpec = {
  key: 'runtime-profiles',
  title: 'Runtime Profile',
  idKey: 'name',
  name: '运行配置',
  idLabel: '名称',
  binding: bind('runtime-profiles'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    {
      key: 'namespace',
      label: '命名空间',
      column: true,
      optionsSource: 'namespaces',
      allowCustom: true,
    },
    { key: 'displayName', label: '显示名', required: true },
    statusField(),
    { key: 'kind', label: '类型', column: true },
    { key: 'endpoint', label: 'Endpoint', column: true },
    {
      key: 'clientConfig',
      label: 'ClientConfig',
      kind: 'clientConfig',
      wide: true,
      help: 'Kubernetes WebhookClientConfig 形状：URL 或 Service 二选一，再叠加 CA / 超时 / 请求头 / 凭据。设置后优先于 Endpoint。',
    },
    {
      key: 'hostingRef',
      label: 'Hosting 引用',
      column: true,
      kind: 'ref',
      refResource: 'runtime-hostings',
    },
    { key: 'modelAccess', label: '模型访问' },
    { key: 'authBearerSecret', label: 'Bearer 凭据', kind: 'ref', refResource: 'secrets' },
    { key: 'authBearerKey', label: 'Bearer Key' },
    { key: 'authCASecret', label: 'CA 凭据', kind: 'ref', refResource: 'secrets' },
    { key: 'authCAKey', label: 'CA Key' },
    { key: 'authInsecureVerify', label: '跳过证书校验', kind: 'switch' },
    { key: 'runTimeoutNanos', label: '运行超时（秒）', kind: 'number', unit: '秒' },
    { key: 'maxConcurrentRun', label: '最大并发', kind: 'number' },
    { key: 'maxToolCalls', label: '工具调用上限', kind: 'number' },
    { key: 'resolvedEndpoint', label: '解析后的 Endpoint', readOnly: true },
    { key: 'capabilities', label: '能力', kind: 'json' },
    { key: 'description', label: '描述' },
    { key: 'owner', label: '归属', kind: 'user' },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'name',
        'namespace',
        'displayName',
        'status',
        'kind',
        'endpoint',
        'clientConfig',
        'hostingRef',
        'modelAccess',
        'owner',
        'description',
        'updatedAt',
      ],
    },
    {
      key: 'auth',
      label: '认证',
      fields: [
        'authBearerSecret',
        'authBearerKey',
        'authCASecret',
        'authCAKey',
        'authInsecureVerify',
      ],
    },
    {
      key: 'limits',
      label: '限制与能力',
      fields: [
        'runTimeoutNanos',
        'maxConcurrentRun',
        'maxToolCalls',
        'resolvedEndpoint',
        'capabilities',
      ],
    },
  ],
  formFields: [
    'name',
    'namespace',
    'displayName',
    'status',
    'kind',
    'endpoint',
    'clientConfig',
    'hostingRef',
    'modelAccess',
    'authBearerSecret',
    'authBearerKey',
    'authCASecret',
    'authCAKey',
    'authInsecureVerify',
    'runTimeoutNanos',
    'maxConcurrentRun',
    'maxToolCalls',
    'capabilities',
    'description',
    'owner',
  ],
};

const RUNTIME_HOSTINGS: ResourceSpec = {
  key: 'runtime-hostings',
  title: 'Runtime Hosting',
  idKey: 'name',
  name: '托管实例',
  idLabel: '名称',
  binding: bind('runtime-hostings'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    {
      key: 'namespace',
      label: '命名空间',
      column: true,
      optionsSource: 'namespaces',
      allowCustom: true,
    },
    { key: 'displayName', label: '显示名', required: true },
    statusField(),
    {
      key: 'profileRef',
      label: 'Profile',
      column: true,
      kind: 'ref',
      refResource: 'runtime-profiles',
    },
    { key: 'mode', label: '模式', column: true },
    { key: 'image', label: '镜像', column: true },
    { key: 'command', label: '命令', kind: 'tags' },
    { key: 'env', label: '环境变量', kind: 'json' },
    { key: 'maxInstances', label: '最大实例', kind: 'number', column: true },
    { key: 'idleTTLNanos', label: '空闲 TTL（秒）', kind: 'number', unit: '秒' },
    { key: 'resources', label: '资源', kind: 'json' },
    { key: 'instances', label: '实例', kind: 'json', readOnly: true },
    { key: 'description', label: '描述' },
    { key: 'owner', label: '归属', kind: 'user' },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'name',
        'namespace',
        'displayName',
        'status',
        'profileRef',
        'mode',
        'image',
        'maxInstances',
        'idleTTLNanos',
        'owner',
        'description',
        'updatedAt',
      ],
    },
    { key: 'runtime', label: '运行参数', fields: ['command', 'env', 'resources', 'instances'] },
  ],
  formFields: [
    'name',
    'namespace',
    'displayName',
    'status',
    'profileRef',
    'mode',
    'image',
    'command',
    'env',
    'maxInstances',
    'idleTTLNanos',
    'resources',
    'description',
    'owner',
  ],
};

const SANDBOX_TEMPLATES: ResourceSpec = {
  key: 'sandbox-templates',
  title: '沙箱模板',
  idKey: 'name',
  name: '沙箱模板',
  idLabel: '名称',
  binding: bind('sandbox-templates'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    {
      key: 'namespace',
      label: '命名空间',
      column: true,
      optionsSource: 'namespaces',
      allowCustom: true,
    },
    { key: 'displayName', label: '显示名', required: true },
    statusField(),
    { key: 'image', label: '镜像', column: true },
    { key: 'command', label: '命令', kind: 'tags' },
    { key: 'env', label: '环境变量', kind: 'tags' },
    { key: 'ttlSeconds', label: 'TTL（秒）', kind: 'number', column: true },
    { key: 'description', label: '描述' },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'name',
        'namespace',
        'displayName',
        'status',
        'image',
        'ttlSeconds',
        'description',
        'updatedAt',
      ],
    },
    { key: 'runtime', label: '运行参数', fields: ['command', 'env'] },
  ],
  formFields: [
    'name',
    'namespace',
    'displayName',
    'status',
    'image',
    'command',
    'env',
    'ttlSeconds',
    'description',
  ],
};

// ─── 安全与访问 ──────────────────────────────────────────────────────────────

/**
 * 运行生命周期事件：取值与后端 `model.WebhookM.Events` 一一对应。
 *
 * 只列后端认识的两种。`onStart` 能拒绝运行、`onEnd` 只是通知——这个差别决定
 * 用户该不该把失败策略设成「失败」，所以写在选项说明里。同一个表同时喂给
 * 「事件」多选框和引用字段的标签（见 `webhookEventBadges`），文案不会漂移。
 */
const WEBHOOK_EVENTS: Record<string, { label: string; color: string; description: string }> = {
  onStart: {
    label: 'OnStart',
    // 位于运行关键路径、可拒绝运行：用警示色把它和纯通知的 OnEnd 区分开。
    color: 'orange',
    description:
      '运行开始前调用，接收方可在响应体返回 {"allowed": false} 拒绝本次运行；位于运行关键路径上。',
  },
  onEnd: {
    label: 'OnEnd',
    color: 'blue',
    description: '运行结束后调用，仅作通知；投递失败不影响运行结果，也不会改变结果。',
  },
};

/** Webhook 的用途。空值与 `run` 等价，后端的默认值也是 run。 */
const WEBHOOK_TYPE_OPTIONS: FieldOption[] = [
  { value: 'run', label: '运行钩子', description: '在 run 边界调用：onStart 可拒绝，onEnd 只通知' },
  {
    value: 'authentication',
    label: '认证 Webhook',
    description: '接收 TokenReview，回答「这个 token 是谁」',
  },
  {
    value: 'authorization',
    label: '鉴权 Webhook',
    description: '接收 SubjectAccessReview，回答「这个主体能否使用该 Agent」',
  },
];

/** 只有运行钩子有事件与载荷模板。 */
const RUN_WEBHOOK_ONLY: Condition = { field: 'type', equals: ['run', ''] };

const WEBHOOK_EVENT_OPTIONS: FieldOption[] = Object.entries(WEBHOOK_EVENTS).map(
  ([value, event]) => ({
    value,
    label: event.label,
    description: event.description,
  })
);

/**
 * Webhook 行订阅的事件 → 引用字段上的标签。
 *
 * 未识别的事件原样显示，后端将来新增事件时不会在界面上凭空消失。
 */
function webhookEventBadges(row: Record<string, unknown>): FieldBadge[] {
  const events = Array.isArray(row.events) ? row.events.map(String) : [];
  return events.map(event => WEBHOOK_EVENTS[event] ?? { label: event });
}

const WEBHOOKS: ResourceSpec = {
  key: 'webhooks',
  title: 'Webhook',
  idKey: 'name',
  name: 'Webhook',
  idLabel: '名称',
  binding: bind('webhooks'),
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    statusField(),
    {
      key: 'type',
      label: '类型',
      kind: 'select',
      column: true,
      defaultValue: 'run',
      defaultWhenEmpty: true,
      valueEnum: {
        run: { text: '运行钩子', color: 'default' },
        authentication: { text: '认证', color: 'blue' },
        authorization: { text: '鉴权', color: 'purple' },
      },
      options: WEBHOOK_TYPE_OPTIONS,
      help: '运行钩子在 run 边界调用；认证/鉴权 Webhook 由 Agent 的「基本信息 → 高级设置」引用，分别接收 TokenReview 与 SubjectAccessReview。',
    },
    {
      key: 'clientConfig',
      label: '回调地址',
      kind: 'clientConfig',
      column: true,
      wide: true,
      help: '回调只支持 URL；私有 CA、TLS 与请求头在「高级连接设置」里配置。',
      clientConfigOptions: {
        modes: ['url'],
        showTimeout: false,
        showCredentials: false,
        advancedCollapse: true,
        hideUrlLabel: true,
        requireUrl: true,
      },
    },
    {
      key: 'events',
      label: '事件',
      kind: 'checklist',
      column: true,
      required: true,
      when: RUN_WEBHOOK_ONLY,
      options: WEBHOOK_EVENT_OPTIONS,
      note: 'onStart 位于运行关键路径，可拒绝运行；onEnd 只是事后通知。',
    },
    {
      key: 'audiences',
      label: 'TokenReview Audiences',
      kind: 'tags',
      when: { field: 'type', equals: 'authentication' },
      help: '放进 TokenReview.spec.audiences；留空表示不限定 audience，由接收方决定。',
    },
    {
      key: 'secretRef',
      label: '鉴权凭据',
      kind: 'webhookAuth',
      authTokenField: 'authToken',
      refResource: 'secrets',
      help: '可直接粘贴令牌（保存后转存为 Secret，只保留引用、不再回显），也可引用已有 Secret。令牌会放在 X-Onexai-Token 请求头里。',
    },
    {
      key: 'timeoutSeconds',
      label: '超时（秒）',
      kind: 'number',
      column: true,
      required: true,
      defaultValue: 30,
      min: 1,
      max: 30,
      placeholder: '30',
      help: '单次调用的最长等待时间，范围 1–30 秒，默认 30。认证/鉴权 Webhook 超时即按失败处理。',
    },
    {
      key: 'failureMode',
      label: '失败策略',
      column: true,
      // 后端把空串当「忽略」处理：编辑一条没存过该字段的记录时也显示默认值，
      // 而不是一个空下拉。
      defaultValue: 'ignore',
      defaultWhenEmpty: true,
      valueEnum: {
        ignore: { text: '忽略', color: 'default' },
        fail: { text: '失败', color: 'red' },
      },
      kind: 'select',
      options: [
        { label: '忽略', value: 'ignore' },
        { label: '失败', value: 'fail' },
      ],
      help: '「忽略」：回调不可达、超时或返回非 2xx 时视为无意见（运行钩子放行、鉴权继续看下一个后端）；「失败」：运行钩子拒绝本次运行，鉴权后端直接拒绝。认证后端始终 fail-closed。',
    },
    {
      key: 'template',
      label: '载荷模板',
      kind: 'textarea',
      when: RUN_WEBHOOK_ONLY,
      rows: 12,
      wide: true,
      monospace: true,
      placeholder:
        '{\n  "event": "{{.event}}",\n  "runId": "{{.runID}}",\n  "agent": "{{.agent}}",\n  "subject": "{{.subject.id}}",\n  "sessionKey": "{{.sessionKey}}"\n}',
      help: '使用 Go text/template 语法，渲染结果原样作为请求体；留空时发送默认 JSON 载荷。',
    },
    { key: 'owner', label: '归属', kind: 'user', note: '创建时自动设为创建人。' },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'name',
        'status',
        'type',
        'clientConfig',
        'events',
        'audiences',
        'secretRef',
        'timeoutSeconds',
        'failureMode',
        'owner',
        'updatedAt',
      ],
    },
    {
      key: 'template',
      label: '载荷模板',
      when: RUN_WEBHOOK_ONLY,
      fields: ['template'],
      note: '留空时发送默认 JSON 载荷；填写后按 Go text/template 渲染，结果原样作为请求体，请自行保证接收方能解析。',
      formExtra: 'webhook-template-help',
    },
  ],
  // 归属不在表单里：新建时由 `creatorFields` 写入当前登录用户（后端 user_guard
  // 对非管理员本来也会强制改写 owner），编辑时保留记录原值。
  formFields: [
    'name',
    'status',
    'type',
    'clientConfig',
    'events',
    'audiences',
    'secretRef',
    'timeoutSeconds',
    'failureMode',
    'template',
  ],
  creatorFields: ['owner'],
  // 与后端校验对齐：fail + onStart 的组合只对运行钩子有意义；认证/鉴权
  // Webhook 没有 events，不能套用这条规则。
  submitValidate: values => {
    const type = String(values.type ?? 'run');
    if (type !== 'run') {
      return null;
    }
    const mode = String(values.failureMode ?? '');
    const events = Array.isArray(values.events) ? values.events.map(String) : [];
    if (mode === 'fail' && !events.includes('onStart')) {
      return {
        field: 'failureMode',
        message:
          '「失败」策略只对订阅了 OnStart 的 Webhook 有效，请改选「忽略」或同时勾选 OnStart。',
      };
    }
    return null;
  },
  // 只保留一套地址与凭据：旧版顶层 url、ClientConfig 的 service/超时/凭据在
  // 保存时清空。写成值为 undefined 的自有属性，编辑路径的 deepMerge 才会覆盖
  // 记录里的旧值。
  submitTransform: values => {
    values.url = undefined;
    // 切换类型时清掉另一类的字段：条件字段不渲染，但编辑路径的初始值仍在
    // 表单里，不写成 undefined 会把「运行钩子的 events」带进认证 Webhook。
    const type = String(values.type ?? 'run');
    if (type !== 'run') {
      values.events = undefined;
      values.template = undefined;
    }
    if (type !== 'authentication') {
      values.audiences = undefined;
    }
    const cfg = values.clientConfig as Record<string, unknown> | undefined;
    if (cfg && typeof cfg === 'object') {
      cfg.service = undefined;
      cfg.timeoutSeconds = undefined;
      cfg.secretRef = undefined;
      cfg.headersRef = undefined;
    }
  },
};

// ─── chat 服务的资源 ─────────────────────────────────────────────────────────

const ONCALL_GROUPS: ResourceSpec = {
  key: 'oncall-groups',
  title: '值班管理',
  idKey: 'name',
  name: '值班组',
  idLabel: '名称',
  binding: oncallGroupBinding as unknown as ResourceBinding<Record<string, unknown>>,
  // 命名空间不再由表单填写：新建跟随列表页右上角的选择，编辑保留记录原值。
  namespaceField: 'namespace',
  fields: [
    { key: 'name', label: '名称', readOnly: true },
    { key: 'displayName', label: '显示名', required: true },
    statusField(),
    { key: 'shortDesc', label: '简述', column: true },
    { key: 'owner', label: '负责人', column: true },
    {
      key: 'allocationStrategy',
      label: '分配策略',
      column: true,
      valueEnum: {
        primary: { text: '主值班', color: 'blue' },
        primary_backup: { text: '主备值班', color: 'geekblue' },
        round_robin: { text: '轮询', color: 'purple' },
        time_based: { text: '分时段', color: 'orange' },
      },
      kind: 'select',
      options: [
        { label: '主值班', value: 'primary' },
        { label: '主备值班', value: 'primary_backup' },
        { label: '轮询', value: 'round_robin' },
        { label: '分时段', value: 'time_based' },
      ],
      note: 'primary / primary_backup 已接入派单；round_robin 与 time_based 当前按主值班处理。',
    },
    {
      key: 'agents',
      label: '关联智能体',
      kind: 'ref',
      column: true,
      refResource: 'agents',
      help: '每个值班组只加载一个智能体；创建工单群后，群内提问优先使用它，未配置时回退到提问者绑定、再到平台默认。历史多选配置保存后会收敛为第一个。',
    },
    {
      key: 'scheduleId',
      label: '旧 Regen 排班 ID',
      readOnly: true,
      note: '只读兼容字段；原生排班创建后以原生排班为准。',
    },
    { key: 'source', label: '来源', readOnly: true },
    { key: 'namespace', label: '命名空间', readOnly: true },
    {
      key: 'welcomeMessage',
      label: '欢迎语',
      kind: 'markdown',
      help: '支持 Markdown；创建工单群时会以卡片消息发送到新群。',
      placeholder: '例如：欢迎加入值班群，处理问题请发送 /oncall，查看可用命令请发送 /help。',
    },
    { key: 'longDesc', label: '详细说明', kind: 'textarea' },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: ['name', 'displayName', 'status', 'shortDesc', 'longDesc', 'owner', 'updatedAt'],
    },
    {
      key: 'duty',
      label: '值班配置',
      fields: ['allocationStrategy', 'agents', 'scheduleId'],
    },
    { key: 'welcome', label: '欢迎语', fields: ['welcomeMessage'] },
  ],
  formFields: [
    'name',
    'displayName',
    'status',
    'shortDesc',
    'longDesc',
    'owner',
    'allocationStrategy',
    'agents',
    'welcomeMessage',
  ],
};

const TICKETS: ResourceSpec = {
  key: 'tickets',
  title: '工单管理',
  idKey: 'ticket_id',
  name: '工单',
  idLabel: '工单号',
  binding: ticketBinding as unknown as ResourceBinding<Record<string, unknown>>,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  fields: [
    { key: 'ticket_id', label: '工单号', readOnly: true },
    { key: 'title', label: '标题', column: true, readOnly: true },
    { key: 'status', label: '状态', column: true, readOnly: true, valueEnum: TICKET_STATUS_ENUM },
    { key: 'level', label: '级别', column: true, kind: 'number', readOnly: true },
    { key: 'group_id', label: '值班组', column: true, readOnly: true },
    { key: 'assignee_name', label: '处理人', column: true, readOnly: true },
    { key: 'reporter_name', label: '报障人', column: true, readOnly: true },
    { key: 'reporter_open_id', label: '报障人 open_id', readOnly: true },
    { key: 'source', label: '来源', readOnly: true },
    { key: 'incident_id', label: '事件 ID', readOnly: true },
    { key: 'description', label: '描述', kind: 'textarea', readOnly: true },
    { key: 'summary', label: '结案总结', kind: 'textarea', readOnly: true },
    { key: 'resolved_at', label: '解决时间', kind: 'datetime', readOnly: true },
    { key: 'closed_at', label: '关闭时间', kind: 'datetime', readOnly: true },
    { key: 'created_at', label: '创建时间', kind: 'datetime', readOnly: true },
    { key: 'updated_at', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: [
        'ticket_id',
        'title',
        'status',
        'source',
        'level',
        'group_id',
        'incident_id',
        'resolved_at',
        'closed_at',
        'created_at',
        'updated_at',
      ],
    },
    {
      key: 'people',
      label: '处理人',
      fields: ['reporter_id', 'reporter_name', 'reporter_open_id', 'assignee_id', 'assignee_name'],
    },
    { key: 'detail', label: '内容', fields: ['description', 'summary'] },
  ],
  formFields: [],
};

// ─── 目录 ────────────────────────────────────────────────────────────────────

/** 名称/显示名/描述的统一上限，所有资源共用一套。 */
const NAME_MAX = 64;
const DISPLAY_NAME_MAX = 64;
const DESCRIPTION_MAX = 200;

/**
 * 个别资源的名称有更硬的约束，优先于 `NAME_MAX`。
 *
 * - `namespaces`：DNS-1123 label 最长 63；
 * - `scheduled-runs`：CronJob 名会被控制器追加时间戳后缀组成 Job 名，K8s 因此限制 52。
 */
const NAME_MAX_OVERRIDES: Record<string, number> = {
  namespaces: 63,
  'scheduled-runs': 52,
};

/** `shortDesc` 是值班组的「简述」，与描述同义。 */
const isNameField = (key: string) => key === 'name';
const isDisplayNameField = (key: string) => key === 'displayName' || key === 'spec.displayName';
const isDescriptionField = (key: string) =>
  key === 'description' || key === 'spec.description' || key === 'shortDesc';

/** 把 `target` 移动到 `anchor` 的下一位；不在列表里或已经在位时原样返回。 */
function moveAfter(
  list: string[] | undefined,
  target: string,
  anchor: string
): string[] | undefined {
  if (!list) return list;
  const from = list.indexOf(target);
  const to = list.indexOf(anchor);
  if (from < 0 || to < 0 || from === to + 1) return list;
  const next = [...list];
  next.splice(from, 1);
  next.splice(next.indexOf(anchor) + 1, 0, target);
  return next;
}

/**
 * 字段级的一致性规范：名称/显示名/描述的长度上限，以及「描述紧跟显示名」。
 *
 * 这些约束与具体资源无关，写在一个地方才能保证 20 个 `ResourceSpec` 不会
 * 因为新增资源或人工遗漏而漂移。只改字段描述，不动资源本身的业务字段。
 */
function normalizeSpec(spec: ResourceSpec): ResourceSpec {
  const nameMax = NAME_MAX_OVERRIDES[spec.key] ?? NAME_MAX;
  const fields = spec.fields.map(field => {
    if (isNameField(field.key)) return { ...field, maxLength: nameMax, showCount: true };
    if (isDisplayNameField(field.key)) {
      return { ...field, maxLength: DISPLAY_NAME_MAX, showCount: true };
    }
    if (isDescriptionField(field.key)) {
      return { ...field, maxLength: DESCRIPTION_MAX, showCount: !field.readOnly };
    }
    return field;
  });

  // 由页头/登录人自动补齐的字段不能留在表单里，否则用户会看到一个改了也没用的
  // 输入框（也是「声明了 namespaceField 却仍在 formFields 里」这类遗漏的兜底）。
  const injected = new Set<string>([
    ...(spec.namespaceField ? [spec.namespaceField] : []),
    ...(spec.creatorFields ?? []),
  ]);
  const formFields = spec.formFields?.filter(key => !injected.has(key));

  const descriptionKey = fields.find(field => isDescriptionField(field.key))?.key;
  const displayNameKey = fields.find(field => isDisplayNameField(field.key))?.key;
  // 不动 `fields` 的顺序：列表列顺序由它推导，重排会顺带打乱表格列。
  if (!descriptionKey || !displayNameKey) return { ...spec, fields, formFields };

  return {
    ...spec,
    fields,
    formFields: moveAfter(formFields, descriptionKey, displayNameKey),
    tabs: spec.tabs.map(tab => ({
      ...tab,
      fields: moveAfter(tab.fields, descriptionKey, displayNameKey),
    })),
  };
}

/** 全部资源。顺序即 Hub 内的顺序。 */
const REFERENCE_GRANTS: ResourceSpec = {
  key: 'reference-grants',
  title: '引用授权',
  idKey: 'name',
  name: '授权',
  idLabel: '名称',
  binding: bind('reference-grants'),
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  // A grant crosses a tenant boundary, so the service restricts writes to an
  // administrator. The page hides the entry for everyone else instead of
  // letting them fill a form that will be refused.
  adminOnlyWrite: true,
  fields: [
    {
      key: 'name',
      label: '名称',
      readOnly: true,
      maxLength: 253,
      pattern: DNS_NAME_PATTERN,
      patternMessage: '名称需由小写字母、数字、- 和 . 组成',
      help: '控制面对象名，创建后不可修改。',
    },
    {
      key: 'namespace',
      label: '目标命名空间',
      column: true,
      required: true,
      optionsSource: 'namespaces',
      includeSystemNamespaces: true,
      allowCustom: true,
      help: '授权对象住在目标资源所在的空间。目标空间的所有者才能创建或撤销它。',
    },
    {
      key: 'from',
      label: '引用方（from）',
      kind: 'jsonValue',
      required: true,
      action: 'reference-grant-generator',
      placeholder: '[{"group":"agent.onexai.io","kind":"Agent","namespace":"helper-public"}]',
      help: 'JSON 数组，每项 {group, kind, namespace}。grant 只到空间级；具体哪些 Agent 获得能力由 AgentBinding / ClusterAgentBinding 决定。可用右侧「授权生成器」可视化生成。',
    },
    {
      key: 'to',
      label: '目标（to）',
      kind: 'jsonValue',
      required: true,
      action: 'reference-grant-generator',
      placeholder: '[{"group":"agent.onexai.io","kind":"Skill","name":"k8s-debug"}]',
      help: 'JSON 数组，每项 {group, kind, name}。name 留空表示该 kind 的全部对象。可用右侧「授权生成器」可视化生成。',
    },
    { key: 'labels', label: '标签', kind: 'labels', optionsSource: 'labels', allowCustom: true },
    { key: 'createdAt', label: '创建时间', kind: 'datetime', readOnly: true },
    { key: 'updatedAt', label: '更新时间', kind: 'datetime', readOnly: true },
  ],
  tabs: [
    {
      key: 'basic',
      label: '基本信息',
      fields: ['name', 'namespace', 'from', 'to', 'labels', 'createdAt', 'updatedAt'],
      note: '同命名空间引用不需要授权；跨命名空间引用才需要目标空间的 grant。',
    },
  ],
  formFields: ['name', 'namespace', 'from', 'to', 'labels'],
  // 手写 JSON 也走这里：结构错误在提交前拦住，并把用户带回出错的字段。
  submitValidate: values => validateGrantPayload(values),
};

export const RESOURCE_SPECS: ResourceSpec[] = [
  AGENTS,
  AGENT_TEMPLATES,
  AGENT_BINDINGS,
  CLUSTER_AGENT_BINDINGS,
  REFERENCE_GRANTS,
  MODELS,
  KNOWLEDGE_BASES,
  MEMORIES,
  SKILLS,
  MCPS,
  PROMPTS,
  SCHEDULED_RUNS,
  CUSTOM_COMMANDS,
  RUNTIME_PROFILES,
  RUNTIME_HOSTINGS,
  SANDBOX_TEMPLATES,
  WEBHOOKS,
  SECRETS,
  AUTHZ_RULES,
  NAMESPACES,
  ONCALL_GROUPS,
  TICKETS,
].map(normalizeSpec);

/** 路由段 → 资源。 */
export const RESOURCE_BY_KEY: Record<string, ResourceSpec> = Object.fromEntries(
  RESOURCE_SPECS.map(spec => [spec.key, spec])
);

/** 路由段 → 交给 `ResourcePage` 的描述符。 */
export const DESCRIPTOR_BY_KEY: Record<
  string,
  ResourceDescriptor<Record<string, unknown>, ResourceApiShape<Record<string, unknown>>>
> = Object.fromEntries(RESOURCE_SPECS.map(spec => [spec.key, descriptorOf(spec)]));

/**
 * 只在创建响应里出现一次的密钥字段（只有服务凭据与模型有）。
 *
 * 模型现在可以在详情页按需取回，凭据仍然是一次性的；弹窗文案按字段描述符上
 * 有没有 `reveal` 区分，见 `ResourceForm`。
 */
export const ONE_TIME_SECRET_FIELD: Record<string, string> = {
  secrets: 'secretKey',
  models: 'apiKey',
};

export { EXECUTION_STATE_ENUM };
