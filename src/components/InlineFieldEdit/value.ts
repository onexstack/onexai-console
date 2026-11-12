import type { FieldSpec } from '@/api/resources';
import {
  labelsToTags,
  nameToRef,
  refsToNames,
  tagsToLabels,
} from '@/components/ResourceForm/form-model';

/**
 * 详情页内联编辑的「线上值 ↔ 编辑串」转换。
 *
 * `InfoSection` 的编辑值统一是字符串（见 `EditConfig`），复杂类型在这里成对
 * 序列化/解析：引用列表、标签、JSON 数组用 JSON 字符串承载，其余字段就是原始
 * 文本。与组件分文件是为了让 `index.tsx` 只导出组件（Fast Refresh）。
 */

/** 线上值 → 编辑串。 */
export function inlineEditText(field: FieldSpec, raw: unknown): string {
  if (field.kind === 'labels') return JSON.stringify(labelsToTags(raw));
  if (field.kind === 'tags') return JSON.stringify(Array.isArray(raw) ? raw.map(String) : []);
  if (field.kind === 'jsonList') return JSON.stringify(parseJsonArray(raw));
  if (field.kind === 'refs') return JSON.stringify(refsToNames(raw));
  if (field.kind === 'ref' && field.refShape === 'object') return refsToNames([raw])[0] ?? '';
  // 结构化配置在编辑器里展开成多行，比一整行压缩过的 JSON 好改。
  if (field.kind === 'json' || field.kind === 'jsonValue') return jsonText(raw);
  return raw === undefined || raw === null ? '' : String(raw);
}

/** 编辑串 → 线上值。 */
export function inlineEditWireValue(field: FieldSpec, text: string): unknown {
  if (field.kind === 'labels') return tagsToLabels(parseArray(text));
  if (field.kind === 'tags') return parseArray(text);
  if (field.kind === 'jsonList') {
    const list = parseArray(text);
    // 空选择 = 不设置，保留部署默认；与编辑表单的提交语义一致。
    return list.length > 0 ? JSON.stringify(list) : '';
  }
  if (field.kind === 'refs') {
    const names = parseArray(text);
    return field.refShape === 'object' ? names.map(nameToRef) : names;
  }
  if (field.kind === 'ref' && field.refShape === 'object') {
    return text.trim() === '' ? undefined : nameToRef(text);
  }
  // `json` 线上就是「一个 JSON 字符串」，原样发送；`jsonValue` 发送解析后的值。
  if (field.kind === 'json') return text;
  if (field.kind === 'jsonValue') {
    if (text.trim() === '') return undefined;
    return isValidJson(text) ? JSON.parse(text) : text;
  }
  return text;
}

/** JSON 语法是否合法；保存前的校验和编辑器的实时提示共用。 */
export function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** 线上 JSON → 可编辑的多行文本；非法或空值保持原样。 */
function jsonText(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') {
    if (raw.trim() === '') return '';
    return isValidJson(raw) ? JSON.stringify(JSON.parse(raw), null, 2) : raw;
  }
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

/** 解析编辑串里的字符串数组；非法值按空数组处理。 */
export function parseArray(text: string): string[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** `authzBackends` 这类「线上是 JSON 数组字符串」的字段。 */
function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  return parseArray(value);
}
