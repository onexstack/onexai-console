/**
 * 智能体 A2A 的纯数据逻辑：提交裁剪、AgentCard 预览载荷、最小卡片生成。
 *
 * 这里刻意不 import `resources.tsx`：`resources.tsx` 会 import 本文件来挂
 * `AGENTS.submitTransform`，反向依赖会绕成环。路径读写只针对 `a.b.c` 这种
 * 扁平字符串，和表单描述符使用的形状一致。
 */

type Values = Record<string, unknown>;

/** 外部智能体不允许携带的平台行为字段。 */
const NATIVE_ONLY_FIELDS = [
  'model',
  'memoryRef',
  'templateRefs',
  'prompts',
  'skills',
  'mcps',
  'knowledgeBases',
  'customCommands',
  'authzBackends',
  'delegates',
] as const;

function read(values: Values, path: string): unknown {
  let current: unknown = values;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Values)[part];
  }
  return current;
}

/** 写入一个自有属性；中间对象不存在时补出来。 */
function write(values: Values, path: string, value: unknown): void {
  const parts = path.split('.');
  const leaf = parts.pop();
  if (!leaf) return;
  let current = values;
  for (const part of parts) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Values;
  }
  current[leaf] = value;
}

function text(values: Values, path: string): string {
  const value = read(values, path);
  return typeof value === 'string' ? value.trim() : '';
}

function numberOrUndefined(values: Values, path: string): number | undefined {
  const value = read(values, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 按当前表单值生成最小 AgentCard（仅 `source=manual` 且未填卡片时使用）。 */
export function minimalCard(values: Values): string | undefined {
  const endpoint = text(values, 'execution.a2a.endpoint');
  if (!endpoint) return undefined;
  const name = text(values, 'displayName') || text(values, 'name') || 'agent';
  return JSON.stringify({
    protocolVersion: '0.3.0',
    name,
    description: text(values, 'description'),
    version: '0.0.1',
    url: endpoint,
    preferredTransport: 'JSONRPC',
    capabilities: { streaming: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  });
}

/** 预览接口使用的 A2A 执行块。 */
export function buildA2AExecution(values: Values): {
  mode: string;
  a2a: Record<string, unknown>;
} {
  const source = text(values, 'execution.a2a.source') || 'card-url';
  const a2a: Record<string, unknown> = {
    source,
    cardUrl: text(values, 'execution.a2a.cardUrl') || undefined,
    endpoint: text(values, 'execution.a2a.endpoint') || undefined,
    runtimeRef: text(values, 'execution.a2a.runtimeRef') || undefined,
    timeoutSeconds: numberOrUndefined(values, 'execution.a2a.timeoutSeconds'),
    maxConcurrentInvocations: numberOrUndefined(values, 'execution.a2a.maxConcurrentInvocations'),
    auth: {
      type: text(values, 'execution.a2a.auth.type') || 'none',
      apiKeyHeader: text(values, 'execution.a2a.auth.apiKeyHeader') || undefined,
      credential: text(values, 'execution.a2a.auth.credential') || undefined,
      tokenUrl: text(values, 'execution.a2a.auth.tokenUrl') || undefined,
      clientId: text(values, 'execution.a2a.auth.clientId') || undefined,
      clientSecret: text(values, 'execution.a2a.auth.clientSecret') || undefined,
    },
  };

  const card = text(values, 'execution.a2a.card');
  if (card) a2a.card = card;
  else if (source === 'manual') a2a.card = minimalCard(values);

  return { mode: 'a2a', a2a };
}

/**
 * 提交前的领域裁剪。
 *
 * 编辑路径是 `deepMerge(record, values)`：没出现在提交体里的字段会从记录回灌。
 * 因此所有要清掉的值都必须写成 `undefined` 自有属性（不能 delete），容器
 * （execution.a2a / contract / sharing）也要整体置 undefined。
 */
export function normalizeAgentSubmit(
  values: Values,
  ctx: { isCreate: boolean; record: Values | null }
): void {
  const rawKind = values.kind ?? ctx.record?.kind;
  const kind = rawKind === 'external' ? 'external' : 'native';
  write(values, 'kind', kind);

  if (kind === 'external') {
    write(values, 'execution.mode', 'a2a');
    if (!text(values, 'execution.a2a.source')) {
      write(values, 'execution.a2a.source', 'card-url');
    }
    if (text(values, 'execution.a2a.source') === 'manual' && !text(values, 'execution.a2a.card')) {
      const card = minimalCard(values);
      if (card) write(values, 'execution.a2a.card', card);
    }
    for (const field of NATIVE_ONLY_FIELDS) write(values, field, undefined);
    return;
  }

  const mode = text(values, 'execution.mode') === 'a2a' ? 'a2a' : 'inproc';
  write(values, 'execution.mode', mode);
  if (mode === 'a2a') {
    // native 的 a2a 是远端执行，不是外部注册；source/card 属于 external。
    write(values, 'execution.a2a.source', undefined);
    write(values, 'execution.a2a.card', undefined);
  } else {
    write(values, 'execution.a2a', undefined);
  }
  write(values, 'contract', undefined);
  write(values, 'sharing', undefined);
}
