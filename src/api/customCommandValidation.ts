/**
 * 自定义命令表单的保存前校验。
 *
 * 服务端（控制面 strategy + agent apiserver）仍是权威；这里只是把确定性
 * 错误提前到表单里，避免用户提交后才在飞书/接口里发现。
 *
 * 关键形状差异：
 * - 控制台 JSON 使用 defaultValue / enums / schemaJson（proto 形状）。
 * - 控制面 CRD YAML 使用 default / enum / schema，两者不要混写。
 */

export interface ValidationIssue {
  /** 出错的表单字段；用于切到对应分区。 */
  field?: string;
  message: string;
}

type JsonObject = Record<string, unknown>;

const PARAM_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const PARAM_SHORT = /^[A-Za-z]$/;
const KNOWN_INS = new Set(['flag', 'positional']);
const KNOWN_TYPES = new Set([
  'string',
  'integer',
  'number',
  'boolean',
  'duration',
  'array',
  'object',
  'json',
]);
const KNOWN_FORMATS = new Set(['k8s-name', 'url', 'json', 'duration']);
const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'duration']);
const STRUCTURED_TYPES = new Set(['array', 'object', 'json']);
const MAX_PARAMETERS = 32;

const COMMAND_FIELDS = ['Params', 'Command', 'Agent', 'Conversation', 'User', 'DryRun', 'Now'];
const OUTPUT_FIELDS = ['Status', 'Header', 'Body', 'JSON', 'Params'];
const CONVERSATION_FIELDS = ['conversationId', 'chatType', 'surface'];
const USER_FIELDS = ['Username', 'UID', 'Groups', 'Extra'];

const DURATION = /^-?(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$|^0$/;

export function validateCustomCommand(values: Record<string, unknown>): ValidationIssue | null {
  const declared = validateParameters(values.parameters);
  if ('issue' in declared) return declared.issue;

  const type = asString(values.type) ?? '';

  if (type === 'prompt') {
    const issue = checkTemplate(
      fieldOf(values.prompt, 'template'),
      'command',
      declared.names,
      'prompt'
    );
    if (issue) return issue;
  }

  if (type === 'http') {
    const issue = validateHTTPTemplates(values.http, declared.names);
    if (issue) return issue;
  }

  if (type === 'tool') {
    const issue = checkTemplate(
      fieldOf(values.tool, 'argumentsTemplate'),
      'command',
      declared.names,
      'tool'
    );
    if (issue) return issue;
  }

  if (type === 'http' || type === 'tool') {
    const output = asObject(values.output);
    if (output && asString(output.format) === 'template') {
      const issue = checkTemplate(asString(output.template), 'output', declared.names, 'output');
      if (issue) return issue;
    }
  }

  return null;
}

// ─── parameters ─────────────────────────────────────────────────────────────

type ParameterCheck = { names: Set<string> } | { issue: ValidationIssue };

function validateParameters(raw: unknown): ParameterCheck {
  if (raw === undefined || raw === null) {
    return { names: new Set<string>() };
  }
  if (!Array.isArray(raw)) {
    return { issue: { field: 'parameters', message: '参数必须是 JSON 数组' } };
  }
  if (raw.length > MAX_PARAMETERS) {
    return {
      issue: { field: 'parameters', message: `最多 ${MAX_PARAMETERS} 个参数，当前 ${raw.length} 个` },
    };
  }

  const names = new Set<string>();
  const shorts = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const issue = validateParameter(raw[i], i, names, shorts);
    if (issue) return { issue };
  }

  const orderIssue = validatePositionalOrder(raw);
  if (orderIssue) return { issue: orderIssue };

  return { names };
}

function validateParameter(
  raw: unknown,
  index: number,
  names: Set<string>,
  shorts: Set<string>
): ValidationIssue | null {
  const at = `第 ${index + 1} 个参数`;
  const param = asObject(raw);
  if (!param) {
    return { field: 'parameters', message: `${at}必须是对象` };
  }

  const name = asString(param.name) ?? '';
  if (!PARAM_NAME.test(name)) {
    return {
      field: 'parameters',
      message: `${at} name 必须是小写字母开头、仅含小写字母/数字/连字符，且不超过 32 个字符`,
    };
  }
  if (names.has(name)) {
    return { field: 'parameters', message: `参数名 "${name}" 重复` };
  }
  names.add(name);

  const inValue = asString(param.in) ?? 'flag';
  if (!KNOWN_INS.has(inValue)) {
    return { field: 'parameters', message: `参数 "${name}" 的 in 只能是 flag 或 positional` };
  }

  const type = asString(param.type) ?? 'string';
  if (!KNOWN_TYPES.has(type)) {
    return {
      field: 'parameters',
      message: `参数 "${name}" 的 type 只能是 ${[...KNOWN_TYPES].join('|')}`,
    };
  }

  const short = asString(param.short);
  if (short !== undefined && short !== '') {
    if (!PARAM_SHORT.test(short)) {
      return { field: 'parameters', message: `参数 "${name}" 的 short 必须是单个字母` };
    }
    if (shorts.has(short)) {
      return { field: 'parameters', message: `短参数 "${short}" 重复` };
    }
    if (inValue === 'positional') {
      return { field: 'parameters', message: `位置参数 "${name}" 不能设置 short` };
    }
    shorts.add(short);
  }

  const required = param.required === true;
  const defaultValue = asString(param.defaultValue);
  if (required && defaultValue !== undefined && defaultValue !== '') {
    return { field: 'parameters', message: `参数 "${name}" 的 required 与 defaultValue 互斥` };
  }
  if (defaultValue !== undefined && defaultValue !== '') {
    const issue = validateDefault(name, type, defaultValue);
    if (issue) return issue;
  }

  const enums = param.enums;
  if (enums !== undefined) {
    if (!Array.isArray(enums) || enums.some(item => typeof item !== 'string' || item === '')) {
      return { field: 'parameters', message: `参数 "${name}" 的 enums 必须是非空字符串数组` };
    }
    if (!SCALAR_TYPES.has(type)) {
      return { field: 'parameters', message: `参数 "${name}" 的 enums 仅适用于标量参数` };
    }
  }

  const format = asString(param.format);
  if (format !== undefined && format !== '') {
    if (!KNOWN_FORMATS.has(format)) {
      return {
        field: 'parameters',
        message: `参数 "${name}" 的 format 只能是 ${[...KNOWN_FORMATS].join('|')}`,
      };
    }
    if (type !== 'string' && type !== 'duration') {
      return { field: 'parameters', message: `参数 "${name}" 的 format 仅适用于 string/duration` };
    }
  }

  const schemaJson = asString(param.schemaJson);
  if (schemaJson !== undefined && schemaJson !== '') {
    if (!STRUCTURED_TYPES.has(type)) {
      return {
        field: 'parameters',
        message: `参数 "${name}" 的 schemaJson 仅适用于 object/array/json`,
      };
    }
    const parsed = parseJSON(schemaJson);
    if (!isObject(parsed)) {
      return { field: 'parameters', message: `参数 "${name}" 的 schemaJson 必须是 JSON 对象` };
    }
  }

  return null;
}

function validateDefault(name: string, type: string, raw: string): ValidationIssue | null {
  const parsed = parseJSON(raw);
  if (parsed === INVALID_JSON) {
    return {
      field: 'parameters',
      message: `参数 "${name}" 的 defaultValue 不是合法 JSON；字符串需要写成 "\\"prod\\""`,
    };
  }

  let ok = true;
  switch (type) {
    case 'string':
      ok = typeof parsed === 'string';
      break;
    case 'integer':
      ok = typeof parsed === 'number' && Number.isInteger(parsed);
      break;
    case 'number':
      ok = typeof parsed === 'number';
      break;
    case 'boolean':
      ok = typeof parsed === 'boolean';
      break;
    case 'duration':
      ok = typeof parsed === 'string' && DURATION.test(parsed);
      break;
    case 'array':
      ok = Array.isArray(parsed);
      break;
    case 'object':
      ok = isObject(parsed);
      break;
    case 'json':
      ok = true;
      break;
    default:
      ok = false;
  }
  if (!ok) {
    return {
      field: 'parameters',
      message: `参数 "${name}" 的 defaultValue 与 type=${type} 不匹配`,
    };
  }
  return null;
}

function validatePositionalOrder(params: unknown[]): ValidationIssue | null {
  let seenOptional = false;
  for (let i = 0; i < params.length; i += 1) {
    const param = asObject(params[i]);
    if (!param || asString(param.in) !== 'positional') continue;
    const name = asString(param.name) ?? `#${i + 1}`;
    if (param.required === true && seenOptional) {
      return {
        field: 'parameters',
        message: `必填位置参数 "${name}" 不能排在可选位置参数之后`,
      };
    }
    if (param.required !== true) seenOptional = true;
  }
  return null;
}

// ─── templates ──────────────────────────────────────────────────────────────

function validateHTTPTemplates(raw: unknown, declared: Set<string>): ValidationIssue | null {
  const http = asObject(raw);
  if (!http) return null;

  let issue = checkTemplate(asString(http.url), 'command', declared, 'http');
  if (issue) return issue;

  const headers = http.headers;
  if (Array.isArray(headers)) {
    for (const header of headers) {
      const value = fieldOf(header, 'value');
      issue = checkTemplate(value, 'command', declared, 'http');
      if (issue) return issue;
    }
  }

  const query = asObject(http.query);
  if (query) {
    for (const value of Object.values(query)) {
      issue = checkTemplate(asString(value), 'command', declared, 'http');
      if (issue) return issue;
    }
  }

  return checkTemplate(asString(http.body), 'command', declared, 'http');
}

type TemplateScope = 'command' | 'output';

interface BlockFrame {
  /** range/with/define/block 改变 dot；if 不改变但同样消耗一个 end。 */
  changesDot: boolean;
}

function checkTemplate(
  template: unknown,
  scope: TemplateScope,
  declared: Set<string>,
  field: string
): ValidationIssue | null {
  if (typeof template !== 'string' || template === '') return null;

  const stack: BlockFrame[] = [];
  const action = /\{\{([\s\S]*?)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = action.exec(template)) !== null) {
    const raw = stripQuoted(match[1] ?? '').trim();
    if (raw === '') continue;

    if (/^end\b/.test(raw)) {
      stack.pop();
      continue;
    }
    if (/^else\b/.test(raw)) {
      // else with / else range 改变 dot；把当前块的 dot 标记为未知，避免把
      // {{.Username}} 误判成根字段。else if 不改变 dot，保持原样。
      if (/^else\s+(with|range)\b/.test(raw) && stack.length > 0) {
        stack[stack.length - 1] = { changesDot: true };
      }
      continue;
    }

    const start = /^(range|with|define|block|if)\b/.exec(raw);
    const dotKnown = !stack.some(frame => frame.changesDot);

    const issue = checkActionFields(raw, dotKnown, scope, declared);
    if (issue) return { field, message: issue };

    if (start) {
      stack.push({ changesDot: start[1] !== 'if' });
    }
  }

  return null;
}

function checkActionFields(
  action: string,
  dotKnown: boolean,
  scope: TemplateScope,
  declared: Set<string>
): string | null {
  const tokens = action.split(/[\s(),|:=]+/);

  for (const token of tokens) {
    if (token === '') continue;

    if (token.startsWith('$.')) {
      const chain = token.slice(2).split('.').filter(Boolean);
      const issue = checkChain(chain, scope, declared);
      if (issue) return issue;
      continue;
    }

    if (!dotKnown || !token.startsWith('.')) continue;

    const chain = token.slice(1).split('.').filter(Boolean);
    const issue = checkChain(chain, scope, declared);
    if (issue) return issue;
  }
  return null;
}

function checkChain(chain: string[], scope: TemplateScope, declared: Set<string>): string | null {
  if (chain.length === 0) return null;

  const rootFields = scope === 'command' ? COMMAND_FIELDS : OUTPUT_FIELDS;
  const root = chain[0] ?? '';

  if (!rootFields.includes(root)) {
    if (root === 'Param') {
      return missingParamHint(scope);
    }
    return `模板引用了未知字段 .${root}；可用字段：${rootFields.join('、')}`;
  }

  if (root === 'Params') {
    if (chain.length < 2) return null;
    const param = chain[1] ?? '';
    if (!declared.has(param)) {
      const names = declared.size > 0 ? [...declared].join('、') : '（无）';
      return `模板引用了未声明的参数 .Params.${param}；已声明参数：${names}`;
    }
    return null;
  }

  if (scope === 'command') {
    if (
      root === 'Conversation' &&
      chain.length >= 2 &&
      !CONVERSATION_FIELDS.includes(chain[1] ?? '')
    ) {
      return `模板字段 .Conversation.${chain[1]} 不存在；可用字段：${CONVERSATION_FIELDS.join('、')}`;
    }
    if (root === 'User' && chain.length >= 2 && !USER_FIELDS.includes(chain[1] ?? '')) {
      return `模板字段 .User.${chain[1]} 不存在；可用字段：${USER_FIELDS.join('、')}`;
    }
    if ((root === 'Command' || root === 'Agent' || root === 'DryRun') && chain.length > 1) {
      return `模板字段 .${chain.join('.')} 不存在；.${root} 是标量`;
    }
    return null;
  }

  if ((root === 'Status' || root === 'Body') && chain.length > 1) {
    return `模板字段 .${chain.join('.')} 不存在；.${root} 是标量`;
  }
  // Header / JSON 的 key 无法静态确定（输出响应），放行。
  return null;
}

function missingParamHint(scope: TemplateScope): string {
  const fields = scope === 'command' ? COMMAND_FIELDS : OUTPUT_FIELDS;
  return (
    '模板字段 .Param 不存在；参数集合请用 .Params（复数），例如 {{.Params.name}}。' +
    `可用字段：${fields.join('、')}`
  );
}

// ─── small helpers ──────────────────────────────────────────────────────────

const INVALID_JSON = Symbol('invalid-json');

function parseJSON(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return INVALID_JSON;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function fieldOf(value: unknown, key: string): unknown {
  const object = asObject(value);
  return object ? object[key] : undefined;
}

/** 去掉双引号/反引号字符串，避免把 "a.b" 里的点当成字段引用。 */
function stripQuoted(action: string): string {
  return action.replace(/"[^"]*"|`[^`]*`/g, '""');
}
