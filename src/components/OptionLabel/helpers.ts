/** 描述统一折叠成单行：下拉只给它一行高度。 */
export function normalizeOptionDescription(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * 候选项搜索：同时匹配标题与描述。
 *
 * antd 的 `optionFilterProp="label"` 只搜 label；描述进了副行之后也应该能被搜到。
 */
export function matchOptionText(input: string, ...texts: Array<string | undefined>): boolean {
  const keyword = input.trim().toLowerCase();
  if (!keyword) return true;
  return texts.some(text => text?.toLowerCase().includes(keyword));
}
