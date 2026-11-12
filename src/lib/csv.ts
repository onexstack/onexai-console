/**
 * CSV 导出。
 *
 * 列表页的「下载」按钮只有这一个出口：编码规则、BOM、文件名都收在这里，避免每个
 * 页面各写一份、Excel 打开时有的乱码有的正常。
 */

/** 单个单元格转义：含逗号/引号/换行的值整体加引号，内部引号翻倍。 */
export function toCsvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 把表头 + 数据行下载成 CSV。
 *
 * `header` / `rows` 接受任意值（`null` 写成空串），调用方不需要先转字符串。
 * 加 BOM 是因为 Excel 打开无 BOM 的 UTF-8 CSV 会按本地代码页解码，中文全是乱码。
 * `\r\n` 是 CSV 规范的行分隔符，与 Excel 保持一致。
 */
export function downloadCsv(filename: string, header: unknown[], rows: unknown[][]): void {
  const csv = '﻿' + [header, ...rows].map(row => row.map(toCsvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
