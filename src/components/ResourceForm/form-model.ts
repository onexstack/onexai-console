import {
  CUSTOM_COMMAND_PREFIX,
  conditionMatches,
  valueAt,
  type FieldSpec,
  type ResourceSpec,
} from '@/api/resources';
import {
  authValueFromSecretRef,
  splitWebhookAuth,
} from '@/components/WebhookAuthForm/value';
import {
  commandGroupKey,
  commandGroupValuesOf,
  isCommandGroupValue,
  mergeCommandSelector,
} from '@/lib/command-groups';
import { readPath } from '@/lib/object-path';

export { readPath };

/**
 * 表单与「线上行」之间的转换。
 *
 * 表单是扁平的、控件友好的值（标签是 `k=v` 数组、纳秒按秒、引用是名称数组）；
 * 线上行是嵌套的、类型严格的值（labels 是 map、超时是纳秒、绑定引用是 `[{name}]`）。
 * 两个方向各写一份、并且只在这里写：新建页与编辑页共用同一套转换，
 * 否则「打开表单看到的值」和「保存回去的值」迟早对不上。
 */

/** 这一份说明里真正可编辑的字段（只读字段只在新建时出现，和原弹窗一致）。 */
export function editableFields(spec: ResourceSpec, isCreate: boolean): FieldSpec[] {
  return (spec.formFields ?? [])
    .map(key => spec.fields.find(f => f.key === key))
    .filter((f): f is FieldSpec => Boolean(f) && (!f?.readOnly || isCreate));
}

export interface DisplayNameFieldPair {
  nameKey: string;
  displayNameKey: string;
}

/**
 * 新建表单同时有「名称」和「显示名」时返回它们的字段键，用于让显示名默认
 * 跟随名称。按 `isCreate=true` 取字段：`namespaces` 的 `name` 标了 readOnly，
 * 但新建时仍会渲染。
 */
export function displayNameFieldsOf(spec: ResourceSpec): DisplayNameFieldPair | null {
  const fields = editableFields(spec, true);
  const nameField = fields.find(field => field.key === 'name' || field.key.endsWith('.name'));
  const displayField = fields.find(
    field =>
      field.key === 'displayName' || field.key.endsWith('.displayName') || field.label === '显示名'
  );
  if (!nameField || !displayField) return null;
  return { nameKey: nameField.key, displayNameKey: displayField.key };
}

/** 行 → 表单初始值。 */
export function initialValues(
  spec: ResourceSpec,
  record: Record<string, unknown> | null,
  isCreate: boolean
): Record<string, unknown> {
  const initial: Record<string, unknown> = {};
  for (const field of editableFields(spec, isCreate)) {
    const raw = readPath(record ?? {}, field.key);
    let value = raw;
    // 新建时描述符可以给默认值（例如知识库的 Top K）；编辑始终以记录为准。
    // `defaultWhenEmpty` 是例外：只给「空值与默认值语义等价」的枚举字段用
    // （执行方式空=inproc、鉴权类型空=none），否则编辑页会显示一个空白下拉。
    if (
      (isCreate || field.defaultWhenEmpty) &&
      (value === undefined || value === null) &&
      field.defaultValue !== undefined
    ) {
      value = field.defaultValue;
    }

    if (field.kind === 'labels') {
      value = labelsToTags(value);
    } else if (field.kind === 'jsonList') {
      value = parseJsonArray(value);
    } else if (field.kind === 'refs' && field.refShape === 'object') {
      value = refsToNames(value);
    } else if (field.kind === 'ref' && field.refShape === 'object') {
      value = refsToNames([value])[0] ?? '';
    } else if (field.kind === 'commands') {
      // 三个线上字段合成一个控件：分组选择器值带 `group:` 前缀，自定义命令
      // 引用带 `custom:` 前缀，内置命令原样保留，提交时再拆回去（见
      // normalizeSubmit）。
      const groups = field.commandSelectorField
        ? commandGroupValuesOf(readPath(record ?? {}, field.commandSelectorField))
        : [];
      const refs = refsToNames(value).map(name => `${CUSTOM_COMMAND_PREFIX}${name}`);
      const plain = field.commandsField ? readPath(record ?? {}, field.commandsField) : undefined;
      value = [...groups, ...refs, ...(Array.isArray(plain) ? plain.map(String) : [])];
    } else if (field.kind === 'webhookAuth') {
      // 线上只有一个 secretRef 字符串；控件需要知道用哪种模式编辑它。
      value = authValueFromSecretRef(value);
    } else if (field.kind === 'jsonValue' && value !== undefined && typeof value !== 'string') {
      value = JSON.stringify(value, null, 2);
    }

    // 纳秒字段（Runtime 的超时/TTL）在界面上按秒编辑。
    if (isSecondsNanos(field) && typeof value === 'number') {
      value = value / 1_000_000_000;
    }

    setPath(initial, field.key, value);
  }
  return initial;
}

export interface NormalizedValues {
  values: Record<string, unknown>;
  /** 某个字段的值不合法（目前只有 JSON 语法）。 */
  error: string | null;
}

/**
 * 表单值 → 提交体。
 *
 * `baseRecord` 只用于判断条件字段：编辑时 `kind`、`execution.mode` 等只读字段
 * 不在表单值里，必须从记录补齐，否则外部智能体会被当成 native。隐藏字段写入
 * `undefined` 自有属性（不是 `delete`），编辑路径的 `deepMerge(record, values)`
 * 才会覆盖记录里的旧值。
 */
export function normalizeSubmit(
  spec: ResourceSpec,
  values: Record<string, unknown>,
  isCreate: boolean,
  baseRecord?: Record<string, unknown> | null
): NormalizedValues {
  const out = structuredClone(values);
  const merged = deepMerge(baseRecord ?? {}, values);
  const readCondition = (path: string) => valueAt(merged, path);

  for (const field of editableFields(spec, isCreate)) {
    if (field.when && !conditionMatches(field.when, readCondition)) {
      setPath(out, field.key, undefined);
    }
  }

  for (const field of editableFields(spec, isCreate)) {
    const value = readPath(out, field.key);

    if (field.kind === 'labels') {
      setPath(out, field.key, tagsToLabels(value));
      continue;
    }

    if (isSecondsNanos(field)) {
      setPath(
        out,
        field.key,
        typeof value === 'number' && Number.isFinite(value)
          ? Math.round(value * 1_000_000_000)
          : undefined
      );
      continue;
    }

    if (field.kind === 'jsonList') {
      const list = Array.isArray(value) ? value.map(String) : [];
      // 空选择 = 不设置（保留部署默认），不发 `[]`。
      setPath(out, field.key, list.length > 0 ? JSON.stringify(list) : '');
      continue;
    }

    if (field.kind === 'commands') {
      // 一个控件拆回三个线上字段：`group:` 开头的是整组命令（写回
      // commandSelector），`custom:` 开头的是 CustomCommand 引用，其余是
      // 内置命令名（如 bind、skill:<名字>）。分组必须先于「其余」过滤，
      // 否则 `group:duty` 会被当成一个命令名写进 commands，成为孤儿。
      const items = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
      const commandGroups = items.filter(isCommandGroupValue).map(commandGroupKey);
      const customCommands = items
        .filter(item => item.startsWith(CUSTOM_COMMAND_PREFIX))
        .map(item => item.slice(CUSTOM_COMMAND_PREFIX.length))
        .filter(name => name !== '')
        // 候选值可能是 `空间/名称`（集群级绑定没有「本空间」可回退）。
        // 线上引用必须是 `{name, namespace}` 两个字段：把整串塞进 name 会让
        // 控制器去查一个名叫 `空间/名称` 的命令，永远匹配不到。
        .map(nameToRef);
      const commands = items.filter(
        item => !item.startsWith(CUSTOM_COMMAND_PREFIX) && !isCommandGroupValue(item)
      );
      setPath(out, field.key, customCommands);
      if (field.commandsField) setPath(out, field.commandsField, commands);
      if (field.commandSelectorField) {
        // 保留操作者写在 selector 里的非分组表达式；没有分组也没有保留项时
        // 置为 undefined，避免把 `{}`（= 匹配全部）发给上游。
        const base = readPath(baseRecord ?? {}, field.commandSelectorField);
        setPath(out, field.commandSelectorField, mergeCommandSelector(base, commandGroups));
      }
      continue;
    }

    if (field.kind === 'webhookAuth') {
      // 一个控件拆回两个线上字段。非当前模式也要写 undefined 的自有属性：
      // 编辑路径最后是 deepMerge(record, values)，缺键会留下旧凭据。
      const { secretRef, authToken } = splitWebhookAuth(value);
      setPath(out, field.key, secretRef);
      setPath(out, field.authTokenField ?? 'authToken', authToken);
      continue;
    }

    if (field.kind === 'refs' && field.refShape === 'object') {
      const names = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
      setPath(out, field.key, names.map(nameToRef));
      continue;
    }

    if (field.kind === 'ref' && field.refShape === 'object') {
      const name = typeof value === 'string' ? value.trim() : '';
      setPath(out, field.key, name ? nameToRef(name) : undefined);
      continue;
    }

    if (field.kind === 'clientConfig') {
      // 结构化控件给的是一个对象；全空时它自己回调 undefined。这里再兜一次底：
      // `{}` 与「没有配置」必须等价，否则后端会以为端点已声明却解析不出地址。
      const cfg = value as Record<string, unknown> | undefined;
      if (!cfg || Object.keys(cfg).length === 0) {
        setPath(out, field.key, undefined);
        continue;
      }
      // url 与 service 互斥。缺的一侧要写成 **值为 undefined 的自有属性**，而不是
      // 干脆不写：编辑路径最后是 `deepMerge(record, values)`，缺键会让记录里的旧
      // 地址原样留下——从 URL 改成 Service 保存后，两个地址同时存在，后端直接拒绝。
      const exclusive: Record<string, unknown> = { ...cfg };
      if (!exclusive['url']) exclusive['url'] = undefined;
      if (!exclusive['service']) exclusive['service'] = undefined;
      setPath(out, field.key, exclusive);
      continue;
    }

    if (field.kind === 'jsonValue' && (value === '' || value === undefined)) {
      // 结构化 JSON 留空 = 不设置。原样发送空串会被上游按「数组」解码而报错。
      setPath(out, field.key, undefined);
      continue;
    }

    if (
      (field.kind === 'json' || field.kind === 'jsonValue') &&
      typeof value === 'string' &&
      value.trim() !== ''
    ) {
      try {
        const parsed: unknown = JSON.parse(value);
        // `json` 是「线上就是一个 JSON 字符串」的字段（params/headers/spec），
        // 校验后必须原样发送；`jsonValue` 是结构化值（绑定引用、命令定义），
        // 才把解析结果发出去。
        setPath(out, field.key, field.kind === 'json' ? value : parsed);
      } catch {
        return { values: out, error: `${field.label} 不是合法 JSON` };
      }
    }
  }

  return { values: out, error: null };
}

/** `a.b.c` → `['a','b','c']`；antd 用数组表达嵌套字段。 */
export function nameOf(field: FieldSpec): string | string[] {
  return field.key.includes('.') ? field.key.split('.') : field.key;
}

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  if (!last) return;
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!key) continue;
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[last] = value;
}

/** 嵌套对象深合并；数组与标量直接覆盖。 */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** 服务端的 `labels` map → 表单里的一组 `k=v`。 */
export function labelsToTags(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}=${v}`);
}

/** 表单里的 `k=v` → 服务端的 `labels` map。没有 `=` 的项丢弃。 */
export function tagsToLabels(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!Array.isArray(value)) return labels;
  for (const item of value as unknown[]) {
    const text = String(item);
    const at = text.indexOf('=');
    if (at > 0) labels[text.slice(0, at)] = text.slice(at + 1);
  }
  return labels;
}

/** 纳秒字段在界面上按秒编辑：`*Nanos` 且声明了单位「秒」。 */
export function isSecondsNanos(field: FieldSpec): boolean {
  return field.unit === '秒' && field.key.endsWith('Nanos');
}

/** `["opa"]` / `['opa']` / `["opa"]` → `['opa']`；非法值按空数组处理。 */
function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 引用形状 `[{name, namespace?}]` → 选择值数组。
 *
 * 同空间引用保持裸名字；跨空间引用是 `空间/名称`。这同时是 REST 契约：后端
 * 接受两种拼写，只把跨空间的那一种显式写出来。
 */
export function refsToNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const name = typeof record.name === 'string' ? record.name : '';
        const namespace = typeof record.namespace === 'string' ? record.namespace : '';
        if (!name) return '';
        return namespace ? `${namespace}/${name}` : name;
      }
      return '';
    })
    .filter(Boolean);
}

/** 选择值 `空间/名称` / `名称` → 线上引用对象。资源名不含 `/`。 */
export function nameToRef(value: string): Record<string, string> {
  const at = value.indexOf('/');
  if (at > 0) {
    return { name: value.slice(at + 1), namespace: value.slice(0, at) };
  }
  return { name: value };
}
