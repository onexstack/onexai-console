import { suggestName } from './matcher';
import {
  SELECTION_KINDS,
  SELECTION_LIMITS,
  type SmartCatalog,
  type SmartDraft,
  type SmartSelection,
  type SmartSelectionKind,
} from './types';

const NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const NAME_MAX = 63;

export interface ParseContext {
  goal: string;
  catalog: SmartCatalog;
  existingAgentNames: Set<string>;
}

export type ParseResult = { ok: true; draft: SmartDraft } | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从模型输出里抠出第一个完整的 JSON 对象。
 *
 * 模型可能裹 Markdown 代码块、在前后加解释，甚至在字符串里带 `}`。所以先删
 * 围栏，再从第一个 `{` 起用括号深度扫描（跳过字符串与转义），而不是简单地从
 * 第一个 `{` 截到最后一个 `}`。
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenced?.[1] ?? text).trim();
  const start = source.indexOf('{');
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function uniqueName(name: string, existing: Set<string>): string {
  if (!NAME_PATTERN.test(name) || name.length > NAME_MAX) return name;
  if (!existing.has(name)) return name;
  for (let index = 2; index <= 20; index += 1) {
    const candidate = `${name}-${index}`.slice(0, NAME_MAX);
    if (!existing.has(candidate)) return candidate;
  }
  return `${name.slice(0, NAME_MAX - 5)}-${Date.now().toString(36).slice(-4)}`;
}

function normaliseReason(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, 60) || '由模型推荐';
}

function selectionsOf(value: unknown, allowed: Set<string>, limit: number): SmartSelection[] {
  if (!Array.isArray(value)) return [];
  const out: SmartSelection[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const name =
      typeof item === 'string' ? item.trim() : isObject(item) ? String(item.name ?? '').trim() : '';
    if (!name || !allowed.has(name) || seen.has(name)) continue;
    seen.add(name);
    const reason = isObject(item) ? normaliseReason(item.reason) : '由模型推荐';
    out.push({ name, reason });
    if (out.length >= limit) break;
  }
  return out;
}

function hasAnySelection(draft: SmartDraft): boolean {
  return SELECTION_KINDS.some(kind => draft[kind].length > 0);
}

function candidateNames(catalog: SmartCatalog, kind: SmartSelectionKind): Set<string> {
  return new Set(catalog[kind].map(candidate => candidate.name));
}

/**
 * 校验模型输出。
 *
 * 任何不在候选集合里的名称都会被丢弃——模型的输出是**不可信数据**，绝不能直接
 * 进入创建请求。名称不合法或重名时回退到本地生成；模型选择不合法时回退到部署
 * 默认模型。
 */
export function parseDraft(text: string, context: ParseContext): ParseResult {
  const raw = extractJson(text);
  if (!isObject(raw)) return { ok: false, error: '模型返回的内容不是合法 JSON' };

  const allowedModels = new Set(context.catalog.models.map(candidate => candidate.name));
  const model =
    typeof raw.model === 'string' && allowedModels.has(raw.model.trim()) ? raw.model.trim() : '';

  const selections = {} as Record<SmartSelectionKind, SmartSelection[]>;
  for (const kind of SELECTION_KINDS) {
    selections[kind] = selectionsOf(
      raw[kind],
      candidateNames(context.catalog, kind),
      SELECTION_LIMITS[kind]
    );
  }

  const requestedName = cleanName(raw.name);
  const saneName =
    NAME_PATTERN.test(requestedName) && requestedName.length <= NAME_MAX
      ? uniqueName(requestedName, context.existingAgentNames)
      : suggestName(context.goal, context.existingAgentNames);

  const displayName =
    typeof raw.displayName === 'string' && raw.displayName.trim()
      ? raw.displayName.trim().slice(0, 100)
      : saneName;
  const description =
    typeof raw.description === 'string' && raw.description.trim()
      ? raw.description.trim().slice(0, 500)
      : context.goal.trim().slice(0, 200);

  const draft: SmartDraft = {
    name: saneName,
    displayName,
    description,
    model,
    status: 'enabled',
    knowledgeBases: selections.knowledgeBases,
    mcps: selections.mcps,
    skills: selections.skills,
    customCommands: selections.customCommands,
    engine: 'ai',
  };

  const catalogHasCandidates = SELECTION_KINDS.some(kind => context.catalog[kind].length > 0);
  if (catalogHasCandidates && !hasAnySelection(draft)) {
    return { ok: false, error: '模型没有选择任何可用能力' };
  }

  const notes: string[] = [];
  if (raw.model && !model) notes.push('模型选择不在可用列表里，已改为部署默认模型');
  if (requestedName && requestedName !== saneName) notes.push('名称不合法或已存在，已自动调整');
  if (notes.length > 0) draft.notice = notes.join('；');

  return { ok: true, draft };
}
